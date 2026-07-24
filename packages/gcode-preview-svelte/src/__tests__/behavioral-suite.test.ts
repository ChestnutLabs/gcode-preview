// @vitest-environment happy-dom
/**
 * The framework-portable behavioral suite through the SVELTE adapter (DD-007 §4.6):
 * the same parity contract Vue and React pass — proving the store/action API is a
 * faithful bridge over the shared controller. Runs compiler-free: the store contract
 * and `use:` action are plain functions.
 */
import { describe, expect, it } from 'vitest';
import {
  SuiteStubWorker,
  makeSuiteStubGL,
  runBehavioralSuite,
  type AdapterInstance
} from '@chestnutlabs/gcode-preview-core/testing';
import { createGcodePreview, type SvelteGcodePreview } from '../index';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Read the current store value the Svelte way (subscribe → capture → unsubscribe). */
function current(preview: SvelteGcodePreview) {
  let value!: ReturnType<AdapterInstance['getState']>;
  const off = preview.state.subscribe((s) => {
    value = s;
  });
  off();
  return value;
}

runBehavioralSuite(
  'svelte createGcodePreview',
  { describe, it, expect },
  {
    create(opts = {}) {
      const canvas = document.createElement('canvas');
      const preview = createGcodePreview({
        createWorker: () => new SuiteStubWorker(opts.machine),
        renderer: {
          buildVolume: opts.consumerVolume === true ? { x: 220, y: 220, z: 250 } : undefined,
          quality: 'lines',
          chunksPerTick: 8,
          createRenderer: () => makeSuiteStubGL(canvas),
          scheduleFrame: (cb) => cb()
        }
      });
      const action = preview.canvas(canvas); // `use:preview.canvas`
      const instance: AdapterInstance = {
        parse: (bytes) => preview.parse(bytes),
        getState: () => current(preview),
        controls: preview.controls,
        observeProgress: (obs) => preview.observeProgress(obs),
        clearProgress: () => preview.clearProgress(),
        onEvent: (cb) => preview.onEvent(cb),
        firstChunkDrawCount: () => preview.raw.renderer()!.chunkMeshes[0].geometry.drawRange.count,
        dispose: () => {
          action.destroy(); // component teardown order: action destroy, then onDestroy
          preview.dispose();
        },
        settle
      };
      return instance;
    }
  }
);

describe('svelte store contract', () => {
  it('subscribe emits the current snapshot immediately and every replacement after', async () => {
    const canvas = document.createElement('canvas');
    const preview = createGcodePreview({
      createWorker: () => new SuiteStubWorker(),
      renderer: {
        quality: 'lines',
        chunksPerTick: 8,
        createRenderer: () => makeSuiteStubGL(canvas),
        scheduleFrame: (cb) => cb()
      }
    });
    preview.canvas(canvas);
    const seen: unknown[] = [];
    const off = preview.state.subscribe((s) => seen.push(s));
    expect(seen.length).toBe(1); // immediate emission — the Readable contract
    await preview.parse(new Uint8Array(1_000));
    await settle();
    expect(seen.length).toBeGreaterThan(1);
    off();
    const countAfterOff = seen.length;
    preview.clearProgress();
    expect(seen.length).toBe(countAfterOff); // unsubscribed — no further emissions
    preview.dispose();
  });
});
