// @vitest-environment happy-dom
/**
 * Model-viewer framing: the first frame / Reset view fit the model's bounding box to the canvas aspect
 * and FOV, the viewer re-fits on resize until the user moves the camera, and zero STL facet normals are
 * repaired (they lit black). Headless: stub GL + stub orbit controls on a happy-dom canvas, with the
 * camera reconstructed from `getCameraState()` (the stage's perspective FOV is 50°).
 */
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3, type OrthographicCamera } from 'three';
import type { CameraState, ControlsLike, GLRendererLike } from '@chestnutlabs/gcode-renderer-three';
import { createModelViewer } from '../model-viewer.js';
import { createModelPreviewController } from '../model-preview.js';
import { parseStl, repairFacetNormals } from '../stl.js';
import { IDENTITY_MAT4, type ModelScene } from '../scene-model.js';

function stubControls(camera: PerspectiveCamera | OrthographicCamera) {
  const listeners: Record<string, (() => void)[]> = {};
  const c: ControlsLike & { fire(t: string): void } = {
    object: camera,
    target: new Vector3(),
    enabled: true,
    // Like OrbitControls, a programmatic update() emits `change` — the stage must not read it as a user move.
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

function makeViewer() {
  const canvas = document.createElement('canvas');
  const gl: GLRendererLike = {
    render: () => undefined,
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: canvas
  };
  let controls: ReturnType<typeof stubControls> | null = null;
  const viewer = createModelViewer(canvas, {
    createRenderer: () => gl,
    createControls: (cam) => (controls = stubControls(cam))
  });
  return { viewer, controls: () => controls! };
}

/** A box-shaped scene (model coords, Z-up) — only the bounds matter for framing. */
function boxScene(sx: number, sy: number, sz: number): ModelScene {
  return {
    objects: [
      {
        id: 'box',
        geometry: { positions: new Float32Array([0, 0, 0, sx, 0, 0, 0, sy, sz]) },
        transform: IDENTITY_MAT4
      }
    ],
    bounds: { min: [0, 0, 0], max: [sx, sy, sz] },
    capabilities: { materials: 'unavailable', transforms: 'unavailable', multiObject: 'unavailable' }
  };
}

/** Max |NDC| over the box corners for the given camera state + aspect → ≤ 1 means fully on screen. */
function ndcExtent(
  state: CameraState,
  aspect: number,
  scene: ModelScene
): { x: number; y: number; cx: number; cy: number } {
  const cam = new PerspectiveCamera(50, aspect, 0.1, 10000);
  cam.position.set(state.position.x, state.position.y, state.position.z);
  const target = new Vector3(state.target.x, state.target.y, state.target.z);
  const dir = cam.position.clone().sub(target).normalize();
  cam.up.set(...((Math.abs(dir.y) > 0.999 ? [0, 0, -1] : [0, 1, 0]) as [number, number, number]));
  cam.lookAt(target);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  const [minX, minY, minZ] = scene.bounds.min;
  const [maxX, maxY, maxZ] = scene.bounds.max;
  let x = 0;
  let y = 0;
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const mx = i & 1 ? maxX : minX;
    const my = i & 2 ? maxY : minY;
    const mz = i & 4 ? maxZ : minZ;
    const p = new Vector3(mx, mz, -my).project(cam); // model Z-up → scene Y-up
    x = Math.max(x, Math.abs(p.x));
    y = Math.max(y, Math.abs(p.y));
    lo[0] = Math.min(lo[0], p.x);
    lo[1] = Math.min(lo[1], p.y);
    hi[0] = Math.max(hi[0], p.x);
    hi[1] = Math.max(hi[1], p.y);
  }
  return { x, y, cx: (lo[0] + hi[0]) / 2, cy: (lo[1] + hi[1]) / 2 };
}

const PLATE = boxScene(100, 30, 6); // wide, flat parametric part

describe('model viewer framing', () => {
  it.each([
    ['wide', 1200, 400],
    ['square', 640, 640],
    ['narrow (375 px tab)', 375, 700]
  ])('first frame fits a wide flat model inside a %s canvas, with a small margin', async (_n, w, h) => {
    const { viewer } = makeViewer();
    viewer.resize(w, h);
    await viewer.setSource(PLATE);
    const e = ndcExtent(viewer.getCameraState()!, w / h, PLATE);
    expect(Math.max(e.x, e.y)).toBeLessThanOrEqual(1);
    // Tight, not a loose bounding-sphere pose: the limiting axis fills the canvas up to the 1.1 margin.
    expect(Math.max(e.x, e.y)).toBeCloseTo(1 / 1.1, 2);
    // Centred: the projected box is not pushed to one side by perspective.
    expect(Math.abs(e.cx)).toBeLessThan(0.03);
    expect(Math.abs(e.cy)).toBeLessThan(0.03);
    viewer.dispose();
  });

  it('re-fits on resize until the user moves the camera, then keeps their view', async () => {
    const { viewer, controls } = makeViewer();
    viewer.resize(1200, 400);
    await viewer.setSource(PLATE);
    viewer.resize(375, 700); // sidebar/Preview-tab resize → re-framed for the new aspect
    const fitted = ndcExtent(viewer.getCameraState()!, 375 / 700, PLATE);
    expect(Math.max(fitted.x, fitted.y)).toBeLessThanOrEqual(1);
    expect(Math.max(fitted.x, fitted.y)).toBeGreaterThan(0.8);

    controls().fire('start'); // a bare click (start, no camera change) is not a user move
    viewer.resize(800, 700);
    const stillFitted = ndcExtent(viewer.getCameraState()!, 800 / 700, PLATE);
    expect(Math.max(stillFitted.x, stillFitted.y)).toBeCloseTo(1 / 1.1, 2);

    controls().fire('change'); // user orbit/zoom/pan (pointer, wheel, touch or keyboard) moves the camera
    const before = viewer.getCameraState()!;
    viewer.resize(1200, 400);
    expect(viewer.getCameraState()!.position).toEqual(before.position);

    viewer.frame(); // Reset view → fitted again, and auto-framing resumes
    viewer.resize(640, 640);
    const after = ndcExtent(viewer.getCameraState()!, 1, PLATE);
    expect(Math.max(after.x, after.y)).toBeLessThanOrEqual(1);
    expect(Math.max(after.x, after.y)).toBeGreaterThan(0.8);
    viewer.dispose();
  });

  it('a preset view chosen while auto-framing stays fitted, along that view, across resizes', async () => {
    const { viewer } = makeViewer();
    viewer.resize(800, 600);
    await viewer.setSource(PLATE);
    viewer.setView('top');
    viewer.resize(375, 700);
    const s = viewer.getCameraState()!;
    // Still looking straight down (scene +Y), and fitted for the new aspect.
    expect(s.position.x - s.target.x).toBeCloseTo(0, 3);
    expect(s.position.z - s.target.z).toBeCloseTo(0, 3);
    expect(s.position.y).toBeGreaterThan(s.target.y);
    const e = ndcExtent(s, 375 / 700, PLATE);
    expect(Math.max(e.x, e.y)).toBeCloseTo(1 / 1.1, 2);
    viewer.dispose();
  });

  it('a hidden (0×0) resize leaves a finite camera and the next real size re-fits', async () => {
    const { viewer } = makeViewer();
    viewer.resize(800, 600);
    await viewer.setSource(PLATE);
    viewer.resize(0, 0);
    const s = viewer.getCameraState()!;
    for (const v of [s.position.x, s.position.y, s.position.z, s.target.x, s.target.y, s.target.z]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    viewer.resize(375, 700);
    const e = ndcExtent(viewer.getCameraState()!, 375 / 700, PLATE);
    expect(Math.max(e.x, e.y)).toBeCloseTo(1 / 1.1, 2);
    viewer.dispose();
  });

  it('setCameraState hands the camera to the caller (no re-fit on resize)', async () => {
    const { viewer } = makeViewer();
    viewer.resize(800, 600);
    await viewer.setSource(PLATE);
    const state = viewer.getCameraState()!;
    viewer.setCameraState({ ...state, position: { x: 500, y: 500, z: 500 } });
    viewer.resize(300, 900);
    expect(viewer.getCameraState()!.position).toEqual({ x: 500, y: 500, z: 500 });
    viewer.dispose();
  });

  it('autoFrameOnResize: false keeps the first framing across resizes', async () => {
    const canvas = document.createElement('canvas');
    const viewer = createModelViewer(canvas, {
      autoFrameOnResize: false,
      createRenderer: () => ({ render: () => 0, setSize: () => 0, dispose: () => 0, domElement: canvas }),
      createControls: (cam) => stubControls(cam)
    });
    viewer.resize(800, 600);
    await viewer.setSource(PLATE);
    const before = viewer.getCameraState()!;
    viewer.resize(300, 900);
    expect(viewer.getCameraState()!.position).toEqual(before.position);
    viewer.dispose();
  });
});

describe('model preview controller (framework adapters)', () => {
  function sizedCanvas(w: number, h: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, get: () => w });
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, get: () => h });
    return canvas;
  }

  it('sizes the engine to the bound canvas, so adapters get the aspect-aware fit without calling resize', async () => {
    const canvas = sizedCanvas(375, 700);
    const sizes: number[][] = [];
    const c = createModelPreviewController({
      createRenderer: () => ({
        render: () => 0,
        setSize: (w: number, h: number) => sizes.push([w, h]),
        dispose: () => 0,
        domElement: canvas
      }),
      createControls: (cam) => stubControls(cam)
    });
    c.bindCanvas(canvas);
    await c.controls.setSource(PLATE);
    expect(sizes[0]).toEqual([375, 700]);
    const e = ndcExtent(c.raw.viewer()!.getCameraState()!, 375 / 700, PLATE);
    expect(Math.max(e.x, e.y)).toBeCloseTo(1 / 1.1, 2);
    c.dispose();
  });

  it('forwards autoFrameOnResize to the engine', async () => {
    const canvas = sizedCanvas(800, 600);
    const c = createModelPreviewController({
      autoFrameOnResize: false,
      createRenderer: () => ({ render: () => 0, setSize: () => 0, dispose: () => 0, domElement: canvas }),
      createControls: (cam) => stubControls(cam)
    });
    c.bindCanvas(canvas);
    await c.controls.setSource(PLATE);
    const before = c.raw.viewer()!.getCameraState()!;
    c.controls.resize(300, 900);
    expect(c.raw.viewer()!.getCameraState()!.position).toEqual(before.position);
    c.dispose();
  });
});

describe('STL facet normals', () => {
  it('repairs all-zero facet normals from the winding (was rendering solid black)', () => {
    // Binary STL whose facet normal fields are 0 0 0 — common from third-party exporters.
    const buf = new ArrayBuffer(84 + 50);
    const dv = new DataView(buf);
    dv.setUint32(80, 1, true);
    const verts = [0, 0, 0, 10, 0, 0, 0, 20, 0];
    verts.forEach((v, i) => dv.setFloat32(84 + 12 + i * 4, v, true));
    const scene = parseStl(new Uint8Array(buf));
    const n = scene.objects[0].geometry.normals!;
    expect(Array.from(n.slice(0, 3))).toEqual([0, 0, 1]);
    expect(Array.from(n.slice(6, 9))).toEqual([0, 0, 1]);
  });

  it('keeps valid file normals and leaves zero-area facets zero', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const out = repairFacetNormals(positions, normals);
    expect(Array.from(out.slice(0, 3))).toEqual([0, 1, 0]); // file normal kept (even if "wrong")
    expect(Array.from(out.slice(9, 12))).toEqual([0, 0, 0]);
  });
});
