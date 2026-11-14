// @vitest-environment happy-dom
/**
 * A `pixelRatio` option that changes the ratio must not stop the stage from starting. The stub GL renders like
 * three: it reads `camera.parent` first, so a frame drawn before the cameras exist throws exactly as the real
 * renderer did (`Cannot read properties of undefined (reading 'parent')`). Every expected value is a literal.
 */
import { describe, expect, it } from 'vitest';
import { Scene, Vector3, type Camera } from 'three';
import { InteractiveStage, type ControlsLike, type DisplayEnv, type GLRendererLike } from '../index.js';

/** Records the camera of every frame; reads `.parent` the way three's `WebGLRenderer.render` does. */
function makeCameraGl(canvas: HTMLCanvasElement) {
  const cameras: Camera[] = [];
  const stub: GLRendererLike = {
    render: (_scene, camera) => {
      // three: `if (camera.parent === null && camera.matrixWorldAutoUpdate === true) camera.updateMatrixWorld()`
      void (camera as Camera).parent;
      cameras.push(camera as Camera);
    },
    setSize: () => undefined,
    setPixelRatio: () => undefined,
    getPixelRatio: () => 1,
    dispose: () => undefined,
    domElement: canvas
  };
  return { stub, cameras };
}

function stubControls(camera: ControlsLike['object']): ControlsLike {
  return {
    object: camera,
    target: new Vector3(),
    enabled: true,
    update: () => undefined,
    dispose: () => undefined,
    addEventListener: () => undefined,
    listenToKeyEvents: () => undefined
  };
}

function start(pixelRatio: 2 | 'device', dpr: number) {
  const canvas = document.createElement('canvas');
  const gl = makeCameraGl(canvas);
  const env: DisplayEnv = { devicePixelRatio: dpr };
  let error = 'none';
  let stage: InteractiveStage | null = null;
  try {
    stage = new InteractiveStage({
      canvas,
      scene: new Scene(),
      pixelRatio,
      displayEnv: env,
      createRenderer: () => gl.stub,
      createControls: stubControls
    });
  } catch (e) {
    error = (e as Error).message;
  }
  return { stage, error, cameras: gl.cameras };
}

describe('InteractiveStage starts with a pixelRatio option', () => {
  it.each([
    [2, 1],
    [2, 2],
    ['device', 2]
  ] as const)('pixelRatio %s at DPR %s: constructs, and its repaint uses the perspective camera', (ratio, dpr) => {
    const h = start(ratio, dpr);
    expect(h.error).toBe('none');
    // The ratio change repaints once, through the camera the stage just built.
    expect(h.cameras.length).toBe(1);
    expect(h.cameras[0]).toBe(h.stage!.perspectiveCamera);
    expect(h.cameras[0]!.type).toBe('PerspectiveCamera');
  });

  it("'device' at DPR 1 changes nothing, so it draws no start-up frame", () => {
    const h = start('device', 1);
    expect(h.error).toBe('none');
    expect(h.cameras.length).toBe(0);
  });
});
