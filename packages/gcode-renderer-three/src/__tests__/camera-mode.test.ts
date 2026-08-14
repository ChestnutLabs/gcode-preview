// @vitest-environment happy-dom
/**
 * Orthographic camera (#150, DD-009 D3): the construction option, runtime
 * setCameraMode with pose preservation, and frustum sizing on frame()/resize().
 * Uses a stub GL; the two cameras are pure three objects, so no real WebGL is needed.
 */
import { describe, expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera } from 'three';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer, type CameraMode, type CameraState, type CameraView, type GLRendererLike } from '../index.js';

function makeIR(): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  let src = 0;
  for (let l = 0; l < 2; l++) {
    for (let s = 0; s < 3; s++) {
      b.addSegment({
        x0: 100 + s,
        y0: 100,
        z0: 0.2 * (l + 1),
        x1: 101 + s,
        y1: 100,
        z1: 0.2 * (l + 1),
        e: 1,
        kind: MoveKind.Extrude,
        layer: l,
        srcByte: src++ * 10
      });
    }
  }
  return b.finalize();
}

function makeRenderer(cameraMode?: CameraMode) {
  const canvas = document.createElement('canvas');
  const stub: GLRendererLike = {
    render: () => undefined,
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: canvas
  };
  const ticks: (() => void)[] = [];
  const renderer = new ToolpathRenderer({
    canvas,
    chunksPerTick: 8,
    quality: 'lines',
    ...(cameraMode ? { cameraMode } : {}),
    createRenderer: () => stub,
    scheduleFrame: (cb) => ticks.push(cb)
  });
  return {
    renderer,
    runTicks: () => {
      while (ticks.length > 0) ticks.shift()?.();
    }
  };
}

/** OrbitControls is null in the headless test env (no real pointer DOM); reach it defensively. */
function controlsObject(renderer: ToolpathRenderer): unknown {
  const c = (renderer as unknown as { controls: { object: unknown } | null }).controls;
  return c ? c.object : null;
}

describe('orthographic camera (#150)', () => {
  it('defaults to a perspective camera', () => {
    const { renderer } = makeRenderer();
    expect(renderer.cameraMode).toBe('perspective');
    expect(renderer.camera).toBeInstanceOf(PerspectiveCamera);
    renderer.dispose();
  });

  it('honors cameraMode:"orthographic" at construction', () => {
    const { renderer } = makeRenderer('orthographic');
    expect(renderer.cameraMode).toBe('orthographic');
    expect(renderer.camera).toBeInstanceOf(OrthographicCamera);
    renderer.dispose();
  });

  it('setCameraMode swaps projection, preserves the pose, and toggles back', () => {
    const { renderer, runTicks } = makeRenderer();
    renderer.setIR(makeIR());
    runTicks();
    const before = renderer.camera.position.clone();

    renderer.setCameraMode('orthographic');
    expect(renderer.cameraMode).toBe('orthographic');
    expect(renderer.camera).toBeInstanceOf(OrthographicCamera);
    expect(renderer.camera.position.equals(before)).toBe(true); // pose copied, no jump
    // When OrbitControls exists it must follow the active camera.
    if (controlsObject(renderer) !== null) expect(controlsObject(renderer)).toBe(renderer.camera);

    renderer.setCameraMode('perspective');
    expect(renderer.cameraMode).toBe('perspective');
    expect(renderer.camera).toBeInstanceOf(PerspectiveCamera);
    renderer.dispose();
  });

  it('is a no-op when the requested mode is already active', () => {
    const { renderer } = makeRenderer();
    const cam = renderer.camera;
    renderer.setCameraMode('perspective');
    expect(renderer.camera).toBe(cam); // same instance — no swap
    renderer.dispose();
  });

  it('frame() sizes the ortho frustum to the model, honoring aspect', () => {
    const { renderer, runTicks } = makeRenderer('orthographic');
    renderer.resize(800, 400); // aspect 2
    renderer.setIR(makeIR());
    runTicks();
    renderer.frame();
    const cam = renderer.camera;
    if (!(cam instanceof OrthographicCamera)) throw new Error('expected an orthographic camera');
    expect(cam.top).toBeGreaterThan(0);
    expect(cam.bottom).toBe(-cam.top);
    expect(cam.right).toBeCloseTo(cam.top * 2, 5); // widened by aspect
    expect(cam.left).toBe(-cam.right);
    renderer.dispose();
  });

  it('resize keeps the ortho vertical extent fixed and scales width by aspect', () => {
    const { renderer, runTicks } = makeRenderer('orthographic');
    renderer.resize(400, 400); // aspect 1
    renderer.setIR(makeIR());
    runTicks();
    renderer.frame();
    const cam = renderer.camera as OrthographicCamera;
    const topAtSquare = cam.top;
    const rightAtSquare = cam.right;

    renderer.resize(800, 400); // aspect 2
    expect(cam.top).toBeCloseTo(topAtSquare, 5); // vertical extent unchanged
    expect(cam.right).toBeCloseTo(rightAtSquare * 2, 5); // horizontal doubled
    renderer.dispose();
  });
});

describe('preset views + camera state (#268)', () => {
  /** Expected unit direction (scene coords) from the target to the camera, per preset. */
  const DIRS: Record<CameraView, readonly [number, number, number]> = {
    top: [0, 1, 0],
    bottom: [0, -1, 0],
    front: [0, 0, 1],
    back: [0, 0, -1],
    left: [-1, 0, 0],
    right: [1, 0, 0],
    iso: [1, 1, 1]
  };
  const distance = (s: CameraState): number =>
    Math.hypot(s.position.x - s.target.x, s.position.y - s.target.y, s.position.z - s.target.z);

  it('each preset places the camera on the expected unit direction from the target', () => {
    const { renderer, runTicks } = makeRenderer();
    renderer.setIR(makeIR());
    runTicks();
    for (const view of Object.keys(DIRS) as CameraView[]) {
      renderer.setView(view);
      const s = renderer.getCameraState();
      const off = [s.position.x - s.target.x, s.position.y - s.target.y, s.position.z - s.target.z];
      const len = Math.hypot(off[0], off[1], off[2]);
      const dir = DIRS[view];
      const dl = Math.hypot(dir[0], dir[1], dir[2]);
      expect(off[0] / len).toBeCloseTo(dir[0] / dl, 5);
      expect(off[1] / len).toBeCloseTo(dir[1] / dl, 5);
      expect(off[2] / len).toBeCloseTo(dir[2] / dl, 5);
    }
    renderer.dispose();
  });

  it('setView preserves the active projection and the dolly distance', () => {
    const { renderer, runTicks } = makeRenderer('orthographic');
    renderer.setIR(makeIR());
    runTicks();
    const d0 = distance(renderer.getCameraState());
    renderer.setView('iso');
    const s = renderer.getCameraState();
    expect(s.cameraMode).toBe('orthographic');
    expect(distance(s)).toBeCloseTo(d0, 3);
    renderer.dispose();
  });

  it('getCameraState → setCameraState restores position, target, zoom, and mode', () => {
    const { renderer, runTicks } = makeRenderer();
    renderer.setIR(makeIR());
    runTicks();
    renderer.setView('right');
    const saved = renderer.getCameraState();
    renderer.setView('top'); // move somewhere else first
    renderer.setCameraState(saved);
    const back = renderer.getCameraState();
    expect(back.position.x).toBeCloseTo(saved.position.x, 6);
    expect(back.position.y).toBeCloseTo(saved.position.y, 6);
    expect(back.position.z).toBeCloseTo(saved.position.z, 6);
    expect(back.target.x).toBeCloseTo(saved.target.x, 6);
    expect(back.target.y).toBeCloseTo(saved.target.y, 6);
    expect(back.target.z).toBeCloseTo(saved.target.z, 6);
    expect(back.zoom).toBeCloseTo(saved.zoom, 6);
    expect(back.cameraMode).toBe(saved.cameraMode);
    renderer.dispose();
  });

  it('setCameraState also restores the projection (ortho state onto a perspective renderer)', () => {
    const { renderer, runTicks } = makeRenderer(); // starts perspective
    renderer.setIR(makeIR());
    runTicks();
    renderer.setCameraState({
      position: { x: 10, y: 20, z: 30 },
      target: { x: 0, y: 0, z: 0 },
      zoom: 1,
      cameraMode: 'orthographic'
    });
    expect(renderer.cameraMode).toBe('orthographic');
    expect(renderer.camera).toBeInstanceOf(OrthographicCamera);
    renderer.dispose();
  });
});
