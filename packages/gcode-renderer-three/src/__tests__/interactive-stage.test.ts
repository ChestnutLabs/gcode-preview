// @vitest-environment happy-dom
/**
 * InteractiveStage tests (DD-021 Phase 0). Stub GL + an injected stub controls (the new
 * `createControls` seam) so camera/controls/context-loss/quality/lifecycle are deterministic and
 * headless — three's cameras are pure JS, only WebGLRenderer needs a real context.
 */
import { describe, expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Scene, Vector3 } from 'three';
import { InteractiveStage, type ControlsLike, type GLRendererLike, type CameraState } from '../index.js';

function stubControls(camera: PerspectiveCamera | OrthographicCamera) {
  const listeners: Record<string, (() => void)[]> = {};
  const c: ControlsLike & { fire(t: string): void; disposed: boolean } = {
    object: camera,
    target: new Vector3(),
    enabled: true,
    update: () => undefined,
    dispose: () => {
      c.disposed = true;
    },
    addEventListener: (t, cb) => {
      (listeners[t] ??= []).push(cb);
    },
    listenToKeyEvents: () => undefined,
    fire: (t) => (listeners[t] ?? []).forEach((cb) => cb()),
    disposed: false
  };
  return c;
}

function makeStage(opts: { interactionQuality?: 'off' | 'auto' } = {}) {
  const canvas = document.createElement('canvas');
  const scene = new Scene();
  const gl = { render: 0, setSize: 0, ratios: [] as number[], disposed: false };
  const stub: GLRendererLike = {
    render: () => gl.render++,
    setSize: () => gl.setSize++,
    setPixelRatio: (r: number) => gl.ratios.push(r),
    dispose: () => (gl.disposed = true),
    domElement: canvas
  };
  let controls: ReturnType<typeof stubControls> | null = null;
  const events: { cameraChanged: CameraState[]; lost: number; restored: number } = {
    cameraChanged: [],
    lost: 0,
    restored: 0
  };
  const stage = new InteractiveStage({
    canvas,
    scene,
    interactionQuality: opts.interactionQuality,
    createRenderer: () => stub,
    createControls: (cam) => (controls = stubControls(cam)),
    onCameraChanged: (s) => events.cameraChanged.push(s),
    onContextLost: () => events.lost++,
    onContextRestored: () => events.restored++
  });
  return {
    stage,
    canvas,
    scene,
    gl,
    get controls() {
      return controls!;
    },
    events
  };
}

describe('InteractiveStage', () => {
  it('renders the provided scene with the active camera; resize sizes the GL + aspect', () => {
    const h = makeStage();
    const before = h.gl.render;
    h.stage.render();
    expect(h.gl.render).toBe(before + 1);
    h.stage.resize(800, 400);
    expect(h.gl.setSize).toBeGreaterThan(0);
    expect(h.stage.perspectiveCamera.aspect).toBeCloseTo(2);
  });

  it('setCameraMode swaps the active camera and keeps the pose', () => {
    const h = makeStage();
    expect(h.stage.activeCamera).toBeInstanceOf(PerspectiveCamera);
    const pos = h.stage.activeCamera.position.clone();
    h.stage.setCameraMode('orthographic');
    expect(h.stage.activeCamera).toBeInstanceOf(OrthographicCamera);
    expect(h.stage.cameraMode).toBe('orthographic');
    expect(h.stage.activeCamera.position.equals(pos)).toBe(true);
    // Controls were re-pointed at the new camera.
    expect(h.controls.object).toBe(h.stage.activeCamera);
  });

  it('getCameraState → setCameraState round-trips verbatim', () => {
    const h = makeStage();
    h.stage.frameTo(new Vector3(10, 20, 30), 50);
    const state = h.stage.getCameraState();
    // Move the camera, then restore.
    h.stage.setView('top');
    h.stage.setCameraState(state);
    const back = h.stage.getCameraState();
    expect(back.position.x).toBeCloseTo(state.position.x);
    expect(back.position.y).toBeCloseTo(state.position.y);
    expect(back.position.z).toBeCloseTo(state.position.z);
    expect(back.target.x).toBeCloseTo(state.target.x);
    expect(back.cameraMode).toBe(state.cameraMode);
  });

  it('setView places the camera on the preset direction from the target', () => {
    const h = makeStage();
    h.stage.frameTo(new Vector3(0, 0, 0), 40);
    h.stage.setView('top'); // scene +Y
    const p = h.stage.activeCamera.position;
    expect(p.y).toBeGreaterThan(Math.abs(p.x));
    expect(p.y).toBeGreaterThan(Math.abs(p.z));
  });

  it('frameTo sets the orbit target and derives zoom-distance clamps from the radius', () => {
    const h = makeStage();
    h.stage.frameTo(new Vector3(5, 5, 5), 100);
    expect(h.controls.target.x).toBeCloseTo(5);
    expect(h.controls.minDistance).toBeCloseTo(Math.max(1, 100 * 0.15));
    expect(h.controls.maxDistance).toBeCloseTo(100 * 30);
  });

  it('recovers context loss: render is suppressed while lost, callbacks fire, restored resumes', () => {
    const h = makeStage();
    h.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(h.events.lost).toBe(1);
    const before = h.gl.render;
    h.stage.render(); // suppressed while lost
    expect(h.gl.render).toBe(before);
    h.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(h.events.restored).toBe(1);
    h.stage.render();
    expect(h.gl.render).toBe(before + 1);
  });

  it('a settled gesture publishes the camera state via onCameraChanged', () => {
    const h = makeStage();
    h.stage.frameTo(new Vector3(1, 2, 3), 20);
    h.controls.fire('end');
    expect(h.events.cameraChanged).toHaveLength(1);
    expect(h.events.cameraChanged[0].cameraMode).toBe('perspective');
  });

  it("interactionQuality:'auto' reduces the pixel ratio on a gesture frame", () => {
    const h = makeStage({ interactionQuality: 'auto' });
    h.gl.ratios.length = 0;
    h.controls.fire('change'); // wired to onInteractionFrame
    expect(h.gl.ratios.at(-1)!).toBeLessThan(1);
  });

  it('dispose removes context listeners and disposes GL + controls', () => {
    const h = makeStage();
    h.stage.dispose();
    expect(h.gl.disposed).toBe(true);
    expect(h.controls.disposed).toBe(true);
    // Post-dispose context events no longer invoke callbacks.
    h.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(h.events.lost).toBe(0);
  });
});
