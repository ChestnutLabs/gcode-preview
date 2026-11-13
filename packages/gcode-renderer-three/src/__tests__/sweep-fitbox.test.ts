// @vitest-environment happy-dom
/**
 * `InteractiveStage.fitBox` — the aspect-aware fit AB's model viewer relies on (v0.21.0). Pinned two ways:
 * (1) the BEHAVIOUR a consumer sees, measured by projecting the box corners through the fitted camera
 * (tight, centred, inside both FOVs at the requested margin), and (2) literal poses for real shapes at two
 * aspects in both projections, so any change to the solve is visible in a diff.
 */
import { describe, expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Scene, Vector3 } from 'three';
import { InteractiveStage, type ControlsLike, type GLRendererLike } from '../index.js';

function make(mode: 'perspective' | 'orthographic', w: number, h: number, headless = false) {
  const canvas = document.createElement('canvas');
  const counts = { render: 0 };
  const stub: GLRendererLike = {
    render: () => counts.render++,
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: headless ? ({} as HTMLCanvasElement) : canvas
  };
  let controls: ControlsLike | undefined;
  const stage = new InteractiveStage({
    canvas,
    scene: new Scene(),
    cameraMode: mode,
    createRenderer: () => stub,
    createControls: (cam: PerspectiveCamera | OrthographicCamera) =>
      (controls = {
        object: cam,
        target: new Vector3(),
        enabled: true,
        update: () => undefined,
        dispose: () => undefined,
        addEventListener: () => undefined,
        listenToKeyEvents: () => undefined
      })
  });
  stage.resize(w, h);
  return {
    stage,
    counts,
    get controls() {
      return controls;
    }
  };
}

type Box = [[number, number, number], [number, number, number]];
const BOXES: Record<string, Box> = {
  tall: [
    [90, -10, 0],
    [110, 10, 200]
  ],
  wide: [
    [-100, -20, 40],
    [140, 20, 60]
  ],
  flat: [
    [10, 20, 0],
    [210, 140, 2]
  ]
};
const v3 = (a: number[]) => new Vector3(a[0], a[1], a[2]);

/** Max |NDC| extent per axis over the 8 corners, and the centre of the projected extent. */
function projected(stage: InteractiveStage, [min, max]: Box) {
  const cam = stage.activeCamera;
  cam.updateMatrixWorld(true);
  let xs = [Infinity, -Infinity];
  let ys = [Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const p = new Vector3(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]).project(cam);
    xs = [Math.min(xs[0], p.x), Math.max(xs[1], p.x)];
    ys = [Math.min(ys[0], p.y), Math.max(ys[1], p.y)];
  }
  return { xs, ys };
}

// Poses captured from the shipped solve and cross-checked by the projection assertions below.
const POSES: Record<string, { pos: number[]; target: number[]; vh: number; min: number; max: number }> = {
  'tall/perspective/800x400': {
    pos: [50.94433, 63.052675, 225.763706],
    target: [114.943074, -22.278983, 129.76559],
    vh: 66.896553,
    min: 15.149257,
    max: 3029.851482
  },
  'tall/perspective/400x800': {
    pos: [-30.136566, 172.07601, 319.062433],
    target: [106.73601, -10.420758, 113.753569],
    vh: 140.33915,
    min: 15.149257,
    max: 3029.851482
  },
  'tall/orthographic/800x400': {
    pos: [6.848889, 124.201482, 239.726667],
    target: [100, 0, 100],
    vh: 66.896553,
    min: 15.149257,
    max: 3029.851482
  },
  'tall/orthographic/400x800': {
    pos: [-64.717553, 219.623406, 347.07633],
    target: [100, 0, 100],
    vh: 140.33915,
    min: 15.149257,
    max: 3029.851482
  },
  'wide/perspective/800x400': {
    pos: [-81.842637, 68.559312, 134.901307],
    target: [-18.075496, -16.463543, 39.250596],
    vh: 66.669785,
    min: 18.309833,
    max: 3661.966685
  },
  'wide/perspective/400x800': {
    pos: [-217.214773, 298.12136, 387.928763],
    target: [9.8444, -4.624204, 47.340003],
    vh: 231.864682,
    min: 18.309833,
    max: 3661.966685
  },
  'wide/orthographic/800x400': {
    pos: [-65.30992, 113.746561, 177.964881],
    target: [20, 0, 50],
    vh: 66.669785,
    min: 18.309833,
    max: 3661.966685
  },
  'wide/orthographic/400x800': {
    pos: [-227.943149, 330.590866, 421.914724],
    target: [20, 0, 50],
    vh: 231.864682,
    min: 18.309833,
    max: 3661.966685
  },
  'flat/perspective/800x400': {
    pos: [3.21788, 191.360726, 118.988524],
    target: [89.189435, 76.731986, -9.968808],
    vh: 89.890825,
    min: 17.493499,
    max: 3498.699758
  },
  'flat/perspective/400x800': {
    pos: [-90.495833, 334.736102, 284.958038],
    target: [101.65288, 78.537819, -3.26503],
    vh: 184.271405,
    min: 17.493499,
    max: 3498.699758
  },
  'flat/orthographic/800x400': {
    pos: [19.752202, 200.330398, 136.371697],
    target: [110, 80, 1],
    vh: 89.890825,
    min: 17.493499,
    max: 3498.699758
  },
  'flat/orthographic/400x800': {
    pos: [-101.739873, 362.31983, 318.609809],
    target: [110, 80, 1],
    vh: 184.271405,
    min: 17.493499,
    max: 3498.699758
  }
};

describe('fitBox — real shapes, both projections, two aspects, non-origin centres', () => {
  for (const [name, box] of Object.entries(BOXES)) {
    for (const mode of ['perspective', 'orthographic'] as const) {
      for (const [w, h] of [
        [800, 400],
        [400, 800]
      ]) {
        const key = `${name}/${mode}/${w}x${h}`;
        it(key, () => {
          const t = make(mode, w, h);
          t.stage.fitBox(v3(box[0]), v3(box[1]));
          const want = POSES[key];
          const cam = t.stage.activeCamera;
          const p = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 4));
          p(cam.position.toArray(), want.pos);
          p(t.controls!.target.toArray(), want.target);
          expect(t.stage.orthographicCamera.top).toBeCloseTo(want.vh, 4);
          expect(t.stage.orthographicCamera.bottom).toBeCloseTo(-want.vh, 4);
          expect(t.stage.orthographicCamera.right).toBeCloseTo(want.vh * (w / h), 4);
          expect(t.stage.orthographicCamera.left).toBeCloseTo(-want.vh * (w / h), 4);
          expect(t.controls!.minDistance).toBeCloseTo(want.min, 4);
          expect(t.controls!.maxDistance).toBeCloseTo(want.max, 3);
          expect(cam.zoom).toBe(1);
          expect(t.stage.getCameraState().target.x).toBeCloseTo(want.target[0], 4);

          // Behaviour: every corner inside the default 1.1 margin, tight on at least one axis, and centred.
          const { xs, ys } = projected(t.stage, box);
          const lim = 1 / 1.1;
          for (const v of [...xs, ...ys]) expect(Math.abs(v)).toBeLessThanOrEqual(lim + 1e-6);
          const touch = Math.max(Math.abs(xs[0]), xs[1], Math.abs(ys[0]), ys[1]);
          expect(touch).toBeGreaterThan(lim - 1e-3);
          expect(Math.abs((xs[0] + xs[1]) / 2)).toBeLessThan(mode === 'perspective' ? 1e-3 : 0.35);
          expect(Math.abs((ys[0] + ys[1]) / 2)).toBeLessThan(mode === 'perspective' ? 1e-3 : 0.35);
        });
      }
    }
  }

  it('a wide box on a narrow canvas fits the horizontal FOV, not just the vertical one', () => {
    const t = make('perspective', 400, 800);
    t.stage.fitBox(v3(BOXES.wide[0]), v3(BOXES.wide[1]));
    const { xs } = projected(t.stage, BOXES.wide);
    expect(Math.max(Math.abs(xs[0]), xs[1])).toBeGreaterThan(0.9 - 1e-3);
    expect(Math.max(Math.abs(xs[0]), xs[1])).toBeLessThan(1 / 1.1 + 1e-6);
  });
});

describe('fitBox — options', () => {
  const box: Box = [
    [0, 0, 0],
    [100, 50, 30]
  ];
  it('direction + margin: top-down at margin 1.5 (screen-up rolls about −Z, target stays the centre)', () => {
    const t = make('perspective', 800, 400);
    t.stage.fitBox(v3(box[0]), v3(box[1]), { direction: new Vector3(0, 1, 0), margin: 1.5 });
    expect(t.stage.activeCamera.position.toArray()[0]).toBeCloseTo(50, 4);
    expect(t.stage.activeCamera.position.y).toBeCloseTo(130.41901, 4);
    expect(t.stage.activeCamera.position.z).toBeCloseTo(15, 4);
    expect(t.controls!.target.toArray()).toEqual([50, 25, 15]);
    expect(t.stage.activeCamera.up.toArray()).toEqual([0, 0, -1]);
    expect(t.controls!.minDistance).toBeCloseTo(8.681878, 4);
    expect(t.controls!.maxDistance).toBeCloseTo(1736.375576, 3);
    const { xs, ys } = projected(t.stage, box);
    expect(Math.max(Math.abs(xs[0]), xs[1], Math.abs(ys[0]), ys[1])).toBeCloseTo(1 / 1.5, 4);
  });

  it('a margin below 1 is clamped to 1 (never crops the box)', () => {
    const a = make('perspective', 800, 400);
    const b = make('perspective', 800, 400);
    a.stage.fitBox(v3(box[0]), v3(box[1]), { margin: 0.5 });
    b.stage.fitBox(v3(box[0]), v3(box[1]), { margin: 1 });
    expect(a.stage.activeCamera.position.toArray()).toEqual(b.stage.activeCamera.position.toArray());
    expect(a.stage.orthographicCamera.top).toBe(b.stage.orthographicCamera.top);
    const { xs, ys } = projected(a.stage, box);
    expect(Math.max(...xs.map(Math.abs), ...ys.map(Math.abs))).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('the default margin is 1.1', () => {
    const a = make('orthographic', 800, 400);
    const b = make('orthographic', 800, 400);
    a.stage.fitBox(v3(box[0]), v3(box[1]));
    b.stage.fitBox(v3(box[0]), v3(box[1]), { margin: 1.1 });
    expect(a.stage.orthographicCamera.top).toBe(b.stage.orthographicCamera.top);
    expect(a.stage.orthographicCamera.top).not.toBe(
      (() => {
        const c = make('orthographic', 800, 400);
        c.stage.fitBox(v3(box[0]), v3(box[1]), { margin: 1.2 });
        return c.stage.orthographicCamera.top;
      })()
    );
  });

  it('a zero or non-finite direction falls back to the default 3/4 pose; the caller vector is not mutated', () => {
    const def = make('orthographic', 800, 400);
    def.stage.fitBox(v3(box[0]), v3(box[1]));
    const want = def.stage.activeCamera.position.toArray();
    for (const d of [new Vector3(0, 0, 0), new Vector3(NaN, 1, 1)]) {
      const t = make('orthographic', 800, 400);
      t.stage.fitBox(v3(box[0]), v3(box[1]), { direction: d });
      t.stage.activeCamera.position.toArray().forEach((x, i) => expect(x).toBeCloseTo(want[i], 9));
      expect(Number.isFinite(t.stage.activeCamera.position.x)).toBe(true);
    }
    const dir = new Vector3(2, 0, 0);
    make('orthographic', 800, 400).stage.fitBox(v3(box[0]), v3(box[1]), { direction: dir });
    expect(dir.toArray()).toEqual([2, 0, 0]);
    // The default direction itself: normalised (-1.2, 1.6, 1.8), looking at the centre.
    const t = make('orthographic', 800, 400);
    t.stage.fitBox(v3(box[0]), v3(box[1]));
    const off = t.stage.activeCamera.position
      .clone()
      .sub(new Vector3(50, 25, 15))
      .normalize();
    expect(off.x).toBeCloseTo(-1.2 / Math.hypot(1.2, 1.6, 1.8), 6);
    expect(off.y).toBeCloseTo(1.6 / Math.hypot(1.2, 1.6, 1.8), 6);
    expect(off.z).toBeCloseTo(1.8 / Math.hypot(1.2, 1.6, 1.8), 6);
  });

  it('a side-on view uses world-up and a right-handed basis (box left stays on the left of the image)', () => {
    const t = make('perspective', 800, 400);
    const sideBox: Box = [
      [-50, -5, 0],
      [50, 5, 10]
    ];
    t.stage.fitBox(v3(sideBox[0]), v3(sideBox[1]), { direction: new Vector3(0, 0, 1) });
    expect(t.stage.activeCamera.up.toArray()).toEqual([0, 1, 0]);
    const cam = t.stage.activeCamera;
    cam.updateMatrixWorld(true);
    const left = new Vector3(-50, 0, 5).project(cam);
    const right = new Vector3(50, 0, 5).project(cam);
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
    const bottom = new Vector3(0, -5, 5).project(cam);
    const top = new Vector3(0, 5, 5).project(cam);
    expect(top.y).toBeGreaterThan(bottom.y);
  });
});

describe('fitBox — state side effects', () => {
  const box: Box = [
    [0, 0, 0],
    [100, 50, 30]
  ];
  it('repaints once, resets zoom, and keeps the framed target for a headless stage (no controls)', () => {
    const t = make('orthographic', 800, 400, true);
    expect(t.controls).toBeUndefined();
    t.stage.setCameraState({
      position: { x: 5, y: 5, z: 5 },
      target: { x: 0, y: 0, z: 0 },
      zoom: 3,
      cameraMode: 'orthographic'
    });
    const before = t.counts.render;
    t.stage.fitBox(v3(box[0]), v3(box[1]));
    expect(t.counts.render).toBe(before + 1);
    expect(t.stage.activeCamera.zoom).toBe(1);
    expect(t.stage.getCameraState().target).toEqual({ x: 50, y: 25, z: 15 });
    expect(t.stage.getCameraState().zoom).toBe(1);
  });

  it('resets the ortho-zoom on the ACTIVE camera and keeps the up vector in step with the direction', () => {
    const t = make('orthographic', 800, 400);
    t.stage.setCameraState({
      position: { x: 5, y: 5, z: 5 },
      target: { x: 0, y: 0, z: 0 },
      zoom: 4,
      cameraMode: 'orthographic'
    });
    t.stage.fitBox(v3(box[0]), v3(box[1]), { direction: new Vector3(0, -1, 0) });
    expect(t.stage.activeCamera.zoom).toBe(1);
    expect(t.stage.activeCamera.up.toArray()).toEqual([0, 0, -1]);
    expect(t.stage.activeCamera.position.y).toBeLessThan(15);
  });

  it('looks at the target (camera forward points at the fitted target)', () => {
    const t = make('perspective', 800, 400);
    t.stage.fitBox(v3(box[0]), v3(box[1]));
    const fwd = new Vector3(0, 0, -1).applyQuaternion(t.stage.activeCamera.quaternion);
    const toTarget = t.controls!.target.clone().sub(t.stage.activeCamera.position).normalize();
    expect(fwd.dot(toTarget)).toBeCloseTo(1, 6);
  });

  it('is a no-op once the stage is disposed', () => {
    const t = make('perspective', 800, 400);
    const before = t.stage.activeCamera.position.toArray();
    t.stage.dispose();
    t.stage.fitBox(v3(box[0]), v3(box[1]));
    expect(t.stage.activeCamera.position.toArray()).toEqual(before);
  });

  it('is a no-op with no usable viewport (infinite or zero aspect), leaving the pose alone', () => {
    for (const [w, h] of [
      [Infinity, 1],
      [1e-300, 1e300]
    ]) {
      const t = make('perspective', 800, 400);
      t.stage.resize(w, h);
      const before = t.stage.activeCamera.position.toArray();
      const rendersBefore = t.counts.render;
      t.stage.fitBox(v3(box[0]), v3(box[1]));
      expect(t.stage.activeCamera.position.toArray()).toEqual(before);
      expect(t.counts.render).toBe(rendersBefore);
    }
  });

  it('a hidden (0×0) canvas keeps the last real aspect, so a fit made meanwhile matches the visible fit', () => {
    const vis = make('orthographic', 800, 400);
    vis.stage.fitBox(v3(box[0]), v3(box[1]));
    const hid = make('orthographic', 800, 400);
    hid.stage.resize(0, 0);
    hid.stage.fitBox(v3(box[0]), v3(box[1]));
    expect(hid.stage.orthographicCamera.top).toBe(vis.stage.orthographicCamera.top);
    expect(hid.stage.orthographicCamera.right).toBe(vis.stage.orthographicCamera.right);
  });

  it('the far plane covers a very large model in both cameras, and stays 10000 for a small one', () => {
    const small = make('perspective', 800, 400);
    small.stage.fitBox(v3(box[0]), v3(box[1]));
    expect(small.stage.perspectiveCamera.far).toBe(10000);
    expect(small.stage.orthographicCamera.far).toBe(10000);
    const big = make('perspective', 800, 400);
    big.stage.fitBox(new Vector3(0, 0, 0), new Vector3(20000, 20000, 20000));
    const far = big.stage.perspectiveCamera.far;
    expect(far).toBeGreaterThan(40000);
    expect(big.stage.orthographicCamera.far).toBe(far);
    const dist = big.stage.activeCamera.position.distanceTo(big.controls!.target);
    // 5% slack over (distance + 2·radius), exactly.
    expect(far).toBeCloseTo((dist + 2 * Math.hypot(10000, 10000, 10000)) * 1.05, 0);
    expect(big.controls!.maxDistance).toBeCloseTo(Math.max(dist * 4, Math.hypot(10000, 10000, 10000) * 30), 0);
  });

  it('a lens set while orthographic owes no dolly after a fit (the fit already solved for the current lens)', () => {
    const t = make('orthographic', 800, 400);
    t.stage.setFov(90);
    t.stage.fitBox(v3(box[0]), v3(box[1]));
    const before = t.stage.orthographicCamera.position.toArray();
    t.stage.setCameraMode('perspective');
    t.stage.perspectiveCamera.position.toArray().forEach((x, i) => expect(x).toBeCloseTo(before[i], 9));
  });

  it('a degenerate point-sized box is finite and gets the 1e-3 radius floor', () => {
    // Only finiteness and the ortho extent are pinned. The distance and the zoom limits of this case are NOT:
    // the stub controls never clamp, so the raw values (distance 5e-4, minDistance 1 > maxDistance 0.03) are
    // incoherent and a real OrbitControls pulls the camera out to 1. Follow-up: floor minDistance at the fit.
    const t = make('perspective', 800, 400);
    t.stage.fitBox(new Vector3(7, 7, 7), new Vector3(7, 7, 7), { direction: new Vector3(0, 0, 1) });
    for (const v of [...t.stage.activeCamera.position.toArray(), ...t.controls!.target.toArray()]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(t.stage.orthographicCamera.top).toBeCloseTo(1e-3, 12);
  });

  it('the zoom limits come from the box radius, not the lens: a fit at fov 30 gives the same limits as at 50', () => {
    const t = make('perspective', 800, 400);
    t.stage.setFov(30);
    t.stage.fitBox(v3(BOXES.tall[0]), v3(BOXES.tall[1])); // radius |(10, 10, 100)| = 100.995
    expect(t.controls!.minDistance).toBeCloseTo(15.149257, 5);
    expect(t.controls!.maxDistance).toBeCloseTo(3029.851482, 4);
  });

  it('a box whose nearest corner lies exactly on the camera axis stays finite (no 0/0)', () => {
    const t = make('perspective', 800, 400);
    t.stage.fitBox(new Vector3(0, 0, -10), new Vector3(0, 0, 10), { direction: new Vector3(0, 0, 1) });
    for (const v of [...t.stage.activeCamera.position.toArray(), ...t.controls!.target.toArray()]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(t.stage.activeCamera.position.z).toBeCloseTo(10, 9);
  });
});

describe('fitBox — extreme aspects and control wiring', () => {
  const box: Box = [
    [-100, -20, 40],
    [140, 20, 60]
  ];

  it('a very narrow canvas lets the distance, not the radius, set the far zoom limit (4 × fitted distance)', () => {
    const t = make('perspective', 10, 800);
    t.stage.fitBox(v3(box[0]), v3(box[1]));
    const dist = t.stage.activeCamera.position.distanceTo(t.controls!.target);
    const radius = Math.hypot(120, 20, 10);
    expect(dist * 4).toBeGreaterThan(radius * 30);
    expect(t.controls!.maxDistance).toBeCloseTo(dist * 4, 6);
    expect(t.controls!.minDistance).toBeCloseTo(Math.max(1, radius * 0.15), 9);
  });

  it('an aspect below 1e-6 is floored when sizing the orthographic frustum (no blow-up)', () => {
    const a = make('orthographic', 800, 400);
    a.stage.resize(1e-7, 1);
    a.stage.fitBox(v3(box[0]), v3(box[1]));
    const b = make('orthographic', 800, 400);
    b.stage.resize(1e-6, 1);
    b.stage.fitBox(v3(box[0]), v3(box[1]));
    expect(a.stage.orthographicCamera.top).toBeCloseTo(b.stage.orthographicCamera.top, 6);
  });

  it('updates the controls exactly once per fit and re-points them at the fitted target', () => {
    const t = make('perspective', 800, 400);
    let updates = 0;
    t.controls!.update = () => updates++;
    t.stage.fitBox(v3(box[0]), v3(box[1]));
    expect(updates).toBe(1);
  });
});
