// @vitest-environment happy-dom
/**
 * #520: the connect pass for the four 3D-only construction attributes. 2D applies a non-default value once
 * per connect (and the 2D renderer reports it); an explicit default asks for nothing. 3D was built with them,
 * so it must not re-apply: a re-applied quality rebuilds when the parse finished before three.js loaded.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { ToolpathRenderer } from '@chestnutlabs/gcode-renderer-three';
import { type GcodePreviewElement, defineGcodePreview } from '../index';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

const make = (attrs: Record<string, string>): { el: GcodePreviewElement; log: string[] } => {
  defineGcodePreview();
  const log: string[] = [];
  const canvas = document.createElement('canvas');
  const el = document.createElement('gcode-preview') as GcodePreviewElement;
  el.createWorker = () => new SuiteStubWorker();
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.rendererOptions = { createRenderer: () => makeSuiteStubGL(canvas), scheduleFrame: (f) => f() };
  el.addEventListener('renderer-unsupported', (e) => {
    const d = (e as CustomEvent<{ feature: string; message: string }>).detail;
    log.push(`${d.feature} ${d.message}`);
  });
  return { el, log };
};

const QUALITY = 'quality Quality/geometry modes apply only to the 3D renderer; the 2D view has none.';
const CAMERA = 'camera Camera projection applies only to the 3D renderer; the 2D view is flat top-down.';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('element <gcode-preview> 3D-only attributes at connect (#520)', () => {
  it('2D: explicit defaults report nothing', async () => {
    const { el, log } = make({ renderer: '2d', quality: 'auto', 'camera-mode': 'perspective', 'camera-fov': '50' });
    document.body.appendChild(el);
    await settle();
    expect(JSON.stringify(log)).toBe('[]');
    el.remove();
  });

  it('2D: a non-default quality and camera-mode each report once per connect', async () => {
    const { el, log } = make({ renderer: '2d', quality: 'tubes', 'camera-mode': 'orthographic' });
    document.body.appendChild(el);
    await settle();
    expect(JSON.stringify(log)).toBe(JSON.stringify([QUALITY, CAMERA]));
    el.remove();
    document.body.appendChild(el);
    await settle();
    expect(JSON.stringify(log)).toBe(JSON.stringify([QUALITY, CAMERA, QUALITY, CAMERA]));
    el.remove();
  });

  it('3D: the connect pass re-applies none of the construction attributes (no extra build)', async () => {
    const calls: string[] = [];
    for (const k of ['setQuality', 'setCameraMode', 'setCameraFov', 'setPixelRatio'] as const) {
      vi.spyOn(ToolpathRenderer.prototype, k).mockImplementation(function (this: unknown) {
        calls.push(k);
      });
    }
    const { el } = make({ quality: 'lines', 'camera-mode': 'orthographic', 'camera-fov': '32', 'pixel-ratio': '2' });
    document.body.appendChild(el);
    await settle();
    expect(JSON.stringify(calls)).toBe('[]');
    el.remove();
  });
});
