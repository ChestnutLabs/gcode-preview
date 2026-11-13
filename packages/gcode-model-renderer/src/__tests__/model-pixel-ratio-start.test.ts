// @vitest-environment happy-dom
/**
 * The model viewer builds the same InteractiveStage, so a `pixelRatio` option that changes the ratio must not
 * stop it from starting either. The stub GL reads `camera.parent` the way three's `render` does, so a frame
 * drawn before the cameras exist throws as the real renderer did. Literal values.
 */
import { describe, expect, it } from 'vitest';
import { Vector3, type Camera } from 'three';
import type { ControlsLike, GLRendererLike } from '@chestnutlabs/gcode-renderer-three';
import { createModelViewer } from '../model-viewer.js';
import { createModelPreviewController } from '../model-preview.js';

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

/** Records each frame's camera type; reads `.parent` first, like three. */
function cameraGl() {
  const cameras: string[] = [];
  const createRenderer = (canvas: HTMLCanvasElement | OffscreenCanvas): GLRendererLike => ({
    render: (_scene, camera) => {
      void (camera as Camera).parent;
      cameras.push((camera as Camera).type);
    },
    setSize: () => undefined,
    setPixelRatio: () => undefined,
    dispose: () => undefined,
    domElement: canvas
  });
  return { cameras, createRenderer };
}

const messageOf = (fn: () => void): string => {
  try {
    fn();
    return 'none';
  } catch (e) {
    return (e as Error).message;
  }
};

describe('model viewer starts with a pixelRatio option', () => {
  it('createModelViewer({ pixelRatio: 2 }) constructs, and its first frame has the perspective camera', () => {
    const g = cameraGl();
    const err = messageOf(() =>
      createModelViewer(document.createElement('canvas'), {
        createRenderer: g.createRenderer,
        createControls: stubControls,
        pixelRatio: 2
      })
    );
    expect(err).toBe('none');
    expect(g.cameras[0]).toBe('PerspectiveCamera');
  });

  it('createModelPreviewController({ pixelRatio: 2 }) binds a canvas with no error', () => {
    const g = cameraGl();
    const c = createModelPreviewController({
      createRenderer: g.createRenderer,
      createControls: stubControls,
      pixelRatio: 2
    });
    const err = messageOf(() => c.bindCanvas(document.createElement('canvas')));
    expect(err).toBe('none');
    expect(c.getState().error).toBe(null);
    expect(g.cameras[0]).toBe('PerspectiveCamera');
    c.dispose();
  });
});
