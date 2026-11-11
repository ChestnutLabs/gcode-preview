// @vitest-environment happy-dom
/**
 * The opt-in resting pixel ratio: the interaction-quality rebase, the stage option/setter, the `'device'`
 * DPR watcher, the unchanged default capture size, and the ToolpathRenderer pass-through. A stub GL models
 * three's drawing-buffer sizing (canvas = floor(CSS size × ratio)). Every expected value is a literal.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scene, Vector3, type OrthographicCamera, type PerspectiveCamera } from 'three';
import {
  InteractionQualityController,
  InteractiveStage,
  ToolpathRenderer,
  type ControlsLike,
  type DisplayEnv,
  type GLRendererLike,
  type MediaQueryListLike,
  type PixelRatioOption
} from '../index.js';

afterEach(() => {
  vi.useRealTimers();
});

/** A frame queue fed literal timestamps, so the interaction ramp is deterministic. */
function makeQuality(mode: 'off' | 'auto', base: number) {
  const ratios: number[] = [];
  const queue: ((t: number) => void)[] = [];
  const c = new InteractionQualityController(
    {
      setPixelRatio: (r) => ratios.push(r),
      render: () => undefined,
      getPixelRatio: () => base,
      requestFrame: (cb) => queue.push(cb),
      cancelFrame: () => undefined
    },
    mode
  );
  const tick = (t: number): void => {
    for (const cb of queue.splice(0)) cb(t);
  };
  return { c, ratios, tick };
}

describe('InteractionQualityController.rebase', () => {
  it('at rest applies the new ratio directly, in either mode', () => {
    const off = makeQuality('off', 1);
    off.c.rebase(2);
    expect(off.ratios).toEqual([2]);
    expect(off.c.currentRatio).toBe(2);
    const auto = makeQuality('auto', 1);
    auto.c.rebase(1.5);
    expect(auto.ratios).toEqual([1.5]);
    off.c.rebase(2); // unchanged → no redundant resize
    expect(off.ratios).toEqual([2]);
  });

  it('mid-gesture 2 → 1.5: keeps the reduction, and the settle restores exactly 1.5', () => {
    vi.useFakeTimers();
    const h = makeQuality('auto', 2);
    h.c.onFrame(); // gesture starts at 2 × 0.6
    expect(h.c.currentRatio).toBeCloseTo(1.2, 10);
    h.c.rebase(1.5);
    expect(h.c.currentRatio).toBeCloseTo(0.9, 10);
    h.c.settle();
    vi.advanceTimersByTime(150);
    expect(h.c.currentRatio).toBe(1.5);
    expect(h.ratios[h.ratios.length - 1]).toBe(1.5);
  });

  it("the ramp's next step after a rebase scales from the NEW base", () => {
    const h = makeQuality('auto', 2);
    h.c.onFrame();
    h.c.rebase(1.5);
    // Baseline tick, then three slow (30 ms) frames → one coarser step: factor 0.6 → 0.45.
    h.tick(0);
    for (const t of [30, 60, 90]) {
      h.c.onFrame();
      h.tick(t);
    }
    h.c.onFrame();
    expect(h.c.currentRatio).toBeCloseTo(0.675, 10); // 1.5 × 0.45, not 2 × 0.45
  });
});

/** A stub GL that sizes the canvas like three: width = floor(css × ratio). Capture-capable. */
function makeGl(canvas: HTMLCanvasElement, ratio = 1) {
  const gl = { ratio, cssW: 0, cssH: 0, ratios: [] as number[], renders: 0, reads: [] as [number, number][] };
  const apply = (): void => {
    canvas.width = Math.floor(gl.cssW * gl.ratio);
    canvas.height = Math.floor(gl.cssH * gl.ratio);
  };
  const stub: GLRendererLike = {
    render: () => {
      gl.renders++;
    },
    setSize: (w, h) => {
      gl.cssW = w;
      gl.cssH = h;
      apply();
    },
    setPixelRatio: (r) => {
      gl.ratio = r;
      gl.ratios.push(r);
      apply();
    },
    getPixelRatio: () => gl.ratio,
    dispose: () => undefined,
    domElement: canvas,
    setRenderTarget: () => undefined,
    readRenderTargetPixels: (_t, _x, _y, w, h) => {
      gl.reads.push([w, h]);
    }
  };
  return { gl, stub };
}

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

/** A display whose DPR can change; records every armed query and its live listeners, per query. */
function makeDisplay(dpr: number | undefined, withMatchMedia = true) {
  const queries: string[] = [];
  // One entry per (query, listener) pair: each MediaQueryList keeps its own listeners, even the same function.
  const entries: { q: number; l: () => void }[] = [];
  const live = {
    get size(): number {
      return entries.length;
    }
  };
  const env: { devicePixelRatio?: number } & DisplayEnv = { devicePixelRatio: dpr };
  if (withMatchMedia) {
    env.matchMedia = (q: string): MediaQueryListLike => {
      queries.push(q);
      const id = queries.length;
      return {
        addEventListener: (_t, l) => {
          if (!entries.some((e) => e.q === id && e.l === l)) entries.push({ q: id, l });
        },
        removeEventListener: (_t, l) => {
          const i = entries.findIndex((e) => e.q === id && e.l === l);
          if (i >= 0) entries.splice(i, 1);
        }
      };
    };
  }
  const change = (next: number): void => {
    env.devicePixelRatio = next;
    for (const e of [...entries]) e.l();
  };
  return { env, queries, live, change };
}

function makeStage(
  opts: { pixelRatio?: PixelRatioOption; env?: DisplayEnv; quality?: 'off' | 'auto'; glRatio?: number } = {}
) {
  const canvas = document.createElement('canvas');
  const { gl, stub } = makeGl(canvas, opts.glRatio);
  let controls: ReturnType<typeof stubControls> | null = null;
  const stage = new InteractiveStage({
    canvas,
    scene: new Scene(),
    interactionQuality: opts.quality,
    createRenderer: () => stub,
    createControls: (cam) => (controls = stubControls(cam)),
    ...(opts.pixelRatio !== undefined ? { pixelRatio: opts.pixelRatio } : {}),
    displayEnv: opts.env ?? makeDisplay(undefined, false).env
  });
  stage.resize(300, 150);
  return {
    stage,
    canvas,
    gl,
    get controls() {
      return controls!;
    }
  };
}

const rangeErrorOf = (fn: () => void): string => {
  try {
    fn();
    return 'none';
  } catch (e) {
    return (e as Error).name;
  }
};

describe('InteractiveStage pixelRatio', () => {
  it('unset never touches the renderer ratio', () => {
    const h = makeStage();
    expect(h.gl.ratios).toEqual([]);
    expect(h.canvas.width).toBe(300);
  });

  it('a number applies at construction and live', () => {
    const h = makeStage({ pixelRatio: 2 });
    expect(h.gl.ratios).toEqual([2]);
    expect(h.canvas.width).toBe(600);
    h.stage.setPixelRatio(1.5);
    expect(h.gl.ratios).toEqual([2, 1.5]);
    expect(h.canvas.width).toBe(450);
  });

  it('accepts (0, 4] and exactly "device"; anything else is a RangeError, never clamped', () => {
    const h = makeStage();
    for (const bad of [0, -1, 4.0001, Number.NaN, Number.POSITIVE_INFINITY, 'Device', ' device', 'DEVICE', '2']) {
      expect(rangeErrorOf(() => h.stage.setPixelRatio(bad as PixelRatioOption))).toBe('RangeError');
    }
    expect(h.gl.ratios).toEqual([]);
    for (const good of [4, 0.25, 1, 'device'] as const) {
      expect(rangeErrorOf(() => h.stage.setPixelRatio(good))).toBe('none');
    }
    expect(h.gl.ratios).toEqual([4, 0.25, 1]); // 'device' with no DPR reported = 1, already applied
  });

  it('validates the option before creating the GL', () => {
    let made = 0;
    const canvas = document.createElement('canvas');
    const err = rangeErrorOf(
      () =>
        new InteractiveStage({
          canvas,
          scene: new Scene(),
          pixelRatio: 0,
          createRenderer: () => {
            made++;
            return makeGl(canvas).stub;
          }
        })
    );
    expect(err).toBe('RangeError');
    expect(made).toBe(0);
  });

  it("'device' = min(devicePixelRatio, 2); 1 when the host reports none", () => {
    expect(makeStage({ pixelRatio: 'device', env: makeDisplay(3).env }).gl.ratios).toEqual([2]);
    expect(makeStage({ pixelRatio: 'device', env: makeDisplay(1.5).env }).gl.ratios).toEqual([1.5]);
    expect(makeStage({ pixelRatio: 'device', env: makeDisplay(2.0001).env }).gl.ratios).toEqual([2]);
    expect(makeStage({ pixelRatio: 'device', env: makeDisplay(0).env }).gl.ratios).toEqual([]);
    expect(makeStage({ pixelRatio: 'device', env: makeDisplay(undefined).env }).gl.ratios).toEqual([]);
  });

  it("'device' follows the display: each change re-arms a query for the new ratio", () => {
    const d = makeDisplay(2);
    const h = makeStage({ pixelRatio: 'device', env: d.env });
    expect(d.queries).toEqual(['(resolution: 2dppx)']);
    expect(d.live.size).toBe(1);
    d.change(1.25);
    expect(h.gl.ratios).toEqual([2, 1.25]);
    expect(d.queries).toEqual(['(resolution: 2dppx)', '(resolution: 1.25dppx)']);
    expect(d.live.size).toBe(1); // the old query's listener is gone
    d.change(3);
    expect(h.gl.ratios).toEqual([2, 1.25, 2]); // capped
  });

  it("leaving 'device' or disposing stops following the display", () => {
    const d = makeDisplay(2);
    const h = makeStage({ pixelRatio: 'device', env: d.env });
    h.stage.setPixelRatio(1);
    expect(d.live.size).toBe(0);
    d.change(1.5);
    expect(h.gl.ratios).toEqual([2, 1]);
    h.stage.setPixelRatio('device');
    expect(d.live.size).toBe(1);
    expect(h.gl.ratios).toEqual([2, 1, 1.5]);
    h.stage.dispose();
    expect(d.live.size).toBe(0);
    h.stage.setPixelRatio(3); // after dispose: validated, otherwise a no-op
    expect(h.gl.ratios).toEqual([2, 1, 1.5]);
  });

  it("without matchMedia, 'device' reads the DPR once", () => {
    const d = makeDisplay(1.5, false);
    const h = makeStage({ pixelRatio: 'device', env: d.env });
    d.change(2);
    expect(h.gl.ratios).toEqual([1.5]);
  });

  it('repaints after a ratio change (the resize clears the buffer), not after a no-op', () => {
    const h = makeStage({ pixelRatio: 2 });
    const before = h.gl.renders;
    h.stage.setPixelRatio(2);
    expect(h.gl.renders).toBe(before);
    h.stage.setPixelRatio(1);
    expect(h.gl.renders).toBe(before + 1);
  });

  it("a gesture starts from the consumer's ratio, not the renderer's, and settles on it", () => {
    vi.useFakeTimers();
    const h = makeStage({ pixelRatio: 2, quality: 'auto' });
    h.gl.ratio = 1; // the renderer's own reading is not the resting ratio once one is set
    h.controls.fire('change');
    expect(h.gl.ratios[h.gl.ratios.length - 1]).toBeCloseTo(1.2, 10);
    h.stage.setPixelRatio(1.5); // rebase mid-gesture
    expect(h.gl.ratios[h.gl.ratios.length - 1]).toBeCloseTo(0.9, 10);
    h.controls.fire('end');
    vi.advanceTimersByTime(150);
    expect(h.gl.ratios[h.gl.ratios.length - 1]).toBe(1.5);
  });
});

describe('InteractiveStage capture default size with a pixelRatio', () => {
  const sizeOf = async (h: ReturnType<typeof makeStage>, opts = {}): Promise<[number, number]> => {
    await h.stage.capture(opts).catch(() => undefined); // the encode step is browser-only
    return h.gl.reads[h.gl.reads.length - 1]!;
  };

  it('is the CSS size, the same as unset', async () => {
    expect(await sizeOf(makeStage())).toEqual([300, 150]);
    const dev = makeStage({ pixelRatio: 'device', env: makeDisplay(2).env });
    expect(dev.canvas.width).toBe(600);
    expect(await sizeOf(dev)).toEqual([300, 150]);
    expect(await sizeOf(makeStage({ pixelRatio: 1.5 }))).toEqual([300, 150]);
  });

  it('mid-gesture divides by the APPLIED (reduced) ratio', async () => {
    const h = makeStage({ pixelRatio: 2, quality: 'auto' });
    h.controls.fire('change'); // 2 × 0.6 = 1.2 → buffer 360 × 180
    expect(h.canvas.width).toBe(360);
    expect(await sizeOf(h)).toEqual([300, 150]);
  });

  it('an explicit size is unchanged', async () => {
    const h = makeStage({ pixelRatio: 2 });
    expect(await sizeOf(h, { width: 640, height: 320 })).toEqual([640, 320]);
  });
});

describe('ToolpathRenderer pixelRatio', () => {
  it('passes the option to the stage and delegates the setter', () => {
    const canvas = document.createElement('canvas');
    const { gl, stub } = makeGl(canvas);
    const r = new ToolpathRenderer({
      canvas,
      quality: 'lines',
      pixelRatio: 2,
      createRenderer: () => stub,
      scheduleFrame: () => undefined
    });
    expect(gl.ratios).toEqual([2]);
    r.setPixelRatio(1.5);
    expect(gl.ratios).toEqual([2, 1.5]);
    expect(rangeErrorOf(() => r.setPixelRatio(4.0001))).toBe('RangeError');
    r.dispose();
  });

  it('a bad option throws before the GL is created', () => {
    let made = 0;
    const canvas = document.createElement('canvas');
    const err = rangeErrorOf(
      () =>
        new ToolpathRenderer({
          canvas,
          pixelRatio: 'Device' as PixelRatioOption,
          createRenderer: () => {
            made++;
            return makeGl(canvas).stub;
          }
        })
    );
    expect(err).toBe('RangeError');
    expect(made).toBe(0);
  });
});

describe('InteractiveStage on a renderer already at ratio 2 (a consumer createRenderer)', () => {
  const sizeOf = async (h: ReturnType<typeof makeStage>): Promise<[number, number]> => {
    await h.stage.capture().catch(() => undefined); // the encode step is browser-only
    return h.gl.reads[h.gl.reads.length - 1]!;
  };

  it('pixelRatio unset + auto: the default capture is the drawing buffer, before, during and after a gesture', async () => {
    vi.useFakeTimers();
    const h = makeStage({ glRatio: 2, quality: 'auto' });
    expect(h.canvas.width).toBe(600);
    expect(await sizeOf(h)).toEqual([600, 300]);
    h.controls.fire('change'); // 2 × 0.6 = 1.2 → buffer 360 × 180
    expect(h.canvas.width).toBe(360);
    expect(await sizeOf(h)).toEqual([600, 300]);
    h.controls.fire('end');
    vi.advanceTimersByTime(150);
    expect(h.canvas.width).toBe(600);
    expect(await sizeOf(h)).toEqual([600, 300]);
    vi.useRealTimers();
  });

  it('setPixelRatio(1) is applied (not skipped as already current), and capture follows', async () => {
    const h = makeStage({ glRatio: 2 });
    h.stage.setPixelRatio(1);
    expect(h.gl.ratios).toEqual([1]);
    expect(h.canvas.width).toBe(300);
    expect(await sizeOf(h)).toEqual([300, 150]);
  });
});
