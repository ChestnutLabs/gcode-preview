// @vitest-environment happy-dom
/**
 * #520: the mount pass for the four 3D-only construction props. 2D applies a non-default value once (and the
 * 2D renderer reports it); an explicit default asks for nothing. 3D was built with them, so it must not
 * re-apply: a re-applied quality rebuilds when the parse finished before three.js loaded.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { ToolpathRenderer } from '@chestnutlabs/gcode-renderer-three';
import { GcodePreview } from '../index';

const mount = async (extra: Record<string, unknown>): Promise<{ log: string[]; unmount: () => void }> => {
  const log: string[] = [];
  const canvas = document.createElement('canvas');
  const container = document.body.appendChild(document.createElement('div'));
  const app = createApp(
    defineComponent({
      setup: () => () =>
        h(GcodePreview, {
          createWorker: () => new SuiteStubWorker(),
          rendererOptions: { createRenderer: () => makeSuiteStubGL(canvas), scheduleFrame: (f: () => void) => f() },
          onRendererUnsupported: (e: { feature: string; message: string }) => log.push(`${e.feature} ${e.message}`),
          ...extra
        })
    })
  );
  app.mount(container);
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  await nextTick();
  return {
    log,
    unmount: () => {
      app.unmount();
      container.remove();
    }
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('vue <GcodePreview> 3D-only props at mount (#520)', () => {
  it('2D: explicit defaults report nothing', async () => {
    const m = await mount({ renderer: '2d', quality: 'auto', cameraMode: 'perspective', cameraFov: 50 });
    expect(JSON.stringify(m.log)).toBe('[]');
    m.unmount();
  });

  it('2D: a non-default quality and camera mode each report once, in prop order', async () => {
    const m = await mount({ renderer: '2d', quality: 'tubes', cameraMode: 'orthographic' });
    expect(JSON.stringify(m.log)).toBe(
      JSON.stringify([
        'quality Quality/geometry modes apply only to the 3D renderer; the 2D view has none.',
        'camera Camera projection applies only to the 3D renderer; the 2D view is flat top-down.'
      ])
    );
    m.unmount();
  });

  it('3D: the mount pass re-applies none of the construction props (no extra build)', async () => {
    const calls: string[] = [];
    for (const k of ['setQuality', 'setCameraMode', 'setCameraFov', 'setPixelRatio'] as const) {
      vi.spyOn(ToolpathRenderer.prototype, k).mockImplementation(function (this: unknown) {
        calls.push(k);
      });
    }
    const m = await mount({ quality: 'lines', cameraMode: 'orthographic', cameraFov: 32, pixelRatio: 2 });
    expect(JSON.stringify(calls)).toBe('[]');
    m.unmount();
  });
});
