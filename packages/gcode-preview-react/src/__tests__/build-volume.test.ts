// @vitest-environment happy-dom
/**
 * `<GcodePreview buildVolume>` after mount (DD-031 parity with Vue's `watch` and Svelte's `$:`, #274): a plain
 * `BuildVolumeDef` is an init-time renderer option, and a LATER change must re-apply it, the same as a
 * `MachineGeometry` does. Read off the renderer's own `buildVolume`, with literal expected values.
 */
import { describe, expect, it } from 'vitest';
import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { GcodePreview, type GcodePreviewHandle } from '../index';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

async function mountWith(buildVolume: unknown) {
  const canvas = document.createElement('canvas');
  const ref = createRef<GcodePreviewHandle>();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (bv: unknown) =>
    act(async () => {
      root.render(
        createElement(GcodePreview, {
          ref,
          source: new Uint8Array(1_000),
          quality: 'lines',
          buildVolume: bv as never,
          createWorker: () => new SuiteStubWorker(),
          rendererOptions: { createRenderer: () => makeSuiteStubGL(canvas), scheduleFrame: (cb: () => void) => cb() }
        })
      );
    });
  await render(buildVolume);
  await settle();
  return {
    render,
    volume: () => JSON.stringify((ref.current?.raw.renderer() as unknown as { volumeDef: unknown }).volumeDef),
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    }
  };
}

describe('<GcodePreview buildVolume> after mount (react)', () => {
  it('a plain BuildVolumeDef set at mount is used, and a later change re-applies it', async () => {
    const m = await mountWith({ x: 200, y: 210, z: 220 });
    const first = m.volume();
    expect(first).toContain('200');
    await m.render({ x: 300, y: 310, z: 320 });
    await settle();
    expect(m.volume()).toContain('300');
    expect(m.volume()).not.toBe(first);
    // Back to the first value is a change again (the applied value tracks the last one, not the mount one).
    await m.render({ x: 200, y: 210, z: 220 });
    await settle();
    expect(m.volume()).toBe('{"x":200,"y":210,"z":220}');
    await m.unmount();
  });
});
