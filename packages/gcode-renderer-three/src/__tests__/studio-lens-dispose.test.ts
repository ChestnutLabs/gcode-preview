// @vitest-environment happy-dom
/**
 * DD-032 Lane A: lens-aware framing (`framingFromCenterRadius(…, fov)` + `InteractiveStage.setFov`) and
 * `disposeBuildVolume` (frees maps too, so the bed texture no longer leaks on rebuild). Literal values.
 */
import { describe, expect, it } from 'vitest';
import { Group, type Mesh, type MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, Scene, Vector3 } from 'three';
import {
  InteractiveStage,
  ToolpathRenderer,
  createContactShadow,
  disposeBuildVolume,
  framingFromCenterRadius,
  framingLensScale,
  type ControlsLike,
  type GLRendererLike,
  type Theme
} from '../index.js';

const r3 = (v: Vector3): number[] => [v.x, v.y, v.z].map((n) => Math.round(n * 1e6) / 1e6);

describe('framingFromCenterRadius lens', () => {
  const center = new Vector3(10, 20, 30); // printer coords → scene target (10, 30, −20)

  it('fov 50 (and the default) give exactly the original pose', () => {
    for (const f of [framingFromCenterRadius(center, 10), framingFromCenterRadius(center, 10, 50)]) {
      expect([f.target.x, f.target.y, f.target.z]).toEqual([10, 30, -20]);
      expect([f.position.x, f.position.y, f.position.z]).toEqual([-2, 46, -2]);
      expect(f.viewHalfHeight).toBe(12.5);
    }
  });

  it('fov 32 backs off by tan25°/tan16° ≈ 1.626208 and the sphere fits the view', () => {
    const f = framingFromCenterRadius(center, 10, 32);
    expect(r3(f.position)).toEqual([-9.514497, 56.019329, 9.271745]);
    expect(f.viewHalfHeight).toBe(12.5); // ortho frustum is lens-free
    const d = f.position.distanceTo(f.target);
    expect(d).toBeCloseTo(43.756784, 5);
    // The bounding sphere's angular radius must fit inside the half-fov.
    expect((Math.asin(10 / d) * 180) / Math.PI).toBeLessThan(16);
    // The un-scaled pose would crop it at 32°.
    expect(
      (Math.asin(10 / framingFromCenterRadius(center, 10).position.distanceTo(f.target)) * 180) / Math.PI
    ).toBeGreaterThan(16);
  });

  it('framingLensScale: exactly 1 at 50, the tan rule below 50, the sphere-margin rule above', () => {
    expect(framingLensScale(50)).toBe(1);
    expect(framingLensScale(32)).toBeCloseTo(1.626208, 6); // tan25/tan16
    expect(framingLensScale(74)).toBeCloseTo(0.702239, 6); // sin25/sin37 (tan rule: 0.618811)
    expect(framingLensScale(120)).toBeCloseTo(0.487998, 6); // sin25/sin60 (tan rule: 0.269223)
  });

  it('at 120° the camera stays outside the sphere with the 50° margin', () => {
    const f = framingFromCenterRadius(center, 10, 120);
    expect(f.position.distanceTo(f.target)).toBeCloseTo(13.130671, 5);
  });

  it.each([10, 120])('the range ends (%s°) are accepted', (fov) => {
    expect(() => framingFromCenterRadius(center, 10, fov)).not.toThrow();
  });

  it.each([9.99, 120.01, 0, 180, NaN])('fov %s → RangeError', (fov) => {
    expect(() => framingFromCenterRadius(center, 10, fov)).toThrow(RangeError);
    expect(() => framingFromCenterRadius(center, 10, fov)).toThrow(
      `fov must be in [10, 120] degrees (got ${String(fov)})`
    );
  });
});

function makeStage() {
  const canvas = document.createElement('canvas');
  const stub: GLRendererLike = {
    render: () => undefined,
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: canvas
  };
  const listeners: Record<string, (() => void)[]> = {};
  const events = { cameraChanged: 0, interactionStart: 0 };
  let controls: ControlsLike | null = null;
  const stage = new InteractiveStage({
    canvas,
    scene: new Scene(),
    createRenderer: () => stub,
    onCameraChanged: () => events.cameraChanged++,
    onInteractionStart: () => events.interactionStart++,
    createControls: (cam: PerspectiveCamera | OrthographicCamera) =>
      (controls = {
        object: cam,
        target: new Vector3(),
        enabled: true,
        // Like OrbitControls: update() fires `change`.
        update: () => (listeners.change ?? []).forEach((cb) => cb()),
        dispose: () => undefined,
        addEventListener: (t: string, cb: () => void) => void (listeners[t] ??= []).push(cb),
        listenToKeyEvents: () => undefined
      })
  });
  return { stage, controls: () => controls!, events };
}

/** Degrees the bounding sphere of `radius` subtends (half-angle) from the camera. */
const halfAngle = (cam: Vector3, target: Vector3, radius: number): number =>
  (Math.asin(radius / cam.distanceTo(target)) * 180) / Math.PI;

describe('InteractiveStage.setFov', () => {
  it('frameTo is lens-aware: at fov 32 it frames the 32° pose, limits scaled by the same factor', () => {
    const { stage, controls } = makeStage();
    stage.setFov(32);
    stage.frameTo(new Vector3(10, 20, 30), 10);
    expect(r3(stage.perspectiveCamera.position)).toEqual([-9.514497, 56.019329, 9.271745]);
    expect(controls().minDistance).toBeCloseTo(1.5 * 1.626208, 5);
    expect(controls().maxDistance).toBeCloseTo(300 * 1.626208, 4);
  });

  it('frameTo at 50 keeps the original limits exactly', () => {
    const { stage, controls } = makeStage();
    stage.frameTo(new Vector3(0, 0, 0), 10);
    expect(controls().minDistance).toBe(1.5);
    expect(controls().maxDistance).toBe(300);
  });

  it.each([10, 120])('the framed sphere sits inside the view and inside the limits at %s°', (fov) => {
    const { stage, controls } = makeStage();
    stage.setFov(fov);
    stage.frameTo(new Vector3(10, 20, 30), 10);
    const cam = stage.perspectiveCamera.position;
    const target = new Vector3(10, 30, -20);
    expect(halfAngle(cam, target, 10)).toBeLessThan(fov / 2);
    const d = cam.distanceTo(target);
    expect(d).toBeGreaterThanOrEqual(controls().minDistance!);
    expect(d).toBeLessThanOrEqual(controls().maxDistance!);
  });

  it('keeps the target and the apparent size: distance × tan(fov/2) is invariant', () => {
    const { stage } = makeStage();
    stage.frameTo(new Vector3(10, 20, 30), 10);
    const target = new Vector3(10, 30, -20);
    const cam = stage.perspectiveCamera;
    const dir0 = cam.position.clone().sub(target).normalize();
    const d0 = cam.position.distanceTo(target);
    stage.setFov(32);
    expect(stage.fov).toBe(32);
    expect(cam.fov).toBe(32);
    const d1 = cam.position.distanceTo(target);
    expect(d1).toBeCloseTo(43.756784, 5);
    expect(d1 * Math.tan((16 * Math.PI) / 180)).toBeCloseTo(d0 * Math.tan((25 * Math.PI) / 180), 9);
    expect(r3(cam.position.clone().sub(target).normalize())).toEqual(r3(dir0));
  });

  it('a dolly from a user-zoomed distance is not clamped: the limits scale with it', () => {
    const { stage, controls } = makeStage();
    stage.frameTo(new Vector3(0, 0, 0), 10); // limits [1.5, 300]
    stage.perspectiveCamera.position.setLength(290); // the user zoomed out near the limit
    stage.setFov(32);
    expect(stage.perspectiveCamera.position.length()).toBeCloseTo(290 * 1.626208, 3);
    expect(controls().maxDistance).toBeCloseTo(300 * 1.626208, 4);
    expect(controls().minDistance).toBeCloseTo(1.5 * 1.626208, 5);
  });

  it('is programmatic: no camera-changed and no interaction start', () => {
    const { stage, events } = makeStage();
    stage.frameTo(new Vector3(0, 0, 0), 10);
    stage.setFov(32);
    expect(events).toEqual({ cameraChanged: 0, interactionStart: 0 });
  });

  it('orthographic: the view is untouched; the dolly is applied on return to perspective', () => {
    const { stage, controls } = makeStage();
    stage.frameTo(new Vector3(10, 20, 30), 10);
    const target = new Vector3(10, 30, -20);
    stage.setCameraMode('orthographic');
    const before = r3(stage.orthographicCamera.position);
    stage.setFov(40);
    stage.setFov(32); // two changes while orthographic compound to one 50 → 32 dolly
    expect(r3(stage.orthographicCamera.position)).toEqual(before);
    expect(stage.fov).toBe(32);
    expect(controls().maxDistance).toBe(300);
    stage.setCameraMode('perspective');
    expect(stage.perspectiveCamera.fov).toBe(32);
    expect(stage.perspectiveCamera.position.distanceTo(target)).toBeCloseTo(43.756784, 5);
    expect(controls().maxDistance).toBeCloseTo(300 * 1.626208, 4);
    // Toggling again applies nothing more.
    stage.setCameraMode('orthographic');
    stage.setCameraMode('perspective');
    expect(stage.perspectiveCamera.position.distanceTo(target)).toBeCloseTo(43.756784, 5);
  });

  it('setting the current fov is a no-op', () => {
    const { stage } = makeStage();
    stage.frameTo(new Vector3(0, 0, 0), 10);
    const before = r3(stage.perspectiveCamera.position);
    stage.setFov(50);
    expect(r3(stage.perspectiveCamera.position)).toEqual(before);
  });

  it.each([9, 121, NaN])('fov %s → RangeError (never clamps)', (fov) => {
    const { stage } = makeStage();
    expect(() => stage.setFov(fov)).toThrow(RangeError);
    expect(stage.fov).toBe(50);
  });
});

describe('disposeBuildVolume', () => {
  it('frees geometry, material and the material map (shadow decal included)', () => {
    const g = new Group();
    const shadow = createContactShadow({ min: { x: 0, y: 0 }, max: { x: 10, y: 10 } }, 0.4)!;
    g.add(shadow);
    const freed: string[] = [];
    const mat = shadow.material as MeshBasicMaterial;
    shadow.geometry.addEventListener('dispose', () => freed.push('geometry'));
    mat.addEventListener('dispose', () => freed.push('material'));
    mat.map!.addEventListener('dispose', () => freed.push('map'));
    disposeBuildVolume(g);
    expect(freed.sort()).toEqual(['geometry', 'map', 'material']);
  });

  const theme: Theme = {
    bedSurface: { mode: 'solid', color: '#7c8086', thickness: 4, texture: document.createElement('canvas') }
  };

  function makeRenderer() {
    const canvas = document.createElement('canvas');
    const stub: GLRendererLike = {
      render: () => undefined,
      setSize: () => undefined,
      dispose: () => undefined,
      domElement: canvas
    };
    return new ToolpathRenderer({
      canvas,
      buildVolume: { x: 100, y: 100, z: 100 },
      theme,
      createRenderer: () => stub,
      scheduleFrame: () => undefined
    });
  }
  /** Count disposals of the current textured slab's bed texture + edge material. */
  function watch(r: ToolpathRenderer): string[] {
    const group = (r as unknown as { volumeGroup: Group }).volumeGroup;
    const top = group.children.find((c) => c.name === 'bedSurface') as Mesh;
    const edge = group.children.find((c) => c.name === 'bedSurfaceEdge') as Mesh;
    const out: string[] = [];
    (top.material as MeshBasicMaterial).map!.addEventListener('dispose', () => out.push('map'));
    (edge.material as MeshBasicMaterial).addEventListener('dispose', () => out.push('edge'));
    return out;
  }

  it('setTheme frees the old bed texture', () => {
    const r = makeRenderer();
    const freed = watch(r);
    r.setTheme(theme);
    expect(freed.sort()).toEqual(['edge', 'map']);
  });

  it('setBuildVolume frees the old bed texture', () => {
    const r = makeRenderer();
    const freed = watch(r);
    r.setBuildVolume({ x: 120, y: 120, z: 100 });
    expect(freed.sort()).toEqual(['edge', 'map']);
  });

  it('dispose frees the bed texture', () => {
    const r = makeRenderer();
    const freed = watch(r);
    r.dispose();
    expect(freed.sort()).toEqual(['edge', 'map']);
  });
});
