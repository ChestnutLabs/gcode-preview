// @vitest-environment happy-dom
/**
 * InteractiveStage pose operations (sweep 4, PR-A): setCameraMode / setView / setCameraState / frameTo / setFov
 * and the constructor's initial rig, pinned with literal poses, call counts and the disposed / headless paths.
 */
import { describe, expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Scene, Vector3 } from 'three';
import { InteractiveStage, type ControlsLike, type GLRendererLike } from '../index.js';

function make(opts: { mode?: 'perspective' | 'orthographic'; headless?: boolean; resize?: [number, number] } = {}) {
  const canvas = document.createElement('canvas');
  const n = { render: 0, update: 0, keys: 0 as number, keyEl: null as unknown };
  const dom = opts.headless ? ({} as HTMLCanvasElement) : canvas;
  const stub: GLRendererLike = {
    render: () => n.render++,
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: dom
  };
  let controls: (ControlsLike & { object: PerspectiveCamera | OrthographicCamera }) | undefined;
  const stage = new InteractiveStage({
    canvas,
    scene: new Scene(),
    cameraMode: opts.mode,
    createRenderer: () => stub,
    createControls: (cam) =>
      (controls = {
        object: cam,
        target: new Vector3(),
        enabled: true,
        update: () => n.update++,
        dispose: () => undefined,
        addEventListener: () => undefined,
        listenToKeyEvents: (el) => {
          n.keys++;
          n.keyEl = el;
        }
      })
  });
  if (opts.resize) stage.resize(...opts.resize);
  return {
    stage,
    n,
    canvas,
    get controls() {
      return controls!;
    }
  };
}
const fwd = (c: PerspectiveCamera | OrthographicCamera) => new Vector3(0, 0, -1).applyQuaternion(c.quaternion);
const state = (
  p: [number, number, number],
  t: [number, number, number],
  zoom = 1,
  cameraMode: 'perspective' | 'orthographic' = 'perspective'
) => ({
  position: { x: p[0], y: p[1], z: p[2] },
  target: { x: t[0], y: t[1], z: t[2] },
  zoom,
  cameraMode
});

describe('constructor rig', () => {
  it('starts both cameras at (-100, 200, 250), fov 50, ortho frustum sized for aspect 1 and half-height 100', () => {
    const t = make({ mode: 'orthographic' });
    expect(t.stage.perspectiveCamera.position.toArray()).toEqual([-100, 200, 250]);
    expect(t.stage.orthographicCamera.position.toArray()).toEqual([-100, 200, 250]);
    expect(t.stage.perspectiveCamera.fov).toBe(50);
    t.stage.setCameraMode('perspective');
    t.stage.setCameraMode('orthographic');
    const o = t.stage.orthographicCamera;
    expect([o.left, o.right, o.top, o.bottom]).toEqual([-100, 100, 100, -100]);
    expect(t.stage.activeCamera).toBe(o);
  });

  it('defaults to the perspective camera; wires controls to the canvas (zoom-to-cursor, key listening)', () => {
    const t = make();
    expect(t.stage.activeCamera).toBe(t.stage.perspectiveCamera);
    expect(t.controls.object).toBe(t.stage.perspectiveCamera);
    expect(t.controls.zoomToCursor).toBe(true);
    expect(t.n.keys).toBe(1);
    expect(t.n.keyEl).toBe(t.canvas);
  });

  it('a controls factory that throws leaves the stage working without controls', () => {
    const canvas = document.createElement('canvas');
    const stage = new InteractiveStage({
      canvas,
      scene: new Scene(),
      createRenderer: () => ({
        render: () => undefined,
        setSize: () => undefined,
        dispose: () => undefined,
        domElement: canvas
      }),
      createControls: () => {
        throw new Error('no dom');
      }
    });
    expect(stage.controls).toBeNull();
    stage.frameTo(new Vector3(0, 0, 0), 10);
    expect(stage.getCameraState().target).toEqual({ x: 0, y: 0, z: -0 });
  });

  it('controls that fail part-way through set-up are dropped, not kept half-wired', () => {
    const canvas = document.createElement('canvas');
    const stage = new InteractiveStage({
      canvas,
      scene: new Scene(),
      createRenderer: () => ({
        render: () => undefined,
        setSize: () => undefined,
        dispose: () => undefined,
        domElement: canvas
      }),
      createControls: (cam) => ({
        object: cam,
        target: new Vector3(),
        enabled: true,
        update: () => undefined,
        dispose: () => undefined,
        addEventListener: () => undefined,
        listenToKeyEvents: () => {
          throw new Error('no keys');
        }
      })
    });
    expect(stage.controls).toBeNull();
  });

  it('a lost WebGL context event is cancelled so the browser may restore it', () => {
    const t = make();
    const ev = new Event('webglcontextlost', { cancelable: true });
    t.canvas.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('setCameraMode', () => {
  it('copies position, orientation and up to the new camera, re-sizes it, re-points and updates the controls, and repaints', () => {
    const t = make({ resize: [800, 400] });
    t.stage.frameTo(new Vector3(10, 20, 30), 50);
    t.stage.setView('top');
    const p = t.stage.perspectiveCamera;
    const upd = t.n.update;
    const r = t.n.render;
    t.stage.setCameraMode('orthographic');
    const o = t.stage.orthographicCamera;
    expect(t.stage.cameraMode).toBe('orthographic');
    expect(o.position.toArray()).toEqual(p.position.toArray());
    expect(o.up.toArray()).toEqual([0, 0, -1]);
    expect(o.quaternion.toArray()).toEqual(p.quaternion.toArray());
    expect(o.right).toBeCloseTo(62.5 * 2, 9);
    expect(o.top).toBeCloseTo(62.5, 9);
    expect(t.controls.object).toBe(o);
    expect(t.n.update).toBe(upd + 1);
    expect(t.n.render).toBe(r + 1);
  });

  it('switching to the mode already active changes nothing and does not repaint', () => {
    const t = make();
    const r = t.n.render;
    t.stage.setCameraMode('perspective');
    expect(t.n.render).toBe(r);
  });

  it('is a no-op on a disposed stage', () => {
    const t = make();
    t.stage.dispose();
    t.stage.setCameraMode('orthographic');
    expect(t.stage.cameraMode).toBe('perspective');
    expect(t.stage.activeCamera).toBe(t.stage.perspectiveCamera);
  });

  it('works headless (no controls) and still repaints', () => {
    const t = make({ headless: true });
    const r = t.n.render;
    t.stage.setCameraMode('orthographic');
    expect(t.stage.activeCamera).toBe(t.stage.orthographicCamera);
    expect(t.n.render).toBe(r + 1);
  });

  it('a lens changed while orthographic is applied (once) on the way back to perspective', () => {
    const t = make({ resize: [800, 400] });
    t.stage.frameTo(new Vector3(0, 0, 0), 40);
    t.stage.setCameraMode('orthographic');
    const dist = () => t.stage.perspectiveCamera.position.distanceTo(t.controls.target);
    t.stage.setFov(90);
    t.stage.setFov(30);
    const owed = Math.sqrt(40 * 40 * (1.2 * 1.2 + 1.6 * 1.6 + 1.8 * 1.8));
    expect(dist()).toBeCloseTo(owed, 6);
    t.stage.setCameraMode('perspective');
    const k30 = Math.max(
      Math.tan((25 * Math.PI) / 180) / Math.tan((15 * Math.PI) / 180),
      Math.sin((25 * Math.PI) / 180) / Math.sin((15 * Math.PI) / 180)
    );
    expect(dist()).toBeCloseTo(owed * k30, 6);
    const after = t.stage.perspectiveCamera.position.toArray();
    t.stage.setCameraMode('orthographic');
    t.stage.setCameraMode('perspective');
    t.stage.perspectiveCamera.position.toArray().forEach((x, i) => expect(x).toBeCloseTo(after[i], 9));
  });
});

describe('setView', () => {
  it('places the camera on each preset direction at the current distance, looking at the target, with the right up', () => {
    const t = make({ resize: [800, 400] });
    t.stage.frameTo(new Vector3(10, 20, 30), 50);
    const target = t.controls.target.toArray();
    const dist = t.stage.activeCamera.position.distanceTo(t.controls.target);
    const expected: Record<string, [number[], number[]]> = {
      top: [
        [0, 1, 0],
        [0, 0, -1]
      ],
      bottom: [
        [0, -1, 0],
        [0, 0, -1]
      ],
      front: [
        [0, 0, 1],
        [0, 1, 0]
      ],
      back: [
        [0, 0, -1],
        [0, 1, 0]
      ],
      left: [
        [-1, 0, 0],
        [0, 1, 0]
      ],
      right: [
        [1, 0, 0],
        [0, 1, 0]
      ],
      iso: [
        [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)],
        [0, 1, 0]
      ]
    };
    for (const [view, [dir, up]] of Object.entries(expected)) {
      t.stage.setView(view as never);
      const c = t.stage.activeCamera;
      c.position.toArray().forEach((x, i) => expect(x).toBeCloseTo(target[i] + dir[i] * dist, 6));
      expect(c.up.toArray()).toEqual(up);
      const f = fwd(c);
      f.toArray().forEach((x, i) => expect(x).toBeCloseTo(-dir[i], 6));
      expect(t.controls.target.toArray()).toEqual(target);
    }
  });

  it('after a user pan it keeps the distance to the LIVE orbit target, not to the last framed one', () => {
    const t = make({ resize: [800, 400] });
    t.stage.frameTo(new Vector3(0, 0, 0), 50); // camera at (60, 80, 90): distance 134.53624
    expect(t.stage.activeCamera.position.distanceTo(t.controls.target)).toBeCloseTo(134.53624, 5);
    const pan = new Vector3(80, 0, -40); // a user pan moves camera and orbit target together
    t.stage.activeCamera.position.add(pan);
    t.controls.target.add(pan);
    t.stage.setView('front');
    expect(t.controls.target.toArray()).toEqual([80, 0, -40]);
    expect(t.stage.activeCamera.position.distanceTo(t.controls.target)).toBeCloseTo(134.53624, 5);
    expect(t.stage.activeCamera.position.toArray()[0]).toBeCloseTo(80, 9);
    expect(t.stage.activeCamera.position.toArray()[2]).toBeCloseTo(-40 + 134.53624, 5);
  });

  it('falls back to 2.15 × the framed half-height when the camera sits on its target', () => {
    const t = make({ resize: [800, 400] });
    t.stage.setCameraState(state([0, 0, 0], [0, 0, 0]));
    t.stage.setView('front');
    expect(t.stage.activeCamera.position.toArray()).toEqual([0, 0, 215]);
  });

  it('repaints once, updates the controls, and is a no-op after dispose', () => {
    const t = make();
    const r = t.n.render;
    const u = t.n.update;
    t.stage.setView('right');
    expect(t.n.render).toBe(r + 1);
    expect(t.n.update).toBe(u + 1);
    t.stage.dispose();
    const pos = t.stage.activeCamera.position.toArray();
    t.stage.setView('top');
    expect(t.stage.activeCamera.position.toArray()).toEqual(pos);
  });

  it('keeps an orthographic frustum current after a view change', () => {
    const t = make({ mode: 'orthographic', resize: [800, 400] });
    t.stage.frameTo(new Vector3(0, 0, 0), 80);
    t.stage.setView('front');
    expect(t.stage.orthographicCamera.top).toBeCloseTo(100, 9);
    expect(t.stage.orthographicCamera.right).toBeCloseTo(200, 9);
  });
});

describe('setCameraState', () => {
  it('restores position, target, zoom and mode verbatim, looking at the target; repaints and updates the controls', () => {
    const t = make({ mode: 'orthographic', resize: [800, 400] });
    t.stage.frameTo(new Vector3(0, 0, 0), 40);
    const r = t.n.render;
    const u = t.n.update;
    t.stage.setCameraState(state([30, 40, 50], [10, 0, -10], 2, 'orthographic'));
    const c = t.stage.orthographicCamera;
    expect(c.position.toArray()).toEqual([30, 40, 50]);
    expect(c.zoom).toBe(2);
    expect(t.controls.target.toArray()).toEqual([10, 0, -10]);
    expect(t.stage.getCameraState()).toEqual(state([30, 40, 50], [10, 0, -10], 2, 'orthographic'));
    const f = fwd(c);
    const want = new Vector3(-20, -40, -60).normalize();
    f.toArray().forEach((x, i) => expect(x).toBeCloseTo(want.toArray()[i], 6));
    // zoom is in the projection: half-width 50*2 = 100 over zoom 2.
    expect(c.projectionMatrix.elements[0]).toBeCloseTo(2 / 100, 9);
    expect(t.n.render).toBe(r + 1);
    expect(t.n.update).toBeGreaterThan(u);
  });

  it('chooses the up vector from the direction target→camera, not from the camera position alone', () => {
    const t = make();
    // Far from the origin, looking horizontally: world-up.
    t.stage.setCameraState(state([100, 5000, 0], [0, 5000, 0]));
    expect(t.stage.activeCamera.up.toArray()).toEqual([0, 1, 0]);
    // Just inside / outside the 0.999 pole threshold.
    t.stage.setCameraState(state([0, 1000, 20], [0, 0, 0]));
    expect(t.stage.activeCamera.up.toArray()).toEqual([0, 0, -1]);
    t.stage.setCameraState(state([0, 998, 63], [0, 0, 0]));
    expect(t.stage.activeCamera.up.toArray()).toEqual([0, 1, 0]);
    t.stage.setCameraState(state([0, -50, 0], [0, 0, 0]));
    expect(t.stage.activeCamera.up.toArray()).toEqual([0, 0, -1]);
  });

  it('headless: the restored target is what getCameraState reports', () => {
    const t = make({ headless: true });
    t.stage.setCameraState(state([3, 4, 5], [1, 2, 3]));
    expect(t.stage.getCameraState().target).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('is a no-op after dispose', () => {
    const t = make();
    t.stage.dispose();
    t.stage.setCameraState(state([3, 4, 5], [1, 2, 3], 2, 'orthographic'));
    expect(t.stage.cameraMode).toBe('perspective');
    expect(t.stage.activeCamera.position.toArray()).toEqual([-100, 200, 250]);
  });
});

describe('frameTo', () => {
  it('frames the scene-space centre: target (x, z, -y), 3/4 offset, ortho half-height 1.25 r, distance limits, headless target', () => {
    const t = make({ resize: [800, 400] });
    t.stage.frameTo(new Vector3(10, 20, 30), 50);
    expect(t.controls.target.toArray()).toEqual([10, 30, -20]);
    t.stage.activeCamera.position
      .toArray()
      .forEach((x, i) => expect(x).toBeCloseTo([10 - 60, 30 + 80, -20 + 90][i], 9));
    expect(t.stage.orthographicCamera.top).toBeCloseTo(62.5, 9);
    expect(t.stage.orthographicCamera.right).toBeCloseTo(125, 9);
    expect(t.controls.minDistance).toBeCloseTo(7.5, 9);
    expect(t.controls.maxDistance).toBeCloseTo(1500, 9);
    const f = fwd(t.stage.activeCamera);
    const want = new Vector3(60, -80, -90).normalize();
    f.toArray().forEach((x, i) => expect(x).toBeCloseTo(want.toArray()[i], 6));
    const h = make({ headless: true });
    h.stage.frameTo(new Vector3(10, 20, 30), 50);
    expect(h.stage.getCameraState().target).toEqual({ x: 10, y: 30, z: -20 });
  });

  it('the nearest zoom distance never drops below 1 for a tiny model; limits follow the lens', () => {
    const t = make();
    t.stage.frameTo(new Vector3(0, 0, 0), 2);
    expect(t.controls.minDistance).toBe(1);
    expect(t.controls.maxDistance).toBeCloseTo(60, 9);
    const k = Math.max(
      Math.tan((25 * Math.PI) / 180) / Math.tan((45 * Math.PI) / 180),
      Math.sin((25 * Math.PI) / 180) / Math.sin((45 * Math.PI) / 180)
    );
    t.stage.setFov(90);
    t.stage.frameTo(new Vector3(0, 0, 0), 2);
    expect(t.controls.minDistance).toBeCloseTo(k, 9);
    expect(t.controls.maxDistance).toBeCloseTo(60 * k, 9);
  });

  it('repaints, updates the controls, and is a no-op after dispose', () => {
    const t = make();
    const r = t.n.render;
    t.stage.frameTo(new Vector3(0, 0, 0), 10);
    expect(t.n.render).toBe(r + 1);
    t.stage.dispose();
    const pos = t.stage.activeCamera.position.toArray();
    t.stage.frameTo(new Vector3(500, 0, 0), 10);
    expect(t.stage.activeCamera.position.toArray()).toEqual(pos);
  });
});

describe('setFov', () => {
  it('changes the lens, rebuilds the projection, dollies about the target, repaints; a framed view equals a fresh frame at that lens', () => {
    const t = make({ resize: [800, 400] });
    t.stage.frameTo(new Vector3(0, 0, 0), 40);
    const r = t.n.render;
    t.stage.setFov(80);
    expect(t.stage.fov).toBe(80);
    expect(t.stage.perspectiveCamera.projectionMatrix.elements[5]).toBeCloseTo(1 / Math.tan((40 * Math.PI) / 180), 9);
    expect(t.n.render).toBe(r + 1);
    const fresh = make({ resize: [800, 400] });
    fresh.stage.setFov(80);
    fresh.stage.frameTo(new Vector3(0, 0, 0), 40);
    t.stage.activeCamera.position
      .toArray()
      .forEach((x, i) => expect(x).toBeCloseTo(fresh.stage.activeCamera.position.toArray()[i], 6));
    expect(t.controls.minDistance).toBeCloseTo(fresh.controls.minDistance!, 6);
    expect(t.controls.maxDistance).toBeCloseTo(fresh.controls.maxDistance!, 6);
    const f = fwd(t.stage.activeCamera);
    const want = t.controls.target.clone().sub(t.stage.activeCamera.position).normalize();
    expect(f.dot(want)).toBeCloseTo(1, 9);
  });

  it('is a no-op for the current lens and after dispose; leaves undefined zoom limits undefined', () => {
    const t = make();
    const r = t.n.render;
    t.stage.setFov(50);
    expect(t.n.render).toBe(r);
    t.stage.setFov(70);
    expect(t.controls.minDistance).toBeUndefined();
    expect(t.controls.maxDistance).toBeUndefined();
    const u = t.n.update;
    t.stage.frameTo(new Vector3(0, 0, 0), 10);
    const before = t.n.update;
    t.stage.setFov(90);
    expect(t.n.update).toBe(before + 1);
    expect(u).toBeLessThan(before);
    t.stage.dispose();
    t.stage.setFov(30);
    expect(t.stage.fov).toBe(90);
  });

  it('while orthographic keeps the view untouched and does not repaint', () => {
    const t = make({ mode: 'orthographic' });
    const pos = t.stage.activeCamera.position.toArray();
    const r = t.n.render;
    t.stage.setFov(90);
    expect(t.stage.activeCamera.position.toArray()).toEqual(pos);
    expect(t.n.render).toBe(r);
    expect(t.stage.fov).toBe(90);
  });
});

describe('setFov keeps the camera looking at the target', () => {
  it('re-aims a camera that was not yet looking at it (fresh stage, default pose)', () => {
    const t = make();
    t.stage.setFov(90);
    const f = fwd(t.stage.perspectiveCamera);
    const want = t.controls.target.clone().sub(t.stage.perspectiveCamera.position).normalize();
    expect(f.dot(want)).toBeCloseTo(1, 9);
  });
});
