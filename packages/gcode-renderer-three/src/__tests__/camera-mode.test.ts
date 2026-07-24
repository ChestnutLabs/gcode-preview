// @vitest-environment happy-dom
/**
 * Orthographic camera (#150, DD-009 D3): the construction option, runtime
 * setCameraMode with pose preservation, and frustum sizing on frame()/resize().
 * Uses a stub GL; the two cameras are pure three objects, so no real WebGL is needed.
 */
import { describe, expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera } from 'three';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer, type CameraMode, type GLRendererLike } from '../index.js';

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
