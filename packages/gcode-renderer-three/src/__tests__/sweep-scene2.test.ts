// @vitest-environment happy-dom
/**
 * Renderer-three sweep PR 2 — ToolpathRenderer: build-volume hiding during capture, and progressivePreview
 * validation. Literal expectations only.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer, type GLRendererLike, type RendererEvent } from '../index.js';

function slice(): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  for (let s = 0; s < 3; s++) {
    b.addSegment({
      x0: 100 + s,
      y0: 100,
      z0: 0.2,
      x1: 101 + s,
      y1: 100,
      z1: 0.2,
      e: 1,
      kind: MoveKind.Extrude,
      layer: 0,
      srcByte: s * 10
    });
  }
  return b.finalize();
}

function makeRenderer(
  opts: { throwInTarget?: boolean; noVolume?: boolean; progressivePreview?: 'lines' | 'hold' | 'off' } = {}
) {
  const canvas = document.createElement('canvas');
  let inTarget = false;
  const volumeAtRender: (boolean | null)[] = []; // volume visibility at each render, tagged live/target below
  const liveVolume: boolean[] = [];
  // eslint-disable-next-line prefer-const
  let renderer!: ToolpathRenderer;
  const vol = () => (renderer as unknown as { volumeGroup: { visible: boolean } | null }).volumeGroup;
  const stub: GLRendererLike & { setRenderTarget: (t: unknown) => void; readRenderTargetPixels: () => void } = {
    render: () => {
      if (inTarget) {
        volumeAtRender.push(vol()?.visible ?? null);
        if (opts.throwInTarget) throw new Error('render boom');
      } else if (renderer !== undefined) {
        liveVolume.push(vol()?.visible ?? true);
      }
    },
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: canvas,
    setRenderTarget: (t) => {
      inTarget = t !== null;
    },
    readRenderTargetPixels: () => undefined
  };
  const events: RendererEvent[] = [];
  renderer = new ToolpathRenderer({
    canvas,
    quality: 'lines',
    buildVolume: opts.noVolume ? undefined : { x: 220, y: 220, z: 250 },
    progressivePreview: opts.progressivePreview,
    createRenderer: () => stub as unknown as GLRendererLike,
    scheduleFrame: () => undefined
  });
  renderer.onEvent((e) => events.push(e));
  return { renderer, events, vol, volumeAtRender, liveVolume };
}

describe('ToolpathRenderer.capture — build volume is hidden only for the render-to-target', () => {
  it('is visible again synchronously after capture() is called, not after the async encode', () => {
    const h = makeRenderer();
    const p = h.renderer.capture({ includeBuildVolume: false, background: 'transparent' });
    expect(h.volumeAtRender).toEqual([false]); // hidden while rendering into the target
    expect(h.vol()!.visible).toBe(true); // …and back before capture() returned its promise
    return p.catch(() => undefined);
  });

  it('two overlapping includeBuildVolume:false captures leave the volume visible', async () => {
    const h = makeRenderer();
    const a = h.renderer.capture({ includeBuildVolume: false });
    const b = h.renderer.capture({ includeBuildVolume: false });
    await Promise.allSettled([a, b]);
    expect(h.volumeAtRender).toEqual([false, false]);
    expect(h.vol()!.visible).toBe(true);
  });

  it('a default capture overlapping a hidden-volume one still includes the volume', async () => {
    const h = makeRenderer();
    const a = h.renderer.capture({ includeBuildVolume: false });
    const b = h.renderer.capture();
    await Promise.allSettled([a, b]);
    expect(h.volumeAtRender).toEqual([false, true]);
  });

  it('a volume the consumer had already hidden stays hidden after a hidden-volume capture', async () => {
    const h = makeRenderer();
    h.vol()!.visible = false;
    await h.renderer.capture({ includeBuildVolume: false }).catch(() => undefined);
    expect(h.volumeAtRender).toEqual([false]);
    expect(h.vol()!.visible).toBe(false);
  });

  it('with no build volume at all, includeBuildVolume:false still renders the capture', async () => {
    const h = makeRenderer({ noVolume: true });
    expect(h.vol()).toBeNull();
    await h.renderer.capture({ includeBuildVolume: false }).catch(() => undefined);
    expect(h.volumeAtRender).toEqual([null]); // one render-to-target happened, with no volume to read
  });

  it('a throw in the render restores the volume', async () => {
    const h = makeRenderer({ throwInTarget: true });
    await expect(h.renderer.capture({ includeBuildVolume: false })).rejects.toThrow('render boom');
    expect(h.vol()!.visible).toBe(true);
  });

  it('a rejected option (RangeError) never touches the volume', async () => {
    const h = makeRenderer();
    await expect(h.renderer.capture({ includeBuildVolume: false, width: NaN })).rejects.toBeInstanceOf(RangeError);
    expect(h.volumeAtRender).toEqual([]);
    expect(h.vol()!.visible).toBe(true);
  });

  it('the live repaint after capture sees the volume restored', async () => {
    const h = makeRenderer();
    h.liveVolume.length = 0;
    await h.renderer.capture({ includeBuildVolume: false }).catch(() => undefined);
    expect(h.liveVolume.at(-1)).toBe(true);
    expect(h.liveVolume.includes(false)).toBe(false);
  });
});

describe('progressivePreview validation', () => {
  it('the constructor throws RangeError for an unknown mode', () => {
    expect(() => makeRenderer({ progressivePreview: 'fast' as never })).toThrow(
      "progressivePreview must be 'auto', 'lines', 'hold' or 'off' (got fast)"
    );
  });

  it('setProgressivePreview throws synchronously and the previous mode stays', () => {
    const h = makeRenderer({ progressivePreview: 'off' });
    expect(() => h.renderer.setProgressivePreview('nope' as never)).toThrow(RangeError);
    expect(() => h.renderer.setProgressivePreview(undefined as never)).toThrow(RangeError);
    h.renderer.appendPartial(slice());
    expect(h.events.some((e) => e.type === 'previewAppend')).toBe(false); // still 'off'
    expect(h.renderer.chunkMeshes.length).toBe(0);
  });

  it("every valid mode is accepted (control): 'lines' streams, 'hold' reports but builds nothing", () => {
    for (const mode of ['auto', 'lines', 'hold', 'off'] as const) {
      const h = makeRenderer();
      expect(() => h.renderer.setProgressivePreview(mode)).not.toThrow();
    }
    const lines = makeRenderer();
    lines.renderer.setProgressivePreview('lines');
    lines.renderer.appendPartial(slice());
    expect(lines.events.filter((e) => e.type === 'previewAppend').length).toBe(1);
    expect(lines.renderer.chunkMeshes.length).toBeGreaterThan(0);
    const hold = makeRenderer();
    hold.renderer.setProgressivePreview('hold');
    hold.renderer.appendPartial(slice());
    expect(hold.events.filter((e) => e.type === 'previewAppend').length).toBe(1);
    expect(hold.renderer.chunkMeshes.length).toBe(0);
  });
});
