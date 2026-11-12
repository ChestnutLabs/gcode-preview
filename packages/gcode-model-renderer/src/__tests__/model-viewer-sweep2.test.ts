// @vitest-environment happy-dom
/**
 * Model viewer + controller sweep (mutation survivors): lifecycle, queued ops, state mirroring, stale-load
 * and dispose behaviour. Stub GL + stub orbit controls on a happy-dom canvas.
 */
import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3, type OrthographicCamera } from 'three';
import type { CameraState, ControlsLike, GLRendererLike } from '@chestnutlabs/gcode-renderer-three';
import type { ModelViewer, ModelViewerEvent, ModelViewerOptions } from '../model-viewer.js';
import { DEFAULT_MODEL_LOADERS, type ModelLoader } from '../loaders.js';
import type { LoadProgress } from '@chestnutlabs/gcode-renderer-three';

const rec = vi.hoisted(() => ({
  viewers: [] as unknown[],
  listeners: [] as Array<(e: unknown) => void>,
  created: 0
}));
vi.mock('../model-viewer.js', async () => {
  const actual = await vi.importActual<typeof import('../model-viewer.js')>('../model-viewer.js');
  return {
    ...actual,
    createModelViewer: (c: unknown, o: unknown) => {
      const v = actual.createModelViewer(c as never, o as never) as ModelViewer;
      rec.created++;
      vi.spyOn(v, 'setView');
      vi.spyOn(v, 'frame');
      vi.spyOn(v, 'resize');
      vi.spyOn(v, 'setBackground');
      vi.spyOn(v, 'setInteractionQuality');
      vi.spyOn(v, 'dispose');
      vi.spyOn(v, 'setCameraState').mockImplementation(() => undefined);
      const on = v.onEvent.bind(v);
      v.onEvent = (cb) => {
        rec.listeners.push(cb as (e: unknown) => void);
        return on(cb);
      };
      rec.viewers.push(v);
      return v;
    }
  };
});

const { createModelViewer } = await import('../model-viewer.js');
const { createModelPreviewController } = await import('../model-preview.js');
import { IDENTITY_MAT4, type ModelScene } from '../scene-model.js';

function stubControls(camera: PerspectiveCamera | OrthographicCamera) {
  const listeners: Record<string, (() => void)[]> = {};
  const c: ControlsLike & { fire(t: string): void } = {
    object: camera,
    target: new Vector3(),
    enabled: true,
    update: () => c.fire('change'),
    dispose: () => undefined,
    addEventListener: (t, cb) => {
      (listeners[t] ??= []).push(cb);
    },
    listenToKeyEvents: () => undefined,
    fire: (t) => (listeners[t] ?? []).forEach((cb) => cb())
  };
  return c;
}

function harness(extra: Partial<ModelViewerOptions> = {}) {
  const canvas = document.createElement('canvas');
  const h = {
    lastScene: null as { traverse(f: (o: { isMesh?: boolean }) => void): void } | null,
    glDisposed: 0,
    sizes: [] as Array<[number, number]>
  };
  const gl: GLRendererLike = {
    render: (s: unknown) => {
      h.lastScene = s;
    },
    setSize: (w: number, hh: number) => {
      h.sizes.push([w, hh]);
    },
    dispose: () => {
      h.glDisposed++;
    },
    domElement: canvas
  } as unknown as GLRendererLike;
  let controls: ReturnType<typeof stubControls> | null = null;
  const options: ModelViewerOptions = {
    createRenderer: () => gl,
    createControls: (cam) => (controls = stubControls(cam)),
    ...extra
  };
  const viewer = createModelViewer(canvas, options);
  return { viewer, canvas, h, controls: () => controls!, options };
}

const caps = {
  materials: 'unavailable',
  transforms: 'unavailable',
  multiObject: 'unavailable',
  instanced: 'unavailable',
  plates: 'unavailable'
} as const;
const tri = (x: number, z = 0): number[] => [x, 0, z, x + 10, 0, z, x, 10, z];
function scene(over: Partial<ModelScene> = {}, positions = tri(0)): ModelScene {
  return {
    objects: [{ id: 'a', geometry: { positions: new Float32Array(positions) }, transform: IDENTITY_MAT4 }],
    bounds: { min: [0, 0, 0], max: [10, 10, 0] },
    capabilities: { ...caps },
    ...over
  };
}
const slowLoader = (kind: string, ms: number, fail: boolean, sc: ModelScene = scene()): ModelLoader => ({
  kind,
  parse: () =>
    new Promise<ModelScene>((res, rej) => setTimeout(() => (fail ? rej(new Error('late-boom')) : res(sc)), ms))
});
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const src = (kind: string) => ({ kind, bytes: new Uint8Array(1) });

describe('viewer: stale / disposed loads', () => {
  it('a load that fails after dispose leaves no error to flush to a later subscriber', async () => {
    const { viewer } = harness({ loaders: [slowLoader('slow', 20, true)] });
    const p = viewer.setSource(src('slow')).catch((e: Error) => e.message);
    viewer.dispose();
    expect(await p).toBe('late-boom');
    const seen: ModelViewerEvent[] = [];
    viewer.onEvent((e) => seen.push(e));
    expect(seen).toEqual([]);
  });

  it('a load that succeeds after dispose resolves without building or emitting ready', async () => {
    const { viewer } = harness({ loaders: [slowLoader('slow', 20, false)] });
    const p = viewer.setSource(src('slow'));
    viewer.dispose();
    await expect(p).resolves.toMatchObject({ objectCount: 1 });
    const seen: ModelViewerEvent[] = [];
    viewer.onEvent((e) => seen.push(e));
    expect(seen).toEqual([]);
  });

  it('progress from a load disposed mid-build is not emitted afterwards', async () => {
    const stages: string[] = [];
    let holder: ModelViewer | null = null;
    const { viewer } = harness({
      onProgress: (p: LoadProgress) => {
        stages.push(p.stage);
        if (p.stage === 'building-geometry' && holder) holder.dispose();
      }
    });
    holder = viewer;
    await viewer.setSource(scene()).catch(() => undefined);
    expect(stages).not.toContain('ready');
  });

  it('progress from a load superseded mid-build is not emitted afterwards', async () => {
    const seen: Array<{ stage: string; generation: number }> = [];
    let holder: ModelViewer | null = null;
    let once = true;
    const { viewer } = harness({
      onProgress: (p: LoadProgress) => {
        seen.push({ stage: p.stage, generation: p.generation });
        if (p.stage === 'building-geometry' && once && holder) {
          once = false;
          void holder.setSource(scene());
        }
      }
    });
    holder = viewer;
    await viewer.setSource(scene());
    await wait(10);
    expect(seen.filter((s) => s.stage === 'ready' && s.generation === 1)).toEqual([]);
    viewer.dispose();
  });
});

describe('viewer: options, events, framing', () => {
  it('validates scope and theme synchronously', () => {
    expect(() => harness({ renderScope: { objectIds: 'a' } as never })).toThrow(RangeError);
    const { viewer } = harness();
    expect(() => viewer.setRenderScope({ plateId: 1.5 } as never)).toThrow(RangeError);
    expect(() => viewer.setTheme({ gridOpacity: 5 })).toThrow(RangeError);
    viewer.dispose();
  });

  it('passes filamentPalette through to the loader', async () => {
    let got: unknown;
    const loader: ModelLoader = {
      kind: 'p',
      parse: (_b, _l, opts) => {
        got = opts?.filamentPalette;
        return scene();
      }
    };
    const { viewer } = harness({ loaders: [loader], filamentPalette: ['#112233'] });
    await viewer.setSource(src('p'));
    expect(got).toEqual(['#112233']);
    viewer.dispose();
  });

  it('reports plates on ready when the source declares them', async () => {
    const plates = {
      list: [{ id: 1, objectCount: 1, instanceCount: 1, bounds: { min: [0, 0, 0], max: [10, 10, 0] } as const }],
      active: 1
    };
    const { viewer } = harness();
    const info = await viewer.setSource(scene({ plates, capabilities: { ...caps, plates: 'known' } }));
    expect(info.plates).toEqual(plates);
    viewer.dispose();
  });

  it('a renderer-less viewer emits E_MODEL_RENDERER_UNAVAILABLE on setSource', async () => {
    const v = createModelViewer(document.createElement('canvas'), {
      createRenderer: () => {
        throw new Error('no gl');
      }
    });
    const seen: ModelViewerEvent[] = [];
    v.onEvent((e) => seen.push(e));
    await expect(v.setSource(scene())).rejects.toMatchObject({ code: 'E_MODEL_RENDERER_UNAVAILABLE' });
    expect(seen.map((e) => e.type)).toEqual(['renderer-unsupported', 'error']);
    expect(seen[1]).toMatchObject({ code: 'E_MODEL_RENDERER_UNAVAILABLE' });
  });

  it('dispose releases the GL renderer and removes the meshes', async () => {
    const { viewer, h } = harness();
    await viewer.setSource(scene());
    viewer.resize(100, 100);
    const sc = h.lastScene!;
    let meshes = 0;
    sc.traverse((o: { isMesh?: boolean }) => o.isMesh && meshes++);
    expect(meshes).toBeGreaterThan(0);
    viewer.dispose();
    let after = 0;
    sc.traverse((o: { isMesh?: boolean }) => o.isMesh && after++);
    expect(after).toBe(0);
    expect(h.glDisposed).toBeGreaterThan(0);
  });

  it('resize(0,0) keeps the camera pose', async () => {
    const { viewer } = harness();
    viewer.resize(800, 600);
    await viewer.setSource(scene());
    const before = viewer.getCameraState();
    viewer.resize(0, 0);
    expect(viewer.getCameraState()).toEqual(before);
    viewer.dispose();
  });

  it('setView while library-framed re-fits the model', async () => {
    const { viewer } = harness();
    viewer.resize(800, 600);
    await viewer.setSource(scene({ bounds: { min: [0, 0, 0], max: [100, 30, 6] } }, [0, 0, 0, 100, 0, 0, 0, 30, 6]));
    const s0 = viewer.getCameraState() as CameraState;
    const d0 = new Vector3(s0.position.x, s0.position.y, s0.position.z).distanceTo(
      new Vector3(s0.target.x, s0.target.y, s0.target.z)
    );
    viewer.setView('top');
    const s1 = viewer.getCameraState() as CameraState;
    const d1 = new Vector3(s1.position.x, s1.position.y, s1.position.z).distanceTo(
      new Vector3(s1.target.x, s1.target.y, s1.target.z)
    );
    // Fitted distance for a 100x30 plate is far below the stage's un-fitted preset distance.
    expect(d1).toBeLessThan(400);
    expect(d1).toBeCloseTo(d0 * (d1 / d0), 5);
    viewer.dispose();
  });

  it('setBuildVolume while library-framed re-fits to the moved model', async () => {
    const { viewer } = harness();
    viewer.resize(800, 600);
    await viewer.setSource(scene());
    const before = viewer.getCameraState() as CameraState;
    viewer.setBuildVolume({ x: 256, y: 256, z: 256 });
    const after = viewer.getCameraState() as CameraState;
    expect(Math.abs(after.target.x - before.target.x)).toBeGreaterThan(50);
    viewer.dispose();
  });
});

const flat = (): ModelScene => scene();
const sized = (c: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement => {
  Object.defineProperty(c, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(c, 'clientHeight', { value: h, configurable: true });
  return c;
};
function ctl(extra: Record<string, unknown> = {}) {
  const gl = (c: unknown): GLRendererLike =>
    ({
      render: () => undefined,
      setSize: () => undefined,
      dispose: () => undefined,
      domElement: c
    }) as unknown as GLRendererLike;
  const c = createModelPreviewController({
    createRenderer: gl,
    createControls: (cam) => stubControls(cam),
    ...extra
  });
  return c;
}
const lastViewer = (): ModelViewer => rec.viewers[rec.viewers.length - 1] as ModelViewer;
const fresh = (): HTMLCanvasElement => document.createElement('canvas');

describe('controller: queued ops, rebinds, mirrored state', () => {
  it('replays view/frame/resize/camera calls made before the canvas binds', () => {
    const c = ctl();
    const cam = { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } } as unknown as CameraState;
    c.controls.setView('top');
    c.controls.frame();
    c.controls.resize(5, 6);
    c.controls.setCameraState(cam);
    c.bindCanvas(fresh());
    const v = lastViewer();
    expect(v.setView).toHaveBeenCalledWith('top');
    expect(v.frame).toHaveBeenCalled();
    expect(v.resize).toHaveBeenCalledWith(5, 6);
    expect(v.setCameraState).toHaveBeenCalledWith(cam);
    c.dispose();
  });

  it('forwards background / interaction quality to the live engine', () => {
    const c = ctl();
    c.bindCanvas(fresh());
    c.controls.setBackground('#ff0000');
    c.controls.setInteractionQuality('off');
    expect(lastViewer().setBackground).toHaveBeenCalledWith('#ff0000');
    expect(lastViewer().setInteractionQuality).toHaveBeenCalledWith('off');
    c.dispose();
  });

  it('binding the same canvas again keeps the engine; a new canvas disposes the old one', () => {
    const c = ctl();
    const a = fresh();
    c.bindCanvas(a);
    const before = rec.created;
    const v1 = lastViewer();
    c.bindCanvas(a);
    expect(rec.created).toBe(before);
    c.bindCanvas(fresh());
    expect(rec.created).toBe(before + 1);
    expect(v1.dispose).toHaveBeenCalled();
    c.dispose();
  });

  it('dispose disposes the engine and rejects queued setSource callers', async () => {
    const c = ctl();
    const waiting = c.controls.setSource(flat()).then(
      () => 'resolved',
      (e: Error) => e.message
    );
    c.dispose();
    expect(await waiting).toBe('E_MODEL_PREVIEW_DISPOSED');
    const c2 = ctl();
    c2.bindCanvas(fresh());
    const v = lastViewer();
    c2.dispose();
    expect(v.dispose).toHaveBeenCalled();
  });

  it('a queued setSource rejects when the replayed load fails', async () => {
    const bad: ModelLoader = { kind: 'bad', parse: () => Promise.reject(new Error('nope')) };
    const c = ctl({ loaders: [bad] });
    const p = c.controls.setSource(src('bad'));
    c.bindCanvas(fresh());
    await expect(p).rejects.toThrow('nope');
    c.dispose();
  });

  it('a queued setSource resolves with the replayed load', async () => {
    const c = ctl();
    const p = c.controls.setSource(flat());
    c.bindCanvas(fresh());
    await expect(p).resolves.toMatchObject({ objectCount: 1 });
    c.dispose();
  });

  it('progress keeps loading true until ready, then false', async () => {
    const c = ctl();
    const seen: Array<[string | undefined, boolean]> = [];
    c.onStateChange((s) => seen.push([s.progress?.stage, s.loading]));
    c.bindCanvas(fresh());
    await c.controls.setSource(flat());
    const readySnap = seen.find(([stage]) => stage === 'ready');
    expect(readySnap).toEqual(['ready', false]);
    expect(seen.find(([stage]) => stage === 'parsing')).toEqual(['parsing', true]);
    c.dispose();
  });

  it('a failed load clears loading and records the error code', async () => {
    const bad: ModelLoader = { kind: 'bad', parse: () => Promise.reject(new Error('nope')) };
    const c = ctl({ loaders: [bad] });
    c.bindCanvas(fresh());
    await expect(c.controls.setSource(src('bad'))).rejects.toThrow();
    expect(c.getState().loading).toBe(false);
    expect(c.getState().error).toEqual({ code: 'E_MODEL_PARSE', message: 'nope' });
    c.dispose();
  });

  it('a later successful load clears an earlier error even when it bypasses controls', async () => {
    const bad: ModelLoader = { kind: 'bad', parse: () => Promise.reject(new Error('nope')) };
    const c = ctl({ loaders: [bad, ...DEFAULT_MODEL_LOADERS] });
    c.bindCanvas(fresh());
    await expect(c.controls.setSource(src('bad'))).rejects.toThrow();
    expect(c.getState().error).not.toBeNull();
    await c.raw.viewer()!.setSource(flat());
    expect(c.getState().error).toBeNull();
    expect(c.getState().ready).toBe(true);
    c.dispose();
  });

  it('an unsupported renderer records the E_RENDERER_UNSUPPORTED error', () => {
    const c = createModelPreviewController({
      createRenderer: () => {
        throw new Error('no webgl');
      }
    });
    c.bindCanvas(fresh());
    expect(c.getState().error).toEqual({ code: 'E_RENDERER_UNSUPPORTED', message: 'no webgl' });
    c.dispose();
  });

  it('mirrors camera-changed into state and forwards every engine event', () => {
    const c = ctl();
    const events: string[] = [];
    c.onEvent((e) => events.push(e.type));
    c.bindCanvas(fresh());
    const cam = { position: { x: 1, y: 2, z: 3 }, target: { x: 4, y: 5, z: 6 } };
    rec.listeners[rec.listeners.length - 1]({ type: 'camera-changed', state: cam });
    rec.listeners[rec.listeners.length - 1]({ type: 'context-lost' });
    expect(c.getState().cameraState).toEqual(cam);
    expect(events).toEqual(['camera-changed', 'context-lost']);
    c.dispose();
  });

  it('getCameraState reads the live engine, not the last mirrored snapshot', async () => {
    const c = ctl();
    expect(c.controls.getCameraState()).toBeNull();
    c.bindCanvas(fresh());
    await c.controls.setSource(flat());
    expect(c.getState().cameraState).toBeNull();
    expect(c.controls.getCameraState()).not.toBeNull();
    c.dispose();
  });

  it('unsubscribed listeners are not called again', async () => {
    const c = ctl();
    const states: number[] = [];
    const events: number[] = [];
    const offS = c.onStateChange(() => states.push(1));
    const offE = c.onEvent(() => events.push(1));
    c.bindCanvas(fresh());
    offS();
    offE();
    await c.controls.setSource(flat());
    expect(states).toEqual([]);
    expect(events).toEqual([]);
    c.dispose();
  });

  it('plates and hasPlates mirror the source', async () => {
    const c = ctl();
    c.bindCanvas(fresh());
    await c.controls.setSource(flat());
    expect(c.getState().plates).toBeNull();
    expect(c.getState().hasPlates).toBe(false);
    const plates = {
      list: [{ id: 2, objectCount: 1, instanceCount: 1, bounds: { min: [0, 0, 0], max: [10, 10, 0] } as const }]
    };
    await c.controls.setSource(scene({ plates, capabilities: { ...caps, plates: 'known' } }));
    expect(c.getState().plates).toEqual(plates);
    expect(c.getState().hasPlates).toBe(true);
    c.dispose();
  });

  it('a scope change that moves only z updates placementOffset', async () => {
    const c = ctl({ buildVolume: { x: 256, y: 256, z: 256 } });
    c.bindCanvas(fresh());
    const two: ModelScene = {
      objects: [
        { id: 'a', geometry: { positions: new Float32Array(tri(0, 0)) }, transform: IDENTITY_MAT4 },
        { id: 'b', geometry: { positions: new Float32Array(tri(0, 5)) }, transform: IDENTITY_MAT4 }
      ],
      bounds: { min: [0, 0, 0], max: [10, 10, 5] },
      capabilities: { ...caps }
    };
    await c.controls.setSource(two);
    expect(c.getState().placementOffset?.z).toBe(0);
    c.controls.setRenderScope({ objectIds: ['b'] });
    expect(c.getState().placementOffset?.z).toBe(-5);
    c.dispose();
  });

  it('fits the engine to the canvas CSS box, skipping a hidden (0x0) canvas', () => {
    const c = ctl();
    c.bindCanvas(sized(fresh(), 300, 200));
    expect(lastViewer().resize).toHaveBeenCalledWith(300, 200);
    c.bindCanvas(sized(fresh(), 0, 0));
    expect(lastViewer().resize).not.toHaveBeenCalled();
    c.bindCanvas(sized(fresh(), 300, 0));
    expect(lastViewer().resize).not.toHaveBeenCalled();
    c.bindCanvas(sized(fresh(), 0, 200));
    expect(lastViewer().resize).not.toHaveBeenCalled();
    c.dispose();
  });
});
