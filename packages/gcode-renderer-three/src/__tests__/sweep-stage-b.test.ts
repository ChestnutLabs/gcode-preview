// @vitest-environment happy-dom
/**
 * Renderer-three sweep 4, PR-B — InteractiveStage resize / DPR watcher / dispose guards / controls gating.
 * Test-only; every expectation is a literal value. Each block pins a clause that had no assertion.
 */
import { describe, expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Scene, Vector3 } from 'three';
import { InteractiveStage, type ControlsLike, type DisplayEnv, type GLRendererLike } from '../index.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stubControls(camera: PerspectiveCamera | OrthographicCamera) {
  const listeners: Record<string, (() => void)[]> = {};
  const c: ControlsLike & { fire(t: string): void; disposeCalls: number } = {
    object: camera,
    target: new Vector3(),
    enabled: true,
    update: () => undefined,
    dispose: () => {
      c.disposeCalls++;
    },
    addEventListener: (t, cb) => {
      (listeners[t] ??= []).push(cb);
    },
    listenToKeyEvents: () => undefined,
    fire: (t) => (listeners[t] ?? []).forEach((cb) => cb()),
    disposeCalls: 0
  };
  return c;
}

interface FakeQuery {
  q: string;
  adds: number;
  removes: number;
  listener: (() => void) | null;
}

/** A display whose `matchMedia` records every query it hands out and lets a test fire its `change`. */
function fakeDisplay(dpr: unknown) {
  const queries: FakeQuery[] = [];
  const env = {
    devicePixelRatio: dpr as number,
    matchMedia(q: string) {
      const rec: FakeQuery = { q, adds: 0, removes: 0, listener: null };
      queries.push(rec);
      return {
        addEventListener: (_t: 'change', cb: () => void) => {
          rec.adds++;
          rec.listener = cb;
        },
        removeEventListener: () => {
          rec.removes++;
        }
      };
    }
  };
  return { env: env as DisplayEnv & { devicePixelRatio: number }, queries };
}

function makeHarness(
  opts: {
    interactionQuality?: 'off' | 'auto';
    glRatio?: number;
    pixelRatio?: number | 'device';
    displayEnv?: DisplayEnv;
    domElement?: unknown;
  } = {}
) {
  const canvas = document.createElement('canvas');
  const scene = new Scene();
  const log = {
    ratios: [] as number[],
    renders: 0,
    sizes: [] as [number, number, boolean | undefined][],
    glDisposed: 0,
    createControls: 0,
    lost: 0,
    restored: 0
  };
  const stub: GLRendererLike = {
    render: () => {
      log.renders++;
    },
    setSize: (w: number, h: number, u?: boolean) => {
      log.sizes.push([w, h, u]);
    },
    setPixelRatio: (r: number) => log.ratios.push(r),
    getPixelRatio: () => opts.glRatio ?? 1,
    dispose: () => {
      log.glDisposed++;
    },
    domElement: (opts.domElement ?? canvas) as HTMLCanvasElement
  };
  let controls: ReturnType<typeof stubControls> | null = null;
  const stage = new InteractiveStage({
    canvas,
    scene,
    interactionQuality: opts.interactionQuality,
    pixelRatio: opts.pixelRatio,
    displayEnv: opts.displayEnv,
    createRenderer: () => stub,
    createControls: (cam) => {
      log.createControls++;
      return (controls = stubControls(cam));
    },
    onContextLost: () => log.lost++,
    onContextRestored: () => log.restored++
  });
  return {
    stage,
    canvas,
    log,
    get controls() {
      return controls!;
    }
  };
}

describe('resize', () => {
  it('sizes the GL without touching the canvas style, and repaints exactly once', () => {
    const h = makeHarness();
    const before = h.log.renders;
    h.stage.resize(800, 400);
    expect(h.log.sizes).toEqual([[800, 400, false]]);
    expect(h.log.renders).toBe(before + 1);
    expect(h.stage.perspectiveCamera.aspect).toBe(2);
    expect(h.stage.orthographicCamera.right).toBe(200); // viewHalfHeight 100 * aspect 2
  });

  it('a hidden canvas (either side 0) keeps the last real aspect', () => {
    const h = makeHarness();
    h.stage.resize(800, 400);
    h.stage.resize(800, 0);
    expect(h.stage.perspectiveCamera.aspect).toBe(2);
    h.stage.resize(0, 400);
    expect(h.stage.perspectiveCamera.aspect).toBe(2);
    h.stage.resize(0, 0);
    expect(h.stage.perspectiveCamera.aspect).toBe(2);
    // …but the GL is still told the (hidden) size
    expect(h.log.sizes.at(-1)).toEqual([0, 0, false]);
  });

  it('after dispose, resize and render do nothing', () => {
    const h = makeHarness();
    h.stage.resize(800, 400);
    h.stage.dispose();
    const renders = h.log.renders;
    const sizes = h.log.sizes.length;
    h.stage.resize(100, 100);
    h.stage.render();
    expect(h.log.sizes.length).toBe(sizes);
    expect(h.log.renders).toBe(renders);
    expect(h.stage.perspectiveCamera.aspect).toBe(2);
  });
});

describe('viewDirection', () => {
  it('is the unit vector from the orbit target to the camera', () => {
    const h = makeHarness();
    h.stage.setCameraState({
      position: { x: 10, y: 30, z: 40 },
      target: { x: 10, y: 0, z: 0 },
      zoom: 1,
      cameraMode: 'perspective'
    });
    const d = h.stage.viewDirection();
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.y).toBeCloseTo(0.6, 6);
    expect(d.z).toBeCloseTo(0.8, 6);
  });
});

describe('dispose guards', () => {
  it('a second dispose releases nothing twice', () => {
    const h = makeHarness();
    h.stage.dispose();
    h.stage.dispose();
    expect(h.log.glDisposed).toBe(1);
    expect(h.controls.disposeCalls).toBe(1);
    expect(h.stage.disposed).toBe(true);
  });

  it('dispose cancels a pending settle: the debounce never fires on a disposed stage', async () => {
    const h = makeHarness({ interactionQuality: 'auto', glRatio: 2 });
    h.controls.fire('change');
    h.controls.fire('end');
    expect(h.log.ratios).toEqual([1.2]);
    h.stage.dispose();
    await wait(220);
    expect(h.log.ratios).toEqual([1.2]);
  });

  it('dispose detaches the context-loss listeners', () => {
    const h = makeHarness();
    h.stage.dispose();
    h.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    h.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(h.log.lost).toBe(0);
    expect(h.log.restored).toBe(0);
  });

  it('the context-loss listeners are live before dispose (control)', () => {
    const h = makeHarness();
    h.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    h.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(h.log.lost).toBe(1);
    expect(h.log.restored).toBe(1);
  });

  it('setInteractionQuality, onInteractionFrame and settleInteraction are no-ops once disposed', async () => {
    const h = makeHarness({ interactionQuality: 'auto', glRatio: 2 });
    h.controls.fire('change'); // reduced to 1.2
    h.stage.dispose();
    h.stage.setInteractionQuality('off'); // would restore the resting ratio 2
    expect(h.log.ratios).toEqual([1.2]);
    h.stage.onInteractionFrame();
    h.stage.settleInteraction();
    await wait(220);
    expect(h.log.ratios).toEqual([1.2]);
  });

  it('onInteractionFrame on a disposed stage that never gestured does not touch the renderer ratio', () => {
    const h = makeHarness({ interactionQuality: 'auto', glRatio: 2 });
    h.stage.dispose();
    h.stage.onInteractionFrame();
    expect(h.log.ratios).toEqual([]);
  });

  it('setPixelRatio after dispose neither arms a display watcher nor loses its validation', () => {
    const d = fakeDisplay(2);
    const h = makeHarness({ displayEnv: d.env });
    h.stage.dispose();
    h.stage.setPixelRatio('device');
    expect(d.queries.length).toBe(0);
    expect(() => h.stage.setPixelRatio(0)).toThrow(RangeError);
  });
});

describe("pixelRatio: 'device' watcher", () => {
  it('arms one (resolution: Xdppx) query for the display ratio and follows it', () => {
    const d = fakeDisplay(1.5);
    const h = makeHarness({ pixelRatio: 'device', displayEnv: d.env });
    expect(d.queries.map((q) => q.q)).toEqual(['(resolution: 1.5dppx)']);
    expect(d.queries[0].adds).toBe(1);
    expect(h.log.ratios).toEqual([1.5]);
    d.env.devicePixelRatio = 2;
    d.queries[0].listener!();
    expect(d.queries[0].removes).toBe(1); // the old query is released before the new one is armed
    expect(d.queries.map((q) => q.q)).toEqual(['(resolution: 1.5dppx)', '(resolution: 2dppx)']);
    expect(h.log.ratios).toEqual([1.5, 2]);
  });

  it('a non-numeric display ratio is read as 1 and arms nothing', () => {
    const d = fakeDisplay('2');
    makeHarness({ pixelRatio: 'device', displayEnv: d.env });
    expect(d.queries.length).toBe(0);
  });

  it('a zero display ratio is read as 1 and arms nothing', () => {
    const d = fakeDisplay(0);
    const h = makeHarness({ pixelRatio: 'device', displayEnv: d.env });
    expect(d.queries.length).toBe(0);
    expect(h.log.ratios).toEqual([]); // already at 1: nothing to apply
  });

  it('a display that stops reporting a ratio leaves exactly one release of the old query, even across dispose', () => {
    const d = fakeDisplay(2);
    const h = makeHarness({ pixelRatio: 'device', displayEnv: d.env });
    d.env.devicePixelRatio = 0;
    d.queries[0].listener!(); // re-arm finds no usable ratio: nothing new is armed
    expect(d.queries.length).toBe(1);
    expect(d.queries[0].removes).toBe(1);
    h.stage.dispose();
    expect(d.queries[0].removes).toBe(1); // already released: not released a second time
  });

  it('a late change event after dispose changes nothing', () => {
    const d = fakeDisplay(2);
    const h = makeHarness({ pixelRatio: 'device', displayEnv: d.env });
    expect(h.log.ratios).toEqual([2]);
    h.stage.dispose();
    expect(d.queries[0].removes).toBe(1);
    d.env.devicePixelRatio = 1;
    d.queries[0].listener!(); // a stale callback the host had already queued
    expect(h.log.ratios).toEqual([2]);
  });

  it('switching to a number releases the display watcher', () => {
    const d = fakeDisplay(2);
    const h = makeHarness({ pixelRatio: 'device', displayEnv: d.env });
    h.stage.setPixelRatio(1);
    expect(d.queries[0].removes).toBe(1);
    expect(h.log.ratios).toEqual([2, 1]);
  });
});

describe('controls are only built for a real DOM canvas', () => {
  it('a canvas with `style` but no addEventListener gets no controls', () => {
    const h = makeHarness({ domElement: { style: {}, width: 1, height: 1 } });
    expect(h.log.createControls).toBe(0);
    expect(h.stage.controls).toBeNull();
  });

  it('a canvas with addEventListener but no `style` (OffscreenCanvas-like) gets no controls', () => {
    const h = makeHarness({ domElement: { addEventListener: () => undefined, width: 1, height: 1 } });
    expect(h.log.createControls).toBe(0);
    expect(h.stage.controls).toBeNull();
  });

  it('a real HTMLCanvasElement gets controls (control)', () => {
    const h = makeHarness();
    expect(h.log.createControls).toBe(1);
    expect(h.stage.controls).not.toBeNull();
  });
});
