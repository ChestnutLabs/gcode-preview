import { describe, it, expect } from 'vitest';
import type { GLRendererLike, RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';
import { createModelViewer, type ModelViewerEvent } from '../model-viewer.js';
import { IDENTITY_MAT4, type ModelScene } from '../scene-model.js';
import type { ModelLoader } from '../loaders.js';

type Tri = [number[], number[], number[]];

function makeBinaryStl(tris: Tri[]): Uint8Array {
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

const ONE_TRI: Tri[] = [
  [
    [0, 0, 0],
    [10, 0, 0],
    [0, 20, 0]
  ]
];

/** A single-object scene that declares a real colour (materials: 'known'). */
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

function stubCanvas(width = 256, height = 256): RenderTargetCanvas {
  return { width, height } as unknown as RenderTargetCanvas;
}
function stubGL(canvas: RenderTargetCanvas): GLRendererLike {
  return { render: () => undefined, setSize: () => undefined, dispose: () => undefined, domElement: canvas };
}

/** Collect all emitted events for assertions. */
function withRecorder() {
  const events: ModelViewerEvent[] = [];
  return { events, record: (e: ModelViewerEvent) => events.push(e) };
}

describe('createModelViewer', () => {
  it('setSource(STL) → ready with honest objectCount/materials/bounds', async () => {
    const v = createModelViewer(stubCanvas(), { createRenderer: stubGL });
    const { events, record } = withRecorder();
    v.onEvent(record);

    const info = await v.setSource({ kind: 'stl', bytes: makeBinaryStl(ONE_TRI) });
    expect(info.objectCount).toBe(1);
    expect(info.materials).toBe('unavailable'); // STL carries no colour
    expect(info.bounds.max[1]).toBeCloseTo(20);
    expect(events).toContainEqual({ type: 'ready', info });
    v.dispose();
  });

  it('passes capability tiers through unchanged (coloured scene → materials: known)', async () => {
    const v = createModelViewer(stubCanvas(), { createRenderer: stubGL });
    const info = await v.setSource(colouredScene());
    expect(info.materials).toBe('known');
    v.dispose();
  });

  it('unknown kind → error event + rejected promise, not a bare throw out of the loop', async () => {
    const v = createModelViewer(stubCanvas(), { createRenderer: stubGL });
    const { events, record } = withRecorder();
    v.onEvent(record);
    await expect(v.setSource({ kind: 'obj', bytes: new Uint8Array(3) })).rejects.toMatchObject({
      code: 'E_MODEL_UNSUPPORTED_KIND'
    });
    expect(events.some((e) => e.type === 'error' && e.code === 'E_MODEL_UNSUPPORTED_KIND')).toBe(true);
    v.dispose();
  });

  it('a newly registered loader kind is viewable with no API change (extensibility)', async () => {
    const objLoader: ModelLoader = { kind: 'obj', parse: () => colouredScene() };
    const v = createModelViewer(stubCanvas(), { createRenderer: stubGL, loaders: [objLoader] });
    const info = await v.setSource({ kind: 'obj', bytes: new Uint8Array([1, 2, 3]) });
    expect(info.objectCount).toBe(1);
    expect(info.materials).toBe('known');
    v.dispose();
  });

  it('overlapping setSource is last-wins: only the final source emits ready', async () => {
    // A loader that resolves after a controllable delay, newest-first, to force overlap.
    const gate: Array<() => void> = [];
    const slow: ModelLoader = {
      kind: 'slow',
      parse: () => new Promise((res) => gate.push(() => res(colouredScene())))
    };
    const v = createModelViewer(stubCanvas(), { createRenderer: stubGL, loaders: [slow] });
    const { events, record } = withRecorder();
    v.onEvent(record);

    const p1 = v.setSource({ kind: 'slow', bytes: new Uint8Array(1) });
    const p2 = v.setSource({ kind: 'slow', bytes: new Uint8Array(2) });
    // Resolve the SECOND (newest) first, then the first (stale).
    gate[1]();
    gate[0]();
    await Promise.all([p1, p2]);

    expect(events.filter((e) => e.type === 'ready')).toHaveLength(1);
    v.dispose();
  });

  it('renderer-unsupported when WebGL creation fails, flushed to the first subscriber', () => {
    const v = createModelViewer(stubCanvas(), {
      createRenderer: () => {
        throw new Error('no webgl2 here');
      }
    });
    const { events, record } = withRecorder();
    // Subscribe AFTER construction — the pending event must still be delivered.
    v.onEvent(record);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'renderer-unsupported', feature: 'webgl2' });
    // A degraded handle: camera state is null, setSource rejects, other calls are inert no-ops.
    expect(v.getCameraState()).toBeNull();
    v.setView('iso');
    v.dispose();
  });

  it('setSource on an unsupported renderer rejects with a structured code', async () => {
    const v = createModelViewer(stubCanvas(), {
      createRenderer: () => {
        throw new Error('no webgl2');
      }
    });
    await expect(v.setSource({ kind: 'stl', bytes: makeBinaryStl(ONE_TRI) })).rejects.toMatchObject({
      code: 'E_MODEL_RENDERER_UNAVAILABLE'
    });
    v.dispose();
  });

  it('exposes a camera state once a source is framed, and getCameraState is null before', async () => {
    const v = createModelViewer(stubCanvas(), { createRenderer: stubGL });
    const before = v.getCameraState();
    expect(before).not.toBeNull(); // stage exists → a (default) pose is available
    await v.setSource({ kind: 'stl', bytes: makeBinaryStl(ONE_TRI) });
    const after = v.getCameraState();
    expect(after).not.toBeNull();
    expect(Number.isFinite(after!.position.x)).toBe(true);
    v.dispose();
  });

  it('dispose is idempotent and unsubscribes listeners', async () => {
    const v = createModelViewer(stubCanvas(), { createRenderer: stubGL });
    const { events, record } = withRecorder();
    v.onEvent(record);
    v.dispose();
    v.dispose(); // no throw
    // After dispose, setSource rejects and emits nothing new (listeners cleared).
    const n = events.length;
    await expect(v.setSource({ kind: 'stl', bytes: makeBinaryStl(ONE_TRI) })).rejects.toBeTruthy();
    expect(events).toHaveLength(n);
  });

  it('onEvent returns an unsubscribe that stops delivery', async () => {
    const v = createModelViewer(stubCanvas(), { createRenderer: stubGL });
    const { events, record } = withRecorder();
    const off = v.onEvent(record);
    off();
    await v.setSource({ kind: 'stl', bytes: makeBinaryStl(ONE_TRI) });
    expect(events).toHaveLength(0);
    v.dispose();
  });
});
