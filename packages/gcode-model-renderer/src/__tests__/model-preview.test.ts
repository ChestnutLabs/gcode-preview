import { describe, it, expect } from 'vitest';
import type { GLRendererLike, RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';
import { createModelPreviewController } from '../model-preview.js';
import { IDENTITY_MAT4, type ModelScene } from '../scene-model.js';

function makeBinaryStl(): Uint8Array {
  const tris = [
    [
      [0, 0, 0],
      [10, 0, 0],
      [0, 20, 0]
    ]
  ];
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const t of tris) {
    o += 12;
    for (const v of t) {
      dv.setFloat32(o, v[0], true);
      dv.setFloat32(o + 4, v[1], true);
      dv.setFloat32(o + 8, v[2], true);
      o += 12;
    }
    o += 2;
  }
  return new Uint8Array(buf);
}

function colouredScene(): ModelScene {
  return {
    objects: [
      {
        id: 'a',
        geometry: { positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]) },
        transform: IDENTITY_MAT4,
        material: { color: [1, 0, 0] }
      }
    ],
    bounds: { min: [0, 0, 0], max: [10, 10, 0] },
    capabilities: { materials: 'known', transforms: 'unavailable', multiObject: 'unavailable' }
  };
}

const stubCanvas = (): RenderTargetCanvas => ({ width: 256, height: 256 }) as unknown as RenderTargetCanvas;
const stubGL = (canvas: RenderTargetCanvas): GLRendererLike => ({
  render: () => undefined,
  setSize: () => undefined,
  dispose: () => undefined,
  domElement: canvas
});

describe('createModelPreviewController (DD-031)', () => {
  it('starts inert with an honest initial state before a canvas binds', () => {
    const c = createModelPreviewController({ createRenderer: stubGL });
    const s = c.getState();
    expect(s.ready).toBe(false);
    expect(s.loading).toBe(false);
    expect(s.rendererSupported).toBe(true);
    expect(s.objectCount).toBe(0);
    expect(s.materials).toBe('unavailable');
    expect(c.raw.viewer()).toBeNull();
    c.dispose();
  });

  it('bindCanvas → setSource(STL) drives ready state + a state-change notification', async () => {
    const c = createModelPreviewController({ createRenderer: stubGL });
    const seen: boolean[] = [];
    c.onStateChange((s) => seen.push(s.ready));
    c.bindCanvas(stubCanvas());
    const info = await c.controls.setSource({ kind: 'stl', bytes: makeBinaryStl() });
    expect(info.objectCount).toBe(1);
    const s = c.getState();
    expect(s.ready).toBe(true);
    expect(s.loading).toBe(false);
    expect(s.objectCount).toBe(1);
    expect(s.materials).toBe('unavailable'); // STL carries no colour — honest
    expect(s.bounds?.max[1]).toBeCloseTo(20);
    expect(seen).toContain(true); // onStateChange fired with ready
    c.dispose();
  });

  it('passes capability tiers through unchanged (coloured scene → materials: known)', async () => {
    const c = createModelPreviewController({ createRenderer: stubGL });
    c.bindCanvas(stubCanvas());
    await c.controls.setSource(colouredScene());
    expect(c.getState().materials).toBe('known');
    c.dispose();
  });

  it('setSource issued BEFORE bindCanvas is queued and settles after the canvas binds', async () => {
    const c = createModelPreviewController({ createRenderer: stubGL });
    const pending = c.controls.setSource({ kind: 'stl', bytes: makeBinaryStl() });
    expect(c.getState().loading).toBe(true); // optimistic loading before the engine exists
    c.bindCanvas(stubCanvas());
    const info = await pending;
    expect(info.objectCount).toBe(1);
    expect(c.getState().ready).toBe(true);
    c.dispose();
  });

  it('forwards engine events through onEvent (ready)', async () => {
    const c = createModelPreviewController({ createRenderer: stubGL });
    const types: string[] = [];
    c.onEvent((e) => types.push(e.type));
    c.bindCanvas(stubCanvas());
    await c.controls.setSource(colouredScene());
    expect(types).toContain('ready');
    c.dispose();
  });

  it('an unsupported renderer marks state.rendererSupported false (fall back to a still)', () => {
    const c = createModelPreviewController({
      createRenderer: () => {
        throw new Error('no webgl');
      }
    });
    c.bindCanvas(stubCanvas());
    expect(c.getState().rendererSupported).toBe(false);
    c.dispose();
  });

  it('capture before a canvas binds rejects rather than throwing', async () => {
    const c = createModelPreviewController({ createRenderer: stubGL });
    await expect(c.controls.capture()).rejects.toThrow(/E_CAPTURE_UNSUPPORTED/);
    c.dispose();
  });

  it('rebinding a new canvas replays the last source so the model survives a remount', async () => {
    const c = createModelPreviewController({ createRenderer: stubGL });
    c.bindCanvas(stubCanvas());
    await c.controls.setSource(colouredScene());
    expect(c.getState().ready).toBe(true);
    // Simulate a remount: detach then attach a fresh canvas.
    c.bindCanvas(null);
    c.bindCanvas(stubCanvas());
    // The source is replayed; wait a microtask-ish for the async load.
    await new Promise((r) => setTimeout(r, 0));
    expect(c.getState().ready).toBe(true);
    expect(c.getState().objectCount).toBe(1);
    c.dispose();
  });
});
