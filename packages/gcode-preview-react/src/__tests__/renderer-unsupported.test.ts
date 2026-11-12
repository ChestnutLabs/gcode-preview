// @vitest-environment happy-dom
/**
 * #520: the mount pass for the four 3D-only construction props. 2D applies a non-default value once (and the
 * 2D renderer reports it); an explicit default asks for nothing. 3D was built with them, so it must not
 * re-apply: a re-applied quality rebuilds when the parse finished before three.js loaded.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { ToolpathRenderer, type GLRendererLike } from '@chestnutlabs/gcode-renderer-three';
import { GcodePreview } from '../index';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const QUALITY = 'quality Quality/geometry modes apply only to the 3D renderer; the 2D view has none.';
const CAMERA = 'camera Camera projection applies only to the 3D renderer; the 2D view is flat top-down.';
const LENS = 'camera The camera lens applies only to the 3D renderer; the 2D view is flat top-down.';
const RATIO = 'quality The pixel ratio applies only to the 3D renderer; the 2D view keeps its own resolution.';

const mount = async (
  extra: Record<string, unknown>,
  opts: { strict?: boolean; gl?: (canvas: HTMLCanvasElement) => GLRendererLike } = {}
): Promise<{ log: string[]; unmount: () => Promise<void> }> => {
  const log: string[] = [];
  const canvas = document.createElement('canvas');
  const host = document.body.appendChild(document.createElement('div'));
  const gl = opts.gl ?? makeSuiteStubGL;
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    const el = createElement(GcodePreview, {
      source: null,
      createWorker: () => new SuiteStubWorker(),
      rendererOptions: { createRenderer: () => gl(canvas), scheduleFrame: (f: () => void) => f() },
      onRendererUnsupported: (e) => log.push(`${e.feature} ${e.message}`),
      ...extra
    });
    root.render(opts.strict === true ? createElement(StrictMode, null, el) : el);
  });
  await act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
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
    expect(JSON.stringify(calls)).toBe('[]');
    await m.unmount();
  });

  it('3D: an unset pixelRatio is not a construction value (the renderer keeps its own ratio)', async () => {
    const ratios: number[] = [];
    const m = await mount(
      {},
      {
        gl: (canvas) => ({
          ...makeSuiteStubGL(canvas),
          getPixelRatio: () => 3,
          setPixelRatio: (r: number) => ratios.push(r)
        })
      }
    );
    expect(JSON.stringify(ratios)).toBe('[]');
    await m.unmount();
  });
});

describe('react <GcodePreview> 3D-only props at mount under StrictMode (#534)', () => {
  it('3D: the mount pixelRatio reaches the live renderer exactly once', async () => {
    // StrictMode disposes the first controller before three.js loads, so only the second builds a renderer.
    const glRatios: number[][] = [];
    const m = await mount(
      { pixelRatio: 2 },
      {
        strict: true,
        gl: (canvas) => {
          const ratios: number[] = [];
          glRatios.push(ratios);
          return { ...makeSuiteStubGL(canvas), setPixelRatio: (r: number) => ratios.push(r) };
        }
      }
    );
    expect(JSON.stringify(glRatios)).toBe('[[2]]');
    await m.unmount();
  });

  it('2D: each non-default mount prop reports exactly once', async () => {
    const m = await mount(
      { renderer: '2d', quality: 'tubes', cameraMode: 'orthographic', cameraFov: 30, pixelRatio: 2 },
      { strict: true }
    );
    expect(JSON.stringify(m.log)).toBe(JSON.stringify([QUALITY, CAMERA, LENS, RATIO]));
    await m.unmount();
  });
});
