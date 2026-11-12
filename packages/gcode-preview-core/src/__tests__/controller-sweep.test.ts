// @vitest-environment happy-dom
/**
 * Controller mutation sweep (G3): the queued-control replay contract (E_CONTROL_REJECTED), subscriber
 * isolation, the layer/scrub argument checks, and pre-parse setScrubTime (it sends nothing until a file
 * loads). Every expected value is a literal; nothing reads the module's own constants.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer } from '@chestnutlabs/gcode-renderer-three';
import { createPreviewController, LayerView2DRenderer, type PreviewEvent } from '../index';
import { SuiteStubWorker, makeSuiteStubGL } from '../testing';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

/** `n` one-mm extrusion segments at 60000 mm/min (1 ms each): segment i ends at (i + 1) ms. */
function timedIR(n = 12): ToolpathIR {
  const b = new ToolpathIRBuilder({
    parserVersion: 'sweep',
    units: 'mm',
    unitsSource: 'known',
    source: { byteLength: 1_000 }
  });
  for (let i = 0; i < n; i++) {
    b.addSegment({
      x0: 100 + i,
      y0: 100,
      z0: 0.2,
      x1: 101 + i,
      y1: 100,
      z1: 0.2,
      e: 1,
      feedrate: 60_000,
      kind: MoveKind.Extrude,
      layer: 0,
      srcByte: i * 10
    });
  }
  return b.finalize();
}

function make3d(opts: { bind?: boolean } = {}) {
  const canvas = document.createElement('canvas');
  const controller = createPreviewController({
    createWorker: () => new SuiteStubWorker(undefined, () => timedIR()),
    renderer: {
      quality: 'lines',
      chunksPerTick: 8,
      createRenderer: (c) => makeSuiteStubGL(c as HTMLCanvasElement),
      scheduleFrame: (cb) => cb()
    }
  });
  const events: PreviewEvent[] = [];
  controller.onEvent((e) => events.push(e));
  if (opts.bind !== false) controller.bindCanvas(canvas);
  return { controller, canvas, events };
}

const errorEvents = (events: PreviewEvent[]): Array<{ code: string; message: string }> =>
  events.flatMap((e) => (e.type === 'error' ? [{ code: e.code, message: e.message }] : []));

/** Records every control setter that RETURNED on a 3D renderer (a throwing call is not recorded). */
const SPIED = [
  'setCameraMode',
  'setView',
  'setTheme',
  'setFrameContent',
  'setKindVisible',
  'setShowRetractions'
] as const;
let log: string[] = [];
const originals = new Map<string, unknown>();
beforeEach(() => {
  log = [];
  const proto = ToolpathRenderer.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const m of SPIED) {
    const orig = proto[m];
    originals.set(m, orig);
    proto[m] = function (this: unknown, ...a: unknown[]) {
      const out = orig.apply(this, a);
      log.push(`${m}:${JSON.stringify(a)}`);
      return out;
    };
  }
});
afterEach(() => {
  const proto = ToolpathRenderer.prototype as unknown as Record<string, unknown>;
  for (const [m, f] of originals) proto[m] = f;
  originals.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('queued control replay (E_CONTROL_REJECTED)', () => {
  it('a queued call the 3D renderer rejects is reported by name; later queued calls still apply', async () => {
    const { controller, events } = make3d();
    controller.controls.setTheme({ gridOpacity: 2 });
    controller.controls.setCameraMode('orthographic');
    controller.controls.setView('top');
    await settle();
    expect(controller.raw.renderer()).not.toBeNull();
    expect(log).toEqual(['setCameraMode:["orthographic"]', 'setView:["top"]']);
    expect(controller.controls.getCameraState()?.cameraMode).toBe('orthographic');
    expect(controller.getState().error).toEqual({
      code: 'E_CONTROL_REJECTED',
      message: 'setTheme rejected: theme gridOpacity must be a number in [0,1] (got 2)'
    });
    expect(errorEvents(events)).toEqual([
      { code: 'E_CONTROL_REJECTED', message: 'setTheme rejected: theme gridOpacity must be a number in [0,1] (got 2)' }
    ]);
    controller.dispose();
  });

  it('each rejected call reports once, in queue order; a rebind replays nothing again', async () => {
    const { controller, events } = make3d();
    controller.controls.setTheme({ gridOpacity: -1 });
    controller.controls.setFrameContent('object');
    controller.controls.setBuildVolume({ x: Number.NaN, y: 220, z: 250 });
    await settle();
    expect(errorEvents(events).map((e) => e.message.split(':')[0])).toEqual([
      'setTheme rejected',
      'setBuildVolume rejected'
    ]);
    expect(controller.getState().error?.message.startsWith('setBuildVolume rejected: ')).toBe(true);
    expect(log).toEqual(['setFrameContent:["object"]']);
    controller.bindCanvas(document.createElement('canvas'));
    await settle();
    expect(log).toEqual(['setFrameContent:["object"]']);
    expect(errorEvents(events)).toHaveLength(2);
    controller.dispose();
  });

  it('after bind the same bad call throws to its caller and is not reported as an event', async () => {
    const { controller, events } = make3d();
    await settle();
    expect(() => controller.controls.setTheme({ gridOpacity: 2 })).toThrow(RangeError);
    expect(controller.getState().error).toBeNull();
    expect(errorEvents(events)).toEqual([]);
    controller.dispose();
  });

  it('the capability refresh still runs when a parse finished before the 3D renderer bound', async () => {
    const { controller, canvas } = make3d({ bind: false });
    const outcome = await controller.parse(new Uint8Array(1_000));
    expect(outcome.ok).toBe(true);
    expect(controller.getState().availableColorModes).toEqual([]);
    controller.controls.setTheme({ gridOpacity: 9 });
    controller.bindCanvas(canvas);
    await settle();
    expect(controller.getState().availableColorModes).toContain('single');
    expect(controller.getState().availableColorModes).toContain('feedrate');
    expect(controller.getState().segmentCount).toBe(12);
    expect(controller.getState().error?.code).toBe('E_CONTROL_REJECTED');
    controller.dispose();
  });

  it('2D: bindCanvas never throws for a queued call; a non-Error throw is named with String()', () => {
    vi.spyOn(LayerView2DRenderer.prototype, 'setView').mockImplementation(() => {
      throw 'view boom'; // a non-Error throw
    });
    const shown = vi.spyOn(LayerView2DRenderer.prototype, 'setShowRetractions');
    const canvas = document.createElement('canvas');
    const controller = createPreviewController({ createWorker: () => new SuiteStubWorker(), renderer: { mode: '2d' } });
    const events: PreviewEvent[] = [];
    controller.onEvent((e) => events.push(e));
    controller.controls.setView('iso');
    controller.controls.setShowRetractions(true);
    expect(() => controller.bindCanvas(canvas)).not.toThrow();
    expect(shown).toHaveBeenCalledTimes(1);
    expect(controller.getState().error).toEqual({ code: 'E_CONTROL_REJECTED', message: 'setView rejected: view boom' });
    expect(errorEvents(events)).toEqual([{ code: 'E_CONTROL_REJECTED', message: 'setView rejected: view boom' }]);
    controller.dispose();
  });

  it('a state subscriber that disposes during replay stops it: the next queued call never reaches the old renderer', async () => {
    const { controller } = make3d();
    controller.controls.setTheme({ gridOpacity: 2 }); // rejected on replay -> state.error -> subscriber disposes
    controller.controls.setCameraMode('orthographic');
    let disposals = 0;
    let afterDispose = 0;
    controller.onStateChange((s) => {
      if (disposals > 0) afterDispose++;
      if (s.error?.code === 'E_CONTROL_REJECTED') {
        disposals++;
        controller.dispose();
      }
    });
    await settle();
    expect(disposals).toBe(1);
    expect(afterDispose).toBe(0);
    expect(log).toEqual([]);
    expect(controller.raw.renderer()).toBeNull();
  });

  // A parse BEFORE bindCanvas sets the IR, so the replay's trailing block (layer/segment counts) runs. The
  // SuiteStubWorker file has 2 layers and 12 segments; a disposed 2D renderer reports 0 / 0.
  function parsed2d(): Promise<ReturnType<typeof createPreviewController>> {
    vi.spyOn(LayerView2DRenderer.prototype, 'setView').mockImplementation(() => {
      throw new Error('view boom');
    });
    const controller = createPreviewController({ createWorker: () => new SuiteStubWorker(), renderer: { mode: '2d' } });
    return controller.parse(new Uint8Array(1000)).then((outcome) => {
      expect(outcome.ok).toBe(true);
      return controller;
    });
  }

  it('2D, parsed first: the only queued call rebinds from its error listener; counts come from the live renderer', async () => {
    const controller = await parsed2d();
    controller.controls.setView('iso');
    let rebinds = 0;
    controller.onEvent((e) => {
      if (e.type === 'error' && rebinds === 0) {
        rebinds++;
        controller.bindCanvas(document.createElement('canvas'));
      }
    });
    controller.bindCanvas(document.createElement('canvas'));
    expect(rebinds).toBe(1);
    const s = controller.getState();
    expect({ layerCount: s.layerCount, segmentCount: s.segmentCount }).toEqual({ layerCount: 2, segmentCount: 12 });
    expect(s.error?.code).toBe('E_CONTROL_REJECTED');
    controller.dispose();
  });

  it('2D, parsed first: the first of two queued calls rebinds; same counts, the second never reaches the old renderer', async () => {
    const controller = await parsed2d();
    const shown = vi.spyOn(LayerView2DRenderer.prototype, 'setShowRetractions');
    controller.controls.setView('iso');
    controller.controls.setShowRetractions(true);
    let rebinds = 0;
    controller.onEvent((e) => {
      if (e.type === 'error' && rebinds === 0) {
        rebinds++;
        controller.bindCanvas(document.createElement('canvas'));
      }
    });
    controller.bindCanvas(document.createElement('canvas'));
    expect(rebinds).toBe(1);
    expect(shown).toHaveBeenCalledTimes(0);
    const s = controller.getState();
    expect({ layerCount: s.layerCount, segmentCount: s.segmentCount }).toEqual({ layerCount: 2, segmentCount: 12 });
    controller.dispose();
  });

  it('2D, parsed first: a dispose from the only queued call leaves the counts and notifies nothing after', async () => {
    const controller = await parsed2d();
    controller.controls.setView('iso');
    let disposals = 0;
    let afterDispose = 0;
    controller.onStateChange((s) => {
      if (disposals > 0) afterDispose++;
      if (s.error?.code === 'E_CONTROL_REJECTED' && disposals === 0) {
        disposals++;
        controller.dispose();
      }
    });
    controller.bindCanvas(document.createElement('canvas'));
    expect(disposals).toBe(1);
    expect(afterDispose).toBe(0);
    const s = controller.getState();
    expect({ layerCount: s.layerCount, segmentCount: s.segmentCount }).toEqual({ layerCount: 2, segmentCount: 12 });
  });

  it('a subscriber that rebinds during replay stops it on the old renderer', async () => {
    const { controller } = make3d();
    controller.controls.setTheme({ gridOpacity: 2 });
    controller.controls.setCameraMode('orthographic');
    let rebinds = 0;
    controller.onEvent((e) => {
      if (e.type === 'error' && rebinds === 0) {
        rebinds++;
        controller.bindCanvas(document.createElement('canvas'));
      }
    });
    await settle();
    expect(rebinds).toBe(1);
    expect(log).toEqual([]);
    expect(controller.raw.renderer()).not.toBeNull();
    controller.dispose();
  });

  it('2D: a subscriber that rebinds synchronously during replay stops it on the old renderer', () => {
    vi.spyOn(LayerView2DRenderer.prototype, 'setView').mockImplementation(() => {
      throw new Error('view boom');
    });
    const shown = vi.spyOn(LayerView2DRenderer.prototype, 'setShowRetractions');
    const controller = createPreviewController({ createWorker: () => new SuiteStubWorker(), renderer: { mode: '2d' } });
    controller.controls.setView('iso');
    controller.controls.setShowRetractions(true);
    let rebinds = 0;
    controller.onEvent((e) => {
      if (e.type === 'error' && rebinds === 0) {
        rebinds++;
        controller.bindCanvas(document.createElement('canvas')); // a new 2D renderer binds at once
      }
    });
    controller.bindCanvas(document.createElement('canvas'));
    expect(rebinds).toBe(1);
    expect(shown).toHaveBeenCalledTimes(0);
    expect(controller.raw.renderer()).not.toBeNull();
    controller.dispose();
  });

  // Rebinds from INSIDE the bind's setIR, before the replay loop. A synchronous scheduleFrame (a public
  // renderer option) runs the 3D build inside setIR, so its `stage` / `buildComplete` events are synchronous.
  it('3D: a subscriber that rebinds during the bind’s setIR leaves the queued call to the live renderer', async () => {
    const { controller } = make3d({ bind: false });
    expect((await controller.parse(new Uint8Array(1_000))).ok).toBe(true);
    // setLayerRange is not one of the SPIED (beforeEach-wrapped) setters, so this spy restores cleanly.
    const range = vi.spyOn(ToolpathRenderer.prototype, 'setLayerRange');
    const setIR = vi.spyOn(ToolpathRenderer.prototype, 'setIR');
    controller.controls.setLayerRange(0, 5); // queued: the 3D renderer loads on demand
    let trigger = '';
    controller.onEvent((e) => {
      if (trigger === '' && (e.type === 'stage' || e.type === 'buildComplete') && setIR.mock.calls.length === 1) {
        trigger = e.type;
        controller.bindCanvas(document.createElement('canvas'));
      }
    });
    controller.bindCanvas(document.createElement('canvas'));
    await settle();
    expect(trigger).not.toBe('');
    expect(setIR).toHaveBeenCalledTimes(2); // the first renderer's setIR emitted; the second renderer bound
    const live = controller.raw.renderer();
    expect(live).not.toBeNull();
    expect(range.mock.contexts).toEqual([live]); // once, on the live renderer only
    expect(range.mock.calls).toEqual([[0, 5]]);
    const s = controller.getState();
    expect({ layerCount: s.layerCount, segmentCount: s.segmentCount }).toEqual({ layerCount: 1, segmentCount: 12 });
    controller.dispose();
  });

  it('2D: a subscriber that rebinds during the bind’s setIR keeps the live renderer’s counts', async () => {
    // An inferred layer index makes the 2D setIR emit `renderer-unsupported` (feature `layers`) synchronously.
    const inferred = (): ToolpathIR => {
      const ir = timedIR();
      return { ...ir, header: { ...ir.header, capabilities: { ...ir.header.capabilities, layers: 'inferred' } } };
    };
    const shown = vi.spyOn(LayerView2DRenderer.prototype, 'setShowRetractions');
    const controller = createPreviewController({
      createWorker: () => new SuiteStubWorker(undefined, inferred),
      renderer: { mode: '2d' }
    });
    expect((await controller.parse(new Uint8Array(1_000))).ok).toBe(true);
    controller.controls.setShowRetractions(true);
    let rebinds = 0;
    controller.onEvent((e) => {
      if (e.type === 'renderer-unsupported' && e.feature === 'layers' && rebinds === 0) {
        rebinds++;
        controller.bindCanvas(document.createElement('canvas'));
      }
    });
    controller.bindCanvas(document.createElement('canvas'));
    expect(rebinds).toBe(1);
    const live = controller.raw.renderer();
    expect(shown.mock.contexts).toEqual([live]);
    const s = controller.getState();
    expect({ layerCount: s.layerCount, segmentCount: s.segmentCount }).toEqual({ layerCount: 1, segmentCount: 12 });
    controller.dispose();
  });

  it('a queued setColorMode is named too', () => {
    vi.spyOn(LayerView2DRenderer.prototype, 'setColorMode').mockImplementation(() => {
      throw new Error('color boom');
    });
    const controller = createPreviewController({ createWorker: () => new SuiteStubWorker(), renderer: { mode: '2d' } });
    expect(controller.controls.setColorMode({ mode: 'tool', palette: [] })).toBe(true);
    controller.bindCanvas(document.createElement('canvas'));
    expect(controller.getState().error).toEqual({
      code: 'E_CONTROL_REJECTED',
      message: 'setColorMode rejected: color boom'
    });
    controller.dispose();
  });
});

describe('subscriber isolation', () => {
  /** Run microtasks through a wrapper that catches a re-thrown subscriber error instead of failing the run. */
  function captureRethrows(): unknown[] {
    const caught: unknown[] = [];
    const orig = globalThis.queueMicrotask.bind(globalThis);
    vi.stubGlobal('queueMicrotask', (fn: () => void) =>
      orig(() => {
        try {
          fn();
        } catch (err) {
          caught.push(err);
        }
      })
    );
    return caught;
  }

  it('a throwing state subscriber does not change the parse outcome or stop parse-complete', async () => {
    const caught = captureRethrows();
    const { controller, events } = make3d();
    await settle();
    const boom = new Error('state boom');
    controller.onStateChange((s) => {
      if (s.summary !== null) throw boom;
    });
    const seen: number[] = [];
    controller.onStateChange((s) => seen.push(s.segmentCount));
    const outcome = await controller.parse(new Uint8Array(1_000));
    await settle();
    expect(outcome.ok).toBe(true);
    expect(events.filter((e) => e.type === 'parse-complete')).toHaveLength(1);
    expect(events.some((e) => e.type === 'parse-error')).toBe(false);
    expect(controller.getState().availableColorModes).toContain('feedrate');
    expect(controller.getState().parsing).toBe(false);
    expect(controller.getState().error).toBeNull();
    expect(seen.at(-1)).toBe(12);
    expect(caught.length).toBeGreaterThan(0);
    expect(caught.every((e) => e === boom)).toBe(true);
    controller.dispose();
  });

  it('a subscriber that throws on the final parsing:false snapshot never rejects parse()', async () => {
    const caught = captureRethrows();
    const { controller } = make3d();
    await settle();
    let parsingSeen = false;
    controller.onStateChange((s) => {
      if (s.parsing) parsingSeen = true;
      else if (parsingSeen) throw new Error('final boom');
    });
    await expect(controller.parse(new Uint8Array(1_000))).resolves.toMatchObject({ ok: true });
    await settle();
    expect(caught.map(String)).toEqual(['Error: final boom']);
    controller.dispose();
  });

  it('a throwing event subscriber does not stop the next subscriber or the parse', async () => {
    const caught = captureRethrows();
    const { controller, events } = make3d();
    await settle();
    // `events` was subscribed first by make3d; this one is second, the recorder below third.
    controller.onEvent((e) => {
      if (e.type === 'parse-complete') throw new Error('event boom');
    });
    const after: string[] = [];
    controller.onEvent((e) => after.push(e.type));
    const outcome = await controller.parse(new Uint8Array(1_000));
    await settle();
    expect(outcome.ok).toBe(true);
    expect(after).toContain('parse-complete');
    expect(events.some((e) => e.type === 'parse-error')).toBe(false);
    expect(controller.getState().availableColorModes).toContain('feedrate');
    expect(caught.map(String)).toEqual(['Error: event boom']);
    controller.dispose();
  });
});

describe('layer / scrub argument checks', () => {
  const bad: unknown[] = [Number.NaN, '5', undefined, {}];
  it('setLayerRange throws RangeError for a bad start or end, before anything is queued', async () => {
    const { controller } = make3d({ bind: false });
    const spy = vi.spyOn(ToolpathRenderer.prototype, 'setLayerRange');
    for (const v of bad) {
      expect(() => controller.controls.setLayerRange(v as number, 3)).toThrow(RangeError);
      expect(() => controller.controls.setLayerRange(0, v as number)).toThrow(RangeError);
    }
    expect(() => controller.controls.setLayerRange(Number.NaN, 3)).toThrow(
      'setLayerRange startLayer needs a number that is not NaN (got NaN)'
    );
    expect(() => controller.controls.setLayerRange(0, Number.NaN)).toThrow(
      'setLayerRange endLayer needs a number that is not NaN (got NaN)'
    );
    controller.controls.setLayerRange(-Infinity, Infinity);
    controller.bindCanvas(document.createElement('canvas'));
    await settle();
    expect(spy.mock.calls).toEqual([[-Infinity, Infinity]]);
    controller.dispose();
  });

  it('setScrubPosition throws for NaN / non-numbers; null and ±Infinity pass', async () => {
    const { controller } = make3d({ bind: false });
    const spy = vi.spyOn(ToolpathRenderer.prototype, 'setScrubPosition');
    for (const v of bad) expect(() => controller.controls.setScrubPosition(v as number)).toThrow(RangeError);
    expect(() => controller.controls.setScrubPosition(Number.NaN)).toThrow(
      'setScrubPosition needs a number that is not NaN (got NaN)'
    );
    controller.controls.setScrubPosition(null);
    controller.controls.setScrubPosition(Infinity);
    controller.controls.setScrubPosition(-Infinity);
    controller.bindCanvas(document.createElement('canvas'));
    await settle();
    expect(spy.mock.calls).toEqual([[null], [Infinity], [-Infinity]]);
    controller.dispose();
  });

  it('setScrubTime throws for NaN / non-numbers, even before a parse', () => {
    const { controller } = make3d();
    for (const v of bad) expect(() => controller.controls.setScrubTime(v as number)).toThrow(RangeError);
    expect(() => controller.controls.setScrubTime(Number.NaN)).toThrow(
      'setScrubTime needs a number that is not NaN (got NaN)'
    );
    controller.dispose();
  });
});

describe('setScrubTime before a parse', () => {
  it('sends nothing and does not clear an existing cut; the latest call applies to the loaded file', async () => {
    const { controller } = make3d();
    await settle();
    const spy = vi.spyOn(ToolpathRenderer.prototype, 'setScrubPosition');
    controller.controls.setScrubPosition(0);
    controller.controls.setScrubTime(Infinity);
    controller.controls.setScrubTime(5);
    expect(spy.mock.calls).toEqual([[0]]);
    await controller.parse(new Uint8Array(1_000));
    await settle();
    const draw = (): number => (controller.raw.renderer() as ToolpathRenderer).chunkMeshes[0].geometry.drawRange.count;
    expect(draw()).toBe(10); // the latest pre-parse call (5 ms), re-applied after the new file's setIR
    controller.controls.setScrubTime(Infinity);
    expect(draw()).toBe(24);
    controller.controls.setScrubTime(5);
    expect(draw()).toBe(10);
    controller.controls.setScrubTime(-1);
    expect(draw()).toBe(0);
    controller.controls.setScrubTime(null);
    expect(draw()).toBe(24);
    expect(spy.mock.calls.slice(1)).toEqual([[4], [11], [4], [-1], [null]]);
    controller.dispose();
  });

  it('a pre-parse null queues a clear', async () => {
    const { controller } = make3d({ bind: false });
    const spy = vi.spyOn(ToolpathRenderer.prototype, 'setScrubPosition');
    controller.controls.setScrubTime(7);
    controller.controls.setScrubTime(null);
    controller.bindCanvas(document.createElement('canvas'));
    await settle();
    expect(spy.mock.calls).toEqual([[null]]);
    controller.dispose();
  });
});

describe('replay property (fixed seeds)', () => {
  /** Park–Miller LCG: deterministic, no dependency. */
  const rng = (seed: number) => {
    let s = seed;
    return (n: number): number => {
      s = (s * 48_271) % 2_147_483_647;
      return s % n;
    };
  };
  type Op = { label: string; good: boolean; call: (c: ReturnType<typeof make3d>['controller']) => void };
  const OPS: Op[] = [
    { label: 'setCameraMode:["orthographic"]', good: true, call: (c) => c.controls.setCameraMode('orthographic') },
    { label: 'setCameraMode:["perspective"]', good: true, call: (c) => c.controls.setCameraMode('perspective') },
    { label: 'setView:["front"]', good: true, call: (c) => c.controls.setView('front') },
    { label: 'setKindVisible:["travel",true]', good: true, call: (c) => c.controls.setKindVisible('travel', true) },
    { label: 'setShowRetractions:[false]', good: true, call: (c) => c.controls.setShowRetractions(false) },
    { label: 'setFrameContent:["all"]', good: true, call: (c) => c.controls.setFrameContent('all') },
    { label: 'setTheme:[{"gridOpacity":0.5}]', good: true, call: (c) => c.controls.setTheme({ gridOpacity: 0.5 }) },
    { label: 'bad-theme', good: false, call: (c) => c.controls.setTheme({ gridOpacity: 3 }) }
  ];

  for (const seed of [1, 7, 42, 99, 1234, 2026, 31337, 65_521]) {
    it(`seed ${seed}: every queued good call reaches the renderer once, in order; each bad call reports once`, async () => {
      const next = rng(seed);
      const { controller, events } = make3d({ bind: false });
      let bound = false;
      const expected: string[] = [];
      let rejected = 0;
      for (let step = 0; step < 40; step++) {
        const pick = next(10);
        if (pick === 8) {
          controller.bindCanvas(document.createElement('canvas'));
          await settle();
          bound = true;
        } else if (pick === 9) {
          controller.bindCanvas(null);
          bound = false;
        } else {
          const op = OPS[pick % OPS.length];
          if (bound && !op.good) {
            expect(() => op.call(controller)).toThrow(RangeError);
          } else {
            op.call(controller);
            if (op.good) expected.push(op.label);
            else rejected++;
          }
        }
        if (bound) {
          expect(log).toEqual(expected);
          expect(errorEvents(events)).toHaveLength(rejected);
        }
      }
      controller.bindCanvas(document.createElement('canvas'));
      await settle();
      expect(log).toEqual(expected);
      expect(errorEvents(events).every((e) => e.code === 'E_CONTROL_REJECTED')).toBe(true);
      expect(errorEvents(events)).toHaveLength(rejected);
      controller.dispose();
    });
  }
});
