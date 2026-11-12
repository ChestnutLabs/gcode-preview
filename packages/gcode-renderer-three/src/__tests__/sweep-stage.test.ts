// @vitest-environment happy-dom
/**
 * Renderer-three sweep PR 2 — InteractiveStage / capture / interaction-quality guards. Every expectation is a
 * literal; each block maps to a defect found by probing (bare-click ratio clobber, keyboard stuck-reduced,
 * capture target leak + concurrent-capture corruption, unvalidated sizes / camera state).
 */
import { describe, expect, it } from 'vitest';
import { Color, OrthographicCamera, PerspectiveCamera, Scene, Vector3 } from 'three';
import { InteractiveStage, type CameraState, type ControlsLike, type GLRendererLike } from '../index.js';
import { checkCaptureArea, checkCaptureSize } from '../capture.js';

function stubControls(camera: PerspectiveCamera | OrthographicCamera) {
  const listeners: Record<string, (() => void)[]> = {};
  const c: ControlsLike & { fire(t: string): void } = {
    object: camera,
    target: new Vector3(),
    enabled: true,
    update: () => undefined,
    dispose: () => undefined,
    addEventListener: (t, cb) => {
      (listeners[t] ??= []).push(cb);
    },
    listenToKeyEvents: () => undefined,
    fire: (t) => (listeners[t] ?? []).forEach((cb) => cb())
  };
  return c;
}

interface GlLog {
  ratios: number[];
  targets: (unknown | null)[];
  renders: number;
}

function makeStage(
  opts: {
    interactionQuality?: 'off' | 'auto';
    glRatio?: number;
    throwOn?: 'render' | 'read';
    canvasSize?: [number, number];
  } = {}
) {
  const canvas = document.createElement('canvas');
  if (opts.canvasSize) {
    canvas.width = opts.canvasSize[0];
    canvas.height = opts.canvasSize[1];
  }
  const scene = new Scene();
  const log: GlLog = { ratios: [], targets: [], renders: 0 };
  let inTarget = false;
  const stub: GLRendererLike & {
    setRenderTarget: (t: unknown) => void;
    readRenderTargetPixels: () => void;
  } = {
    render: () => {
      log.renders++;
      if (inTarget && opts.throwOn === 'render') throw new Error('render boom');
    },
    setSize: () => undefined,
    setPixelRatio: (r: number) => log.ratios.push(r),
    getPixelRatio: () => opts.glRatio ?? 1,
    dispose: () => undefined,
    domElement: canvas,
    setRenderTarget: (t) => {
      log.targets.push(t);
      inTarget = t !== null;
    },
    readRenderTargetPixels: () => {
      if (opts.throwOn === 'read') throw new Error('read boom');
    }
  };
  let controls: ReturnType<typeof stubControls> | null = null;
  let rendererCalls = 0;
  const stage = new InteractiveStage({
    canvas,
    scene,
    interactionQuality: opts.interactionQuality,
    createRenderer: () => {
      rendererCalls++;
      return stub;
    },
    createControls: (cam) => (controls = stubControls(cam))
  });
  return {
    stage,
    scene,
    log,
    rendererCalls: () => rendererCalls,
    get controls() {
      return controls!;
    }
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('interaction quality — gesture bracketing', () => {
  it("a bare click ('end' with no 'change') never rewrites the renderer's own pixel ratio", async () => {
    const h = makeStage({ interactionQuality: 'auto', glRatio: 2 });
    h.controls.fire('start');
    h.controls.fire('end');
    await wait(220);
    expect(h.log.ratios).toEqual([]);
    h.stage.dispose();
  });

  it('a keyboard move (change with no start/end) is restored on its own after the debounce', async () => {
    const h = makeStage({ interactionQuality: 'auto', glRatio: 2 });
    h.controls.fire('change');
    expect(h.log.ratios).toEqual([1.2]);
    await wait(220);
    expect(h.log.ratios).toEqual([1.2, 2]);
    h.stage.dispose();
  });

  it('a pointer gesture is NOT restored mid-drag, only after its end', async () => {
    const h = makeStage({ interactionQuality: 'auto', glRatio: 2 });
    h.controls.fire('start');
    h.controls.fire('change');
    await wait(220); // held still mid-drag: still reduced
    expect(h.log.ratios).toEqual([1.2]);
    h.controls.fire('end');
    await wait(220);
    expect(h.log.ratios).toEqual([1.2, 2]);
    h.stage.dispose();
  });

  it("the next keyboard move after a pointer gesture is restored too ('end' clears the pointer flag)", async () => {
    const h = makeStage({ interactionQuality: 'auto', glRatio: 2 });
    h.controls.fire('start');
    h.controls.fire('change');
    h.controls.fire('end');
    await wait(220);
    h.controls.fire('change');
    await wait(220);
    expect(h.log.ratios).toEqual([1.2, 2, 1.2, 2]);
    h.stage.dispose();
  });
});

describe('capture — cleanup on failure', () => {
  for (const throwOn of ['render', 'read'] as const) {
    it(`a throw in ${throwOn} hands the canvas back (setRenderTarget(null)) and restores aspect + background`, async () => {
      const h = makeStage({ throwOn });
      h.stage.resize(800, 400);
      h.scene.background = new Color('#112233');
      const rendersBefore = h.log.renders;
      await expect(h.stage.capture({ width: 40, height: 10, background: 'transparent' })).rejects.toThrow(
        throwOn === 'render' ? 'render boom' : 'read boom'
      );
      expect(h.log.targets.length).toBe(2);
      expect(h.log.targets[1]).toBeNull();
      expect(h.stage.perspectiveCamera.aspect).toBe(2);
      expect((h.scene.background as Color).getHexString()).toBe('112233');
      expect(h.log.renders).toBeGreaterThan(rendersBefore + 1); // the live repaint ran after the target was released
    });
  }
});

describe('capture — overlapping captures', () => {
  it('two un-awaited captures leave the live aspect and scene background exactly as they were', async () => {
    const h = makeStage();
    h.stage.resize(800, 400);
    h.scene.background = new Color('#112233');
    const a = h.stage.capture({ width: 100, height: 50, background: '#ff0000' });
    const b = h.stage.capture({ width: 10, height: 10, background: 'transparent' });
    await Promise.allSettled([a, b]); // the pixel encode is browser-only and may reject here
    expect(h.stage.perspectiveCamera.aspect).toBe(2);
    expect((h.scene.background as Color).getHexString()).toBe('112233');
    expect(h.log.targets.at(-1)).toBeNull();
  });
});

describe('capture — option validation', () => {
  it('rejects a non-finite / non-number / oversized size with RangeError and touches nothing', async () => {
    const h = makeStage();
    const bad: Record<string, number | string>[] = [
      { width: NaN },
      { height: Infinity },
      { width: -Infinity },
      { width: 16385 },
      { height: 20000 },
      { width: '5' }
    ];
    for (const o of bad) {
      await expect(h.stage.capture(o as never)).rejects.toBeInstanceOf(RangeError);
    }
    // area: a 16384-wide request against a tall live buffer
    const tall = makeStage({ canvasSize: [100, 100000] });
    await expect(tall.stage.capture({ width: 16384 })).rejects.toThrow('exceeds 67108864 pixels');
    expect(h.log.targets).toEqual([]);
    expect(tall.log.targets).toEqual([]);
  });

  it('checkCaptureSize / checkCaptureArea boundaries (literal limits)', () => {
    expect(() => checkCaptureSize({ width: 16384, height: 16384 })).not.toThrow();
    expect(() => checkCaptureSize({ width: 16384.4 })).not.toThrow(); // rounds to 16384
    expect(() => checkCaptureSize({ width: 16384.5 })).toThrow(RangeError); // rounds to 16385
    expect(() => checkCaptureSize({ width: 0, height: -5 })).not.toThrow(); // ≤0 still clamps to 1
    expect(() => checkCaptureSize({})).not.toThrow();
    expect(() => checkCaptureArea(8192, 8192)).not.toThrow(); // exactly 67108864
    expect(() => checkCaptureArea(8192, 8193)).toThrow(RangeError);
    expect(() => checkCaptureArea(NaN, 4)).toThrow(RangeError);
  });
});

describe('camera — invalid consumer input throws RangeError and changes nothing', () => {
  const good: CameraState = {
    position: { x: 10, y: 20, z: 30 },
    target: { x: 1, y: 2, z: 3 },
    zoom: 2,
    cameraMode: 'perspective'
  };
  const variants: [string, unknown][] = [
    ['NaN position', { ...good, position: { x: NaN, y: 0, z: 0 } }],
    ['Infinity target', { ...good, target: { x: 0, y: Infinity, z: 0 } }],
    ['string coordinate', { ...good, position: { x: '1', y: 0, z: 0 } }],
    ['missing position', { ...good, position: undefined }],
    ['null target', { ...good, target: null }],
    ['zero zoom', { ...good, zoom: 0 }],
    ['negative zoom', { ...good, zoom: -1 }],
    ['NaN zoom', { ...good, zoom: NaN }],
    ['bad mode', { ...good, cameraMode: 'isometric' }],
    ['null state', null]
  ];
  // Each axis of each vector on its own, so dropping any one `Number.isFinite` check is caught.
  const poseAxisVariants: [string, CameraState, string][] = [
    [
      'NaN position.z',
      { ...good, position: { x: 0, y: 0, z: NaN } },
      'camera state position must be {x, y, z} finite numbers'
    ],
    [
      'NaN target.z',
      { ...good, target: { x: 0, y: 0, z: NaN } },
      'camera state target must be {x, y, z} finite numbers'
    ],
    [
      'NaN position.x',
      { ...good, position: { x: NaN, y: 0, z: 0 } },
      'camera state position must be {x, y, z} finite numbers'
    ],
    [
      'NaN target.y',
      { ...good, target: { x: 0, y: NaN, z: 0 } },
      'camera state target must be {x, y, z} finite numbers'
    ]
  ];
  for (const [name, state, message] of poseAxisVariants) {
    it(`setCameraState rejects ${name} with the literal message and keeps the pose`, () => {
      const h = makeStage();
      h.stage.setCameraState(good);
      const before = JSON.stringify(h.stage.getCameraState());
      expect(() => h.stage.setCameraState(state)).toThrow(RangeError);
      expect(() => h.stage.setCameraState(state)).toThrow(message);
      expect(JSON.stringify(h.stage.getCameraState())).toBe(before);
    });
  }

  for (const [name, state] of variants) {
    it(`setCameraState rejects ${name}`, () => {
      const h = makeStage();
      h.stage.setCameraState(good);
      const before = JSON.stringify(h.stage.getCameraState());
      expect(() => h.stage.setCameraState(state as CameraState)).toThrow(RangeError);
      expect(JSON.stringify(h.stage.getCameraState())).toBe(before);
      expect(h.stage.cameraMode).toBe('perspective');
    });
  }

  it('setCameraMode rejects an unknown mode and keeps the projection', () => {
    const h = makeStage();
    expect(() => h.stage.setCameraMode('fisheye' as never)).toThrow(
      "cameraMode must be 'perspective' or 'orthographic'"
    );
    expect(h.stage.cameraMode).toBe('perspective');
    expect(h.stage.activeCamera).toBeInstanceOf(PerspectiveCamera);
  });

  it('the constructor rejects a bad cameraMode before any GL resource exists', () => {
    let calls = 0;
    expect(
      () =>
        new InteractiveStage({
          canvas: document.createElement('canvas'),
          scene: new Scene(),
          cameraMode: 'nope' as never,
          createRenderer: () => {
            calls++;
            return {
              render: () => 0,
              setSize: () => 0,
              dispose: () => 0,
              domElement: document.createElement('canvas')
            };
          }
        })
    ).toThrow(RangeError);
    expect(calls).toBe(0);
  });

  it('setCameraState validates the mode up front, even on a disposed stage', () => {
    const h = makeStage();
    h.stage.dispose();
    expect(() => h.stage.setCameraState({ ...good, cameraMode: 'isometric' as never })).toThrow(
      "cameraMode must be 'perspective' or 'orthographic' (got isometric)"
    );
  });

  it('a valid state still restores (control)', () => {
    const h = makeStage();
    h.stage.setCameraState({ ...good, cameraMode: 'orthographic' });
    expect(h.stage.cameraMode).toBe('orthographic');
    expect(h.stage.getCameraState().position).toEqual({ x: 10, y: 20, z: 30 });
    expect(h.stage.getCameraState().zoom).toBe(2);
  });
});
