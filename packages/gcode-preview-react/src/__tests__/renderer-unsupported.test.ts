// @vitest-environment happy-dom
/**
 * #520: the mount pass for the four 3D-only construction props. 2D applies a non-default value once (and the
 * 2D renderer reports it); an explicit default asks for nothing. 3D was built with them, so it must not
 * re-apply: a re-applied quality rebuilds when the parse finished before three.js loaded.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { ToolpathRenderer } from '@chestnutlabs/gcode-renderer-three';
import { GcodePreview } from '../index';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const QUALITY = 'quality Quality/geometry modes apply only to the 3D renderer; the 2D view has none.';
const CAMERA = 'camera Camera projection applies only to the 3D renderer; the 2D view is flat top-down.';

const mount = async (extra: Record<string, unknown>): Promise<{ log: string[]; unmount: () => Promise<void> }> => {
  const log: string[] = [];
  const canvas = document.createElement('canvas');
  const host = document.body.appendChild(document.createElement('div'));
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      createElement(GcodePreview, {
        source: null,
        createWorker: () => new SuiteStubWorker(),
        rendererOptions: { createRenderer: () => makeSuiteStubGL(canvas), scheduleFrame: (f: () => void) => f() },
        onRendererUnsupported: (e) => log.push(`${e.feature} ${e.message}`),
        ...extra
      })
    );
  });
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  });
  return {
    log,
    unmount: async () => {
      await act(async () => root?.unmount());
      host.remove();
    }
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('react <GcodePreview> 3D-only props at mount (#520)', () => {
  it('2D: explicit defaults report nothing', async () => {
    const m = await mount({ renderer: '2d', quality: 'auto', cameraMode: 'perspective', cameraFov: 50 });
    expect(JSON.stringify(m.log)).toBe('[]');
    await m.unmount();
  });

  it('2D: a non-default quality and camera mode each report once, in prop order', async () => {
    const m = await mount({ renderer: '2d', quality: 'tubes', cameraMode: 'orthographic' });
    expect(JSON.stringify(m.log)).toBe(JSON.stringify([QUALITY, CAMERA]));
    await m.unmount();
  });

  it('3D: the mount pass re-applies none of the construction props (no extra build)', async () => {
    const calls: string[] = [];
    for (const k of ['setQuality', 'setCameraMode', 'setCameraFov', 'setPixelRatio'] as const) {
      vi.spyOn(ToolpathRenderer.prototype, k).mockImplementation(function (this: unknown) {
        calls.push(k);
      });
    }
    const m = await mount({ quality: 'lines', cameraMode: 'orthographic', cameraFov: 32, pixelRatio: 2 });
    // pixelRatio is not a construction option in React, so its mount value is applied once, as before #520.
    expect(JSON.stringify(calls)).toBe('["setPixelRatio"]');
    await m.unmount();
  });
});
