// @vitest-environment happy-dom
/**
 * `createModelPreviewController` sweep: option pass-through to the engine, canvas size tracking and teardown,
 * rebind/dispose behaviour, live vs queued setters, state mirroring (placement, progress, instancing).
 * Headless: stub GL + stub controls; literal expected values.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3, type Camera, type Scene } from 'three';
import type { ControlsLike, GLRendererLike, RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';
import { studioTheme } from '@chestnutlabs/gcode-renderer-three';
import { createModelPreviewController, INITIAL_MODEL_STATE } from '../model-preview.js';
import type { ModelLoader } from '../loaders.js';
import { IDENTITY_MAT4, type ModelScene } from '../scene-model.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubControls(camera: PerspectiveCamera | { position: Vector3 }) {
  const listeners: Record<string, (() => void)[]> = {};
  const c = {
    object: camera,
    target: new Vector3(),
    enabled: true,
    update: () => c.fire('change'),
    dispose: () => undefined,
    addEventListener: (t: string, cb: () => void) => {
      (listeners[t] ??= []).push(cb);
    },
    listenToKeyEvents: () => undefined,
    fire: (t: string) => (listeners[t] ?? []).forEach((cb) => cb())
  };
  return c as unknown as ControlsLike & { fire(t: string): void };
}

/** A canvas whose CSS box can be changed. */
function sizedCanvas(w = 800, h = 600) {
  const box = { w, h };
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, get: () => box.w });
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, get: () => box.h });
  return { canvas, box };
}

function box3(positions: number[], bounds: { min: number[]; max: number[] }, z = 0): ModelScene {
  return {
    objects: [{ id: 'a', geometry: { positions: new Float32Array(positions) }, transform: IDENTITY_MAT4 }],
    bounds: {
      min: [bounds.min[0], bounds.min[1], bounds.min[2] + z],
      max: [bounds.max[0], bounds.max[1], bounds.max[2] + z]
    },
    capabilities: {
      materials: 'unavailable',
      transforms: 'unavailable',
      multiObject: 'unavailable',
      instanced: 'unavailable',
      plates: 'unavailable'
    }
  };
}
const TRI = (): ModelScene => box3([0, 0, 0, 10, 0, 0, 0, 10, 5], { min: [0, 0, 0], max: [10, 10, 5] });

interface Rig {
  sizes: Array<{ canvas: unknown; w: number; h: number }>;
  scene: () => Scene;
  camera: () => Camera;
  createControlsCalls: Camera[];
  glCount: () => number;
}

function rig(options: Parameters<typeof createModelPreviewController>[0] = {}) {
  const sizes: Rig['sizes'] = [];
  const createControlsCalls: Camera[] = [];
  let scene: Scene | null = null;
  let camera: Camera | null = null;
  let glCount = 0;
  let controls: ReturnType<typeof stubControls> | null = null;
  const c = createModelPreviewController({
    createRenderer: (canvas): GLRendererLike => {
      glCount++;
      return {
        render: (s, cam) => {
          scene = s;
          camera = cam;
        },
        setSize: (w: number, h: number) => {
          sizes.push({ canvas, w, h });
        },
        dispose: () => undefined,
        domElement: canvas as never
      } as GLRendererLike;
    },
    createControls: (cam) => {
      createControlsCalls.push(cam as Camera);
      controls = stubControls(cam as PerspectiveCamera);
      return controls;
    },
    ...options
  });
  return {
    c,
    controls: () => controls!,
    sizes,
    scene: () => scene!,
    camera: () => camera!,
    createControlsCalls,
    glCount: () => glCount
  };
}

const ready = async (r: ReturnType<typeof rig>, src: ModelScene = TRI()) => {
  const { canvas } = sizedCanvas();
  r.c.bindCanvas(canvas);
  await r.c.controls.setSource(src);
  return canvas;
};

describe('option pass-through to the engine', () => {
  it('limits and the filament palette reach the loader', async () => {
    const seen: Array<{ limits: unknown; opts: unknown }> = [];
    const loader: ModelLoader = {
      kind: 'stl',
      parse: (_b, limits, opts) => {
        seen.push({ limits, opts });
        return TRI();
      }
    };
    const r = rig({
      loaders: [loader],
      limits: { maxTriangles: 7 },
      filamentPalette: ['#ff0000', undefined]
    });
    r.c.bindCanvas(sizedCanvas().canvas);
    await r.c.controls.setSource({ kind: 'stl', bytes: new Uint8Array(1) });
    expect(seen).toEqual([{ limits: { maxTriangles: 7 }, opts: { filamentPalette: ['#ff0000', undefined] } }]);
    r.c.dispose();
  });

  it('createControls is called with the camera, and cameraMode picks the camera type', async () => {
    const persp = rig();
    await ready(persp);
    expect(persp.createControlsCalls).toHaveLength(1);
    expect((persp.camera() as PerspectiveCamera).isPerspectiveCamera).toBe(true);
    persp.c.dispose();

    const ortho = rig({ cameraMode: 'orthographic' });
    await ready(ortho);
    expect((ortho.camera() as { isOrthographicCamera?: boolean }).isOrthographicCamera).toBe(true);
    ortho.c.dispose();
  });

  it('onProgress reaches the consumer and is mirrored into state.progress, ending at stage ready', async () => {
    const stages: string[] = [];
    const r = rig({ onProgress: (p) => stages.push(p.stage) });
    await ready(r);
    expect(stages.length).toBeGreaterThan(0);
    expect(stages[stages.length - 1]).toBe('ready');
    expect(r.c.getState().progress?.stage).toBe('ready');
    expect(r.c.getState().loading).toBe(false);
    r.c.dispose();
  });
});

describe('live setters reach a bound engine immediately', () => {
  it('setTheme and setCameraFov change what the engine draws, with no rebind', async () => {
    const r = rig();
    await ready(r);
    expect(r.scene().background).toBeNull();
    r.c.controls.setTheme(studioTheme('dark'));
    expect(r.scene().background?.constructor.name).toBe('DataTexture');
    r.c.controls.setCameraFov(32);
    expect((r.camera() as PerspectiveCamera).fov).toBe(32);
    r.c.dispose();
  });

  it('capture goes to the live engine with its options, and resolves with its Blob', async () => {
    const r = rig();
    await ready(r);
    const blob = new Blob(['x']);
    const spy = vi.spyOn(r.c.raw.viewer()!, 'capture').mockResolvedValue(blob);
    await expect(r.c.controls.capture({ width: 64, height: 32 })).resolves.toBe(blob);
    expect(spy).toHaveBeenCalledWith({ width: 64, height: 32 });
    r.c.dispose();
  });

  it('getCameraState falls back to the last known state once the canvas is detached', async () => {
    const r = rig();
    await ready(r);
    expect(r.c.getState().cameraState).toBeNull(); // no user gesture yet
    r.controls().fire('end'); // the user finishes a gesture → camera-changed
    const last = r.c.getState().cameraState;
    expect(last).not.toBeNull();
    r.c.bindCanvas(null);
    expect(r.c.controls.getCameraState()).toEqual(last);
    r.c.dispose();
  });
});

describe('canvas size tracking', () => {
  class FakeRO {
    static instances: FakeRO[] = [];
    observed: unknown[] = [];
    disconnected = 0;
    constructor(public cb: () => void) {
      FakeRO.instances.push(this);
    }
    observe(t: unknown) {
      this.observed.push(t);
    }
    disconnect() {
      this.disconnected++;
    }
  }
  const lastSize = (r: ReturnType<typeof rig>, canvas: unknown) => r.sizes.filter((s) => s.canvas === canvas).at(-1);

  it('fits the CSS box on bind, follows ResizeObserver and window resize, and ignores a zero-sized box', () => {
    FakeRO.instances = [];
    vi.stubGlobal('ResizeObserver', FakeRO);
    const r = rig();
    const { canvas, box } = sizedCanvas(800, 600);
    r.c.bindCanvas(canvas);
    expect(lastSize(r, canvas)).toMatchObject({ w: 800, h: 600 });
    expect(FakeRO.instances).toHaveLength(1);
    expect(FakeRO.instances[0].observed).toEqual([canvas]);

    box.w = 400;
    box.h = 300;
    FakeRO.instances[0].cb();
    expect(lastSize(r, canvas)).toMatchObject({ w: 400, h: 300 });

    box.w = 640;
    box.h = 480;
    window.dispatchEvent(new Event('resize'));
    expect(lastSize(r, canvas)).toMatchObject({ w: 640, h: 480 });
    r.c.dispose();
  });

  it('replacing the canvas stops tracking the old one (observer disconnected, window listener removed)', () => {
    FakeRO.instances = [];
    vi.stubGlobal('ResizeObserver', FakeRO);
    const removed = vi.spyOn(window, 'removeEventListener');
    const r = rig();
    const a = sizedCanvas(800, 600);
    r.c.bindCanvas(a.canvas);
    const b = sizedCanvas(500, 500);
    r.c.bindCanvas(b.canvas);
    expect(FakeRO.instances[0].disconnected).toBe(1);
    expect(removed.mock.calls.filter((c) => c[0] === 'resize')).toHaveLength(1);

    const before = r.sizes.length;
    a.box.w = 111;
    a.box.h = 222;
    window.dispatchEvent(new Event('resize')); // only the new canvas follows now
    expect(r.sizes.slice(before).every((s) => s.canvas === b.canvas)).toBe(true);
    r.c.dispose();
  });

  it('dispose detaches the observer and the window listener', () => {
    FakeRO.instances = [];
    vi.stubGlobal('ResizeObserver', FakeRO);
    const removed = vi.spyOn(window, 'removeEventListener');
    const r = rig();
    r.c.bindCanvas(sizedCanvas().canvas);
    r.c.dispose();
    expect(FakeRO.instances[0].disconnected).toBe(1);
    expect(removed.mock.calls.filter((c) => c[0] === 'resize')).toHaveLength(1);
  });

  it('a canvas that is not a DOM element (an OffscreenCanvas-like) is not tracked at all', () => {
    FakeRO.instances = [];
    vi.stubGlobal('ResizeObserver', FakeRO);
    const added = vi.spyOn(window, 'addEventListener');
    const r = rig();
    r.c.bindCanvas({ width: 10, height: 10 } as unknown as RenderTargetCanvas);
    expect(FakeRO.instances).toHaveLength(0);
    expect(added.mock.calls.filter((c) => c[0] === 'resize')).toHaveLength(0);
    r.c.dispose();
  });
});

describe('bind, rebind and dispose', () => {
  it('bindCanvas after dispose does nothing', () => {
    const r = rig();
    r.c.dispose();
    r.c.bindCanvas(sizedCanvas().canvas);
    expect(r.c.raw.viewer()).toBeNull();
    expect(r.glCount()).toBe(0);
  });

  it('ops queued before the first bind run once: a later rebind does not replay them', () => {
    const r = rig();
    r.c.controls.resize(200, 100);
    const a = sizedCanvas(800, 600);
    r.c.bindCanvas(a.canvas);
    expect(r.sizes.filter((s) => s.canvas === a.canvas).at(-1)).toMatchObject({ w: 200, h: 100 });
    const b = sizedCanvas(800, 600);
    r.c.bindCanvas(b.canvas);
    expect(r.sizes.filter((s) => s.canvas === b.canvas).at(-1)).toMatchObject({ w: 800, h: 600 });
    r.c.dispose();
  });

  it('a rebind replays the last source and reports loading again until it is ready', async () => {
    const r = rig();
    await ready(r);
    expect(r.c.getState().loading).toBe(false);
    const seen: boolean[] = [];
    r.c.onStateChange((s) => seen.push(s.loading));
    r.c.bindCanvas(sizedCanvas().canvas);
    expect(r.c.getState().loading).toBe(true);
    expect(r.c.getState().error).toBeNull();
    await new Promise((res) => setTimeout(res, 0));
    expect(r.c.getState().loading).toBe(false);
    expect(r.c.getState().ready).toBe(true);
    expect(seen[0]).toBe(true);
    r.c.dispose();
  });

  it('a rebind clears the previous error the moment the replay starts', async () => {
    let calls = 0;
    const flaky: ModelLoader = {
      kind: 'stl',
      parse: () => {
        if (calls++ === 0) throw new Error('first parse fails');
        return TRI();
      }
    };
    const r = rig({ loaders: [flaky] });
    r.c.bindCanvas(sizedCanvas().canvas);
    await expect(r.c.controls.setSource({ kind: 'stl', bytes: new Uint8Array(1) })).rejects.toThrow();
    expect(r.c.getState().error).not.toBeNull();
    r.c.bindCanvas(sizedCanvas().canvas); // replays the same source; this time it parses
    expect(r.c.getState().error).toBeNull();
    expect(r.c.getState().loading).toBe(true);
    await new Promise((res) => setTimeout(res, 0));
    expect(r.c.getState().ready).toBe(true);
    r.c.dispose();
  });

  it('a setSource made before the canvas binds settles with the replayed load, and rejects if the replay fails', async () => {
    const bad: ModelLoader = {
      kind: 'stl',
      parse: () => {
        throw new Error('boom');
      }
    };
    const r = rig({ loaders: [bad] });
    const pending = r.c.controls.setSource({ kind: 'stl', bytes: new Uint8Array(1) });
    r.c.bindCanvas(sizedCanvas().canvas);
    await expect(pending).rejects.toThrow('boom');
    r.c.dispose();
  });

  it('dispose rejects a still-waiting setSource and clears queued ops', async () => {
    const r = rig();
    const pending = r.c.controls.setSource({ kind: 'stl', bytes: new Uint8Array(1) });
    r.c.dispose();
    await expect(pending).rejects.toThrow('E_MODEL_PREVIEW_DISPOSED');
    await expect(r.c.controls.setSource(TRI())).rejects.toThrow('E_MODEL_PREVIEW_DISPOSED');
  });

  it('state listeners and event listeners can unsubscribe', async () => {
    const r = rig();
    const states: unknown[] = [];
    const events: unknown[] = [];
    const offS = r.c.onStateChange((s) => states.push(s));
    const offE = r.c.onEvent((e) => events.push(e));
    offS();
    offE();
    await ready(r);
    expect(states).toHaveLength(0);
    expect(events).toHaveLength(0);
    r.c.dispose();
  });
});

describe('state mirroring', () => {
  it('starts from the documented initial state', () => {
    expect(INITIAL_MODEL_STATE).toEqual({
      loading: false,
      ready: false,
      rendererSupported: true,
      objectCount: 0,
      materials: 'unavailable',
      instancedCount: 0,
      decimationApplied: 1,
      bounds: null,
      plates: null,
      hasPlates: false,
      placement: null,
      placementOffset: null,
      cameraState: null,
      progress: null,
      error: null
    });
  });

  it('ready copies the engine disclosure: instancedCount 1 and decimationApplied 1 for one object', async () => {
    const r = rig();
    await ready(r);
    const s = r.c.getState();
    expect(s.instancedCount).toBe(1);
    expect(s.decimationApplied).toBe(1);
    expect(s.objectCount).toBe(1);
    expect(s.bounds).toEqual({ min: [0, 0, 0], max: [10, 10, 5] });
    r.c.dispose();
  });

  it('setBuildVolume refreshes the offset when only one axis changes (x, then y)', async () => {
    const r = rig({ buildVolume: { x: 100, y: 100, z: 50 } });
    await ready(r);
    expect(r.c.getState().placementOffset).toEqual({ x: 45, y: 45, z: 0 });
    r.c.controls.setBuildVolume({ x: 110, y: 100, z: 50 });
    expect(r.c.getState().placementOffset).toEqual({ x: 50, y: 45, z: 0 });
    r.c.controls.setBuildVolume({ x: 110, y: 120, z: 50 });
    expect(r.c.getState().placementOffset).toEqual({ x: 50, y: 55, z: 0 });
    r.c.dispose();
  });

  it('setRenderScope refreshes the offset when only z changes', async () => {
    // Two objects with the same footprint, 3 mm and 1 mm below the bed: dropped to z = 0 by 3 and 1.
    const two: ModelScene = {
      objects: [
        {
          id: 'low',
          geometry: { positions: new Float32Array([0, 0, -3, 10, 0, -3, 0, 10, -3]) },
          transform: IDENTITY_MAT4
        },
        {
          id: 'high',
          geometry: { positions: new Float32Array([0, 0, -1, 10, 0, -1, 0, 10, -1]) },
          transform: IDENTITY_MAT4
        }
      ],
      bounds: { min: [0, 0, -3], max: [10, 10, -1] },
      capabilities: {
        materials: 'unavailable',
        transforms: 'unavailable',
        multiObject: 'known',
        instanced: 'unavailable',
        plates: 'unavailable'
      }
    };
    const r = rig({ buildVolume: { x: 100, y: 100, z: 50 } });
    await ready(r, two);
    r.c.controls.setRenderScope({ objectIds: ['low'] });
    expect(r.c.getState().placementOffset).toEqual({ x: 45, y: 45, z: 3 });
    r.c.controls.setRenderScope({ objectIds: ['high'] });
    expect(r.c.getState().placementOffset).toEqual({ x: 45, y: 45, z: 1 });
    r.c.dispose();
  });

  it('the placement label is refreshed even when the offset is identical (known → approximated at {0,0,0})', async () => {
    const s: ModelScene = {
      ...box3([100, 100, 0, 110, 100, 0, 100, 110, 5], { min: [100, 100, 0], max: [110, 110, 5] }),
      source: { slicerProject: 'bambu-orca' }
    };
    const r = rig({ buildVolume: { x: 256, y: 256, z: 256 } });
    await ready(r, s);
    expect(r.c.getState().placement).toBe('known');
    expect(r.c.getState().placementOffset).toEqual({ x: 0, y: 0, z: 0 });
    // A bed that does not contain the part but is centred on it: centring changes nothing, the label does.
    r.c.controls.setBuildVolume({ x: 4, y: 4, z: 50, min: { x: 103, y: 103 } } as never);
    expect(r.c.getState().placement).toBe('approximated');
    expect(r.c.getState().placementOffset).toEqual({ x: 0, y: 0, z: 0 });
    r.c.dispose();
  });
});
