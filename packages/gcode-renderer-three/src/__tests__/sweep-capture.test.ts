// @vitest-environment happy-dom
/**
 * Renderer-three sweep 4, PR-B — InteractiveStage.capture(). The pixel encode is browser-only, so it is replaced
 * by a recorder; everything the stage does around it (guards, borrowed aspect/background, target lifetime, flip,
 * format/quality hand-off) is asserted with literal values.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Color, Scene, Vector3, type WebGLRenderTarget } from 'three';
import { InteractiveStage, type ControlsLike, type GLRendererLike } from '../index.js';

const encode = vi.hoisted(() => vi.fn());
vi.mock('../capture.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../capture.js')>()),
  encodeRGBAToBlob: encode
}));

interface InTargetFrame {
  perspectiveAspect: number;
  orthoRight: number;
  background: string | null;
}

function makeStage(opts: { canCapture?: boolean; fill?: (buf: Uint8Array) => void } = {}) {
  const canvas = document.createElement('canvas');
  const scene = new Scene();
  scene.background = new Color('#112233');
  const frames: InTargetFrame[] = [];
  const state = {
    targetDisposed: 0,
    targetsSeen: 0,
    targetSizes: [] as number[][],
    reads: [] as number[][]
  };
  const ref: { stage?: InteractiveStage } = {};
  let inTarget = false;
  const stub: GLRendererLike & {
    setRenderTarget?: (t: unknown) => void;
    readRenderTargetPixels?: (t: unknown, x: number, y: number, w: number, h: number, b: Uint8Array) => void;
  } = {
    render: () => {
      if (!inTarget) return;
      frames.push({
        perspectiveAspect: ref.stage!.perspectiveCamera.aspect,
        orthoRight: ref.stage!.orthographicCamera.right,
        background: scene.background === null ? null : (scene.background as Color).getHexString()
      });
    },
    setSize: () => undefined,
    setPixelRatio: () => undefined,
    getPixelRatio: () => 1,
    dispose: () => undefined,
    domElement: canvas
  };
  if (opts.canCapture !== false) {
    stub.setRenderTarget = (t) => {
      inTarget = t !== null;
      if (t !== null) {
        state.targetsSeen++;
        state.targetSizes.push([(t as WebGLRenderTarget).width, (t as WebGLRenderTarget).height]);
        (t as WebGLRenderTarget).addEventListener('dispose', () => state.targetDisposed++);
      }
    };
    stub.readRenderTargetPixels = (_t, x, y, w, h, buf) => {
      state.reads.push([x, y, w, h]);
      opts.fill?.(buf);
    };
  }
  const stage = new InteractiveStage({
    canvas,
    scene,
    createRenderer: () => stub,
    createControls: (cam): ControlsLike => ({
      object: cam,
      target: new Vector3(),
      enabled: true,
      update: () => undefined,
      dispose: () => undefined,
      addEventListener: () => undefined,
      listenToKeyEvents: () => undefined
    })
  });
  ref.stage = stage;
  return { stage, canvas, scene, frames, state };
}

beforeEach(() => {
  encode.mockReset();
  encode.mockImplementation(async () => new Blob(['x'], { type: 'image/png' }));
});

describe('capture — unavailable', () => {
  it('a disposed stage rejects with the literal reason and never builds a target', async () => {
    const h = makeStage();
    h.stage.dispose();
    await expect(h.stage.capture({ width: 4, height: 4 })).rejects.toMatchObject({
      code: 'E_CAPTURE_UNSUPPORTED',
      message: 'capture unavailable: stage disposed'
    });
    expect(h.state.targetsSeen).toBe(0);
  });

  it('a context-lost stage rejects with the literal reason', async () => {
    const h = makeStage();
    h.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    await expect(h.stage.capture({ width: 4, height: 4 })).rejects.toMatchObject({
      code: 'E_CAPTURE_UNSUPPORTED',
      message: 'capture unavailable: WebGL context lost'
    });
    expect(h.state.targetsSeen).toBe(0);
  });

  it('a renderer that cannot render-to-target rejects with the literal reason', async () => {
    const h = makeStage({ canCapture: false });
    await expect(h.stage.capture({ width: 4, height: 4 })).rejects.toMatchObject({
      code: 'E_CAPTURE_UNSUPPORTED',
      message: 'capture unavailable: renderer cannot render-to-target'
    });
  });

  it('a live stage captures (control)', async () => {
    const h = makeStage();
    await expect(h.stage.capture({ width: 4, height: 4 })).resolves.toBeInstanceOf(Blob);
    expect(encode).toHaveBeenCalledTimes(1);
  });
});

describe('capture — what the off-screen render sees', () => {
  it("frames at the capture's own aspect, then restores the live one", async () => {
    const h = makeStage();
    h.stage.resize(800, 400);
    await h.stage.capture({ width: 40, height: 10 });
    expect(h.frames).toEqual([{ perspectiveAspect: 4, orthoRight: 400, background: '112233' }]);
    expect(h.stage.perspectiveCamera.aspect).toBe(2);
    expect(h.stage.orthographicCamera.right).toBe(200);
  });

  it.each([
    [40, 10],
    [10, 40]
  ])('the off-screen target and the readback are both %i x %i (width first)', async (w, h) => {
    const hh = makeStage();
    await hh.stage.capture({ width: w, height: h });
    expect(hh.state.targetSizes).toEqual([[w, h]]);
    expect(hh.state.reads).toEqual([[0, 0, w, h]]);
  });

  it('a colour background replaces the scene background for the render only', async () => {
    const h = makeStage();
    await h.stage.capture({ width: 4, height: 4, background: '#ff0000' });
    expect(h.frames.map((f) => f.background)).toEqual(['ff0000']);
    expect((h.scene.background as Color).getHexString()).toBe('112233');
  });

  it('background: transparent clears the scene background for the render only', async () => {
    const h = makeStage();
    await h.stage.capture({ width: 4, height: 4, background: 'transparent' });
    expect(h.frames.map((f) => f.background)).toEqual([null]);
    expect((h.scene.background as Color).getHexString()).toBe('112233');
  });

  it('a numeric background is a colour too', async () => {
    const h = makeStage();
    await h.stage.capture({ width: 4, height: 4, background: 0x00ff00 });
    expect(h.frames.map((f) => f.background)).toEqual(['00ff00']);
  });

  it('releases the off-screen target exactly once', async () => {
    const h = makeStage();
    await h.stage.capture({ width: 4, height: 4 });
    expect(h.state.targetsSeen).toBe(1);
    expect(h.state.targetDisposed).toBe(1);
  });
});

describe('capture — encode hand-off', () => {
  it('flips the bottom-up readback to top-down rows before encoding', async () => {
    const h = makeStage({
      fill: (buf) => {
        for (let i = 0; i < buf.length; i++) buf[i] = i + 1; // 2x2 RGBA: row0 = 1..8, row1 = 9..16
      }
    });
    await h.stage.capture({ width: 2, height: 2 });
    const [rgba, w, hh] = encode.mock.calls[0];
    expect([w, hh]).toEqual([2, 2]);
    expect(Array.from(rgba as Uint8Array)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('defaults to PNG with no quality', async () => {
    const h = makeStage();
    await h.stage.capture({ width: 2, height: 2 });
    expect(encode.mock.calls[0].slice(1)).toEqual([2, 2, 'image/png', undefined]);
  });

  it('passes an explicit format and quality through', async () => {
    const h = makeStage();
    await h.stage.capture({ width: 3, height: 5, format: 'image/jpeg', quality: 0.5 });
    expect(encode.mock.calls[0].slice(1)).toEqual([3, 5, 'image/jpeg', 0.5]);
  });
});
