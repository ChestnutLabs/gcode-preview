// @vitest-environment happy-dom
/**
 * #430: `<GcodePreview onDisclosure>` reports the CURRENT build's disclosure. It used to read the hook's
 * render snapshot, which lags React's commit, so it fired '' on the first build and the previous build's
 * text after that.
 *
 * Real decimation needs over 2M extrusion segments, so the test drives the real controller with the real
 * renderer's own `buildComplete` event (the controller computes the disclosure from `decimationApplied`).
 */
import { describe, expect, it } from 'vitest';
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { GcodePreview, type GcodePreviewHandle } from '../index';
import { readLiveState, registerLiveState } from '../live-state';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

const EVERY_3RD = 'Showing every 3rd extrusion segment (layer boundaries kept); travel hidden. 9 segments drawn.';
const EVERY_2ND = 'Showing every 2nd extrusion segment (layer boundaries kept); travel hidden. 7 segments drawn.';

/** Fire a `buildComplete` from the bound renderer, inside `act` so React may re-render after it. */
async function emitBuild(handle: GcodePreviewHandle, decimationApplied: number, segments: number): Promise<void> {
  const r = handle.raw.renderer() as unknown as { emit(e: unknown): void } | null;
  if (r === null) throw new Error('renderer not bound');
  await act(async () => {
    r.emit({ type: 'buildComplete', segments, decimationApplied, travelHidden: true, quality: 'lines' });
  });
}

describe('<GcodePreview onDisclosure> (react, #430)', () => {
  it('reports the current build: not "" on the first build, not the previous text on the next', async () => {
    const canvas = document.createElement('canvas');
    const ref = createRef<GcodePreviewHandle>();
    // One ordered log: like Vue/Svelte/the Element, build-complete fires first, then disclosure.
    const log: string[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(host);
      root.render(
        createElement(GcodePreview, {
          ref,
          source: null,
          quality: 'lines',
          createWorker: () => new SuiteStubWorker(),
          rendererOptions: {
            createRenderer: () => makeSuiteStubGL(canvas),
            scheduleFrame: (cb: () => void) => cb(),
            chunksPerTick: 8
          },
          onBuildComplete: (e) => log.push(`build ${e.segments}`),
          onDisclosure: (text) => log.push(`disclosure ${text}`)
        })
      );
    });
    await settle();
    const handle = ref.current;
    if (handle === null) throw new Error('no handle');
    expect(log).toEqual([]);

    // First build: the new text, not ''.
    await emitBuild(handle, 3, 9);
    expect(log).toEqual(['build 9', `disclosure ${EVERY_3RD}`]);
    await settle();
    // The emitted text is the controller's disclosure (the render snapshot agrees once React commits).
    expect(handle.state.disclosure).toBe(EVERY_3RD);

    // Second build with a different disclosure: the new text, not the previous build's.
    await emitBuild(handle, 2, 7);
    expect(log.slice(2)).toEqual(['build 7', `disclosure ${EVERY_2ND}`]);
    await settle();
    expect(handle.state.disclosure).toBe(EVERY_2ND);

    // A build with no decimation clears it, again without lagging a build behind.
    await emitBuild(handle, 1, 12);
    expect(log.slice(4)).toEqual(['build 12', 'disclosure ']);

    await act(async () => root?.unmount());
    host.remove();
  });
});

describe('live-state side channel (#430)', () => {
  it('reads the registered reader each call, and refuses an unregistered object', () => {
    const handle = {};
    let n = 0;
    registerLiveState(handle, () => ({ disclosure: `call ${++n}` }) as never);
    expect(readLiveState(handle).disclosure).toBe('call 1');
    expect(readLiveState(handle).disclosure).toBe('call 2');
    expect(() => readLiveState({})).toThrow('readLiveState: not a useGcodePreview handle');
  });
});
