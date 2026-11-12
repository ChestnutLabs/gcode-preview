// @vitest-environment happy-dom
/**
 * Renderer-three sweep PR 2 — colour-mode validation (checkColorMode from gcode-colors) in the constructor and
 * setColorMode, plus the public worker-message export. Literal expectations only.
 */
import { describe, expect, it } from 'vitest';
import { ToolpathRenderer, handleGeometryMessage, type GLRendererLike } from '../index.js';
import * as pkg from '../index.js';

const stub = (canvas: HTMLCanvasElement): GLRendererLike =>
  ({
    render: () => undefined,
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: canvas
  }) as unknown as GLRendererLike;

const make = (colorMode?: unknown) => {
  const canvas = document.createElement('canvas');
  return new ToolpathRenderer({
    canvas,
    quality: 'lines',
    colorMode: colorMode as never,
    createRenderer: () => stub(canvas)
  });
};

const bad = [
  { mode: 'feedrate', ramp: [[0, 0, 0]], range: [2000, 1000], fallback: [0, 0, 0] },
  { mode: 'layerHeight', ramp: [[0, 0, 0]], range: [-1, 5], fallback: [0, 0, 0] },
  { mode: 'object', palette: [[0, 0, 0]], fallback: [0, 0, 0], only: 0 }
];

describe('colour-mode validation', () => {
  for (const m of bad) {
    it(`constructor rejects ${JSON.stringify(m)}`, () => {
      expect(() => make(m)).toThrow(RangeError);
    });
    it(`setColorMode rejects ${JSON.stringify(m)} and keeps the previous mode`, () => {
      const r = make({ mode: 'single', color: [0.1, 0.2, 0.3] });
      const before = (r as unknown as { colorMode: unknown }).colorMode;
      expect(() => r.setColorMode(m as never)).toThrow(RangeError);
      expect((r as unknown as { colorMode: unknown }).colorMode).toBe(before);
      r.dispose();
    });
  }

  it('a valid mode is accepted (control)', () => {
    const r = make({ mode: 'single', color: [0.1, 0.2, 0.3] });
    expect(r.setColorMode({ mode: 'single', color: [0.4, 0.5, 0.6] })).toBe(true);
    r.dispose();
  });
});

describe('worker message export', () => {
  it('handleGeometryMessage is public and returns an id-tagged error for a bad request', () => {
    expect(typeof pkg.handleGeometryRequest).toBe('function');
    const out = handleGeometryMessage({ id: 7, positions: new ArrayBuffer(24), count: 1, radialSegments: 1 } as never);
    expect(out.transfer).toEqual([]);
    expect((out.response as { id: number }).id).toBe(7);
    expect(typeof (out.response as { error: string }).error).toBe('string');
  });
});
