// @vitest-environment happy-dom
/**
 * Controller mutation sweep (G3), part 2: the existing controller wiring that pass 1 found unpinned —
 * bind/unbind sizing and cleanup, option pass-through, renderer events into state, parse wiring
 * (defaults merge, slicer time, filament pre-resolve, consumer-wins volume, E_UNKNOWN/E_DISPOSED, File
 * size, zero-total progress, partials), value queries, progress forwarding and dispose. Literal values.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer } from '@chestnutlabs/gcode-renderer-three';
import { createPreviewController, LayerView2DRenderer, type PreviewEvent } from '../index';
import { SuiteStubWorker, TEST_MACHINE, emitSuiteBuild, makeSuiteStubGL } from '../testing';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

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

/** A stub worker whose `done` carries `metadata`, with optional progress/partial messages first. Records opts. */
class MetaWorker {
  static posted: unknown[] = [];
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  constructor(private readonly opts: { metadata?: unknown; progressTotal?: number; partial?: boolean } = {}) {}
  postMessage(msg: { type: string; id: number; opts?: unknown }): void {
    if (msg.type === 'cancel') {
      queueMicrotask(() => this.onmessage?.({ data: { v: 1, type: 'cancelled', id: msg.id } }));
      return;
    }
    if (msg.type !== 'parse') return;
    MetaWorker.posted.push(msg.opts);
    queueMicrotask(() => {
      if (this.opts.progressTotal !== undefined) {
        this.onmessage?.({
          data: {
            v: 1,
            type: 'progress',
            id: msg.id,
            bytesProcessed: 0,
            totalBytes: this.opts.progressTotal,
            phase: 'parsing'
          }
        });
      }
      if (this.opts.partial === true) {
        this.onmessage?.({ data: { v: 1, type: 'partial', id: msg.id, slice: timedIR(2), cumulativeSegments: 2 } });
      }
      this.onmessage?.({
        data: {
          v: 1,
          type: 'done',
          id: msg.id,
          ir: timedIR(),
          stats: { bytes: 1_000, wallMs: 1 },
          metadata: this.opts.metadata
        }
      });
    });
  }
  terminate(): void {}
}

type Ctl = ReturnType<typeof createPreviewController>;
function makeWith(
  worker: () => unknown,
  renderer: Record<string, unknown> = {},
  bind = true
): { controller: Ctl; events: PreviewEvent[]; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  const controller = createPreviewController({
    createWorker: worker as never,
    parseDefaults: { plate: 1, maxSegments: 500 } as never,
    renderer: {
      quality: 'lines',
      chunksPerTick: 8,
      createRenderer: (c: unknown) => makeSuiteStubGL(c as HTMLCanvasElement),
      scheduleFrame: (cb: () => void) => cb(),
      ...renderer
    } as never
  });
  const events: PreviewEvent[] = [];
  controller.onEvent((e) => events.push(e));
  if (bind) controller.bindCanvas(canvas);
  return { controller, events, canvas };
}
const emitOn = (r: unknown, e: unknown): void => (r as { emit(e: unknown): void }).emit(e);
const errorEvents = (events: PreviewEvent[]): Array<{ code: string; message: string }> =>
  events.flatMap((e) => (e.type === 'error' ? [{ code: e.code, message: e.message }] : []));

beforeEach(() => {
  MetaWorker.posted = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('bind / unbind wiring', () => {
  it('sizes from canvas.width when clientWidth is 0, follows window resize, and unhooks it on rebind', async () => {
    const resize = vi.spyOn(ToolpathRenderer.prototype, 'resize');
    const { controller, canvas } = makeWith(() => new SuiteStubWorker(), {}, false);
    canvas.width = 500;
    canvas.height = 400;
    controller.bindCanvas(canvas);
    await settle();
    expect(resize.mock.calls[0]).toEqual([500, 400]);
    resize.mockClear();
    window.dispatchEvent(new Event('resize'));
    expect(resize.mock.calls).toEqual([[500, 400]]);
    controller.bindCanvas(document.createElement('canvas')); // 300 x 150 by default
    await settle();
    resize.mockClear();
    window.dispatchEvent(new Event('resize'));
    expect(resize.mock.calls).toEqual([[300, 150]]);
    controller.dispose();
  });

  it('unbinding disposes the renderer and unsubscribes from its events', () => {
    const offs: number[] = [];
    const orig = LayerView2DRenderer.prototype.onEvent;
    vi.spyOn(LayerView2DRenderer.prototype, 'onEvent').mockImplementation(function (
      this: LayerView2DRenderer,
      cb: Parameters<LayerView2DRenderer['onEvent']>[0]
    ) {
      const off = orig.call(this, cb);
      return () => {
        offs.push(1);
        off();
      };
    });
    const dispose = vi.spyOn(LayerView2DRenderer.prototype, 'dispose');
    const { controller } = makeWith(() => new SuiteStubWorker(), { mode: '2d' });
    controller.bindCanvas(null);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(offs).toEqual([1]);
    expect(controller.raw.renderer()).toBeNull();
    controller.dispose();
  });

  it('bindCanvas after dispose binds nothing', () => {
    const { controller } = makeWith(() => new SuiteStubWorker(), { mode: '2d' }, false);
    controller.dispose();
    controller.bindCanvas(document.createElement('canvas'));
    expect(controller.raw.renderer()).toBeNull();
  });

  it('a 3D load superseded by a rebind in the same tick never binds', async () => {
    const onEvent = vi.spyOn(ToolpathRenderer.prototype, 'onEvent');
    const { controller } = makeWith(() => new SuiteStubWorker(), {}, false);
    controller.bindCanvas(document.createElement('canvas'));
    controller.bindCanvas(document.createElement('canvas'));
    await settle();
    expect(onEvent).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('a renderer that fails to construct is E_RENDERER_LOAD', async () => {
    const noGL = new Error('no gl');
    const { controller, events } = makeWith(() => new SuiteStubWorker(), {
      createRenderer: () => {
        throw noGL;
      }
    });
    await settle();
    // #589: it loaded but could not start; the thrown error is the cause.
    expect(controller.getState().error).toEqual({
      code: 'E_RENDERER_LOAD',
      message: 'no gl',
      cause: noGL,
      reason: 'start'
    });
    expect(controller.getState().error?.cause).toBe(noGL);
    expect(errorEvents(events)).toEqual([{ code: 'E_RENDERER_LOAD', message: 'no gl' }]);
    controller.dispose();
  });

  it('passes 2D ghost options and 3D frameContent/theme to the renderer it builds', async () => {
    const two = makeWith(() => new SuiteStubWorker(), { mode: '2d', adjacentLayers: 3, ghostOpacity: 0.6 });
    const view = (
      two.controller.raw.renderer() as unknown as { view: { adjacentLayers: number; ghostOpacity: number } }
    ).view;
    expect([view.adjacentLayers, view.ghostOpacity]).toEqual([3, 0.6]);
    two.controller.dispose();
    const three = makeWith(() => new SuiteStubWorker(), { frameContent: 'object', theme: { gridOpacity: 0.3 } });
    await settle();
    const r = three.controller.raw.renderer() as unknown as {
      frameContentMode: string;
      resolvedTheme: { gridOpacity: number };
    };
    expect(r.frameContentMode).toBe('object');
    expect(r.resolvedTheme.gridOpacity).toBe(0.3);
    three.controller.dispose();
  });

  it('a late bind takes the renderer counts and keeps the consumer volume over the file bed', async () => {
    vi.spyOn(ToolpathRenderer.prototype, 'segmentCount', 'get').mockReturnValue(99);
    const vol = vi.spyOn(ToolpathRenderer.prototype, 'setBuildVolume');
    const { controller, canvas } = makeWith(
      () => new SuiteStubWorker(TEST_MACHINE),
      { buildVolume: { x: 200, y: 200, z: 200 } },
      false
    );
    await controller.parse(new Uint8Array(1_000));
    expect(controller.getState().segmentCount).toBe(12);
    controller.bindCanvas(canvas);
    await settle();
    expect(controller.getState().segmentCount).toBe(99);
    expect(vol.mock.calls.some((c) => c[0] === TEST_MACHINE)).toBe(false);
    controller.dispose();
  });
});

describe('renderer events into state', () => {
  it('qualityFallback, presentation and error events update the snapshot; a parse resets presentation', async () => {
    const { controller } = makeWith(() => new SuiteStubWorker());
    await settle();
    const r = controller.raw.renderer();
    emitOn(r, { type: 'qualityFallback', from: 'tubes', to: 'lines', reason: 'test' });
    expect(controller.getState().activeQuality).toBe('lines');
    emitOn(r, { type: 'progress-presentation-changed', mode: 'band' });
    expect(controller.getState().presentation).toBe('band');
    emitOn(r, { type: 'error', code: 'E_TEST', message: 'renderer said no' });
    expect(controller.getState().error).toEqual({ code: 'E_TEST', message: 'renderer said no' });
    emitOn(r, { type: 'progress-presentation-changed', mode: 'exact' });
    await controller.parse(new Uint8Array(1_000));
    expect(controller.getState().presentation).toBe('hidden');
    controller.dispose();
  });

  it('decimation ordinals (11th-13th, 21st-23rd, 111th, 112th)', async () => {
    const { controller } = makeWith(() => new SuiteStubWorker());
    await settle();
    const r = controller.raw.renderer();
    const cases: Array<[number, string]> = [
      [11, '11th'],
      [12, '12th'],
      [13, '13th'],
      [21, '21st'],
      [22, '22nd'],
      [23, '23rd'],
      [111, '111th'],
      [112, '112th']
    ];
    for (const [n, word] of cases) {
      emitSuiteBuild(r, n, 5);
      expect(controller.getState().disclosure).toBe(
        'Showing every ' + word + ' extrusion segment (layer boundaries kept); travel hidden. 5 segments drawn.'
      );
    }
    controller.dispose();
  });
});

describe('parse wiring', () => {
  it('per-call options override parseDefaults', async () => {
    const { controller } = makeWith(() => new MetaWorker());
    await controller.parse(new Uint8Array(1_000), { plate: 2 } as never);
    expect(MetaWorker.posted).toEqual([{ plate: 2, maxSegments: 500 }]);
    controller.dispose();
  });

  it('the slicer estimate wins over the kinematic total', async () => {
    const { controller } = makeWith(() => new MetaWorker({ metadata: { printEstimate: { seconds: 90 } } }));
    await controller.parse(new Uint8Array(1_000));
    expect(controller.getState().totalTimeMs).toBe(90_000);
    expect(controller.getState().timeEstimateSource).toBe('slicer');
    controller.dispose();
  });

  it('a filament request is resolved against the new file before the build', async () => {
    const { controller } = makeWith(() => new MetaWorker({ metadata: { filaments: [{ slot: 0, color: '#ff0000' }] } }));
    await settle();
    controller.controls.setColorMode({ mode: 'filament' });
    const set = vi.spyOn(ToolpathRenderer.prototype, 'setColorMode');
    const setIR = vi.spyOn(ToolpathRenderer.prototype, 'setIR');
    await controller.parse(new Uint8Array(1_000));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][0]).toMatchObject({ mode: 'tool', palette: [[1, 0, 0]] });
    expect(set.mock.invocationCallOrder[0]).toBeLessThan(setIR.mock.invocationCallOrder[0]);
    controller.dispose();
  });

  it('file geometry auto-applies without a consumer volume; setBuildVolume makes it discovered-only', async () => {
    const vol = vi.spyOn(ToolpathRenderer.prototype, 'setBuildVolume');
    const a = makeWith(() => new SuiteStubWorker(TEST_MACHINE));
    await settle();
    await a.controller.parse(new Uint8Array(1_000));
    expect(vol.mock.calls.filter((c) => c[0] === TEST_MACHINE)).toHaveLength(1);
    expect(a.events.some((e) => e.type === 'machine-geometry-discovered')).toBe(false);
    a.controller.dispose();
    vol.mockClear();
    const b = makeWith(() => new SuiteStubWorker(TEST_MACHINE));
    await settle();
    b.controller.controls.setBuildVolume({ x: 200, y: 200, z: 200 });
    await b.controller.parse(new Uint8Array(1_000));
    expect(vol.mock.calls.some((c) => c[0] === TEST_MACHINE)).toBe(false);
    expect(b.events.filter((e) => e.type === 'machine-geometry-discovered')).toHaveLength(1);
    b.controller.dispose();
  });

  it('a non-session failure is E_UNKNOWN', async () => {
    const { controller } = makeWith(() => new SuiteStubWorker());
    await settle();
    const boom = new Error('ir boom');
    vi.spyOn(ToolpathRenderer.prototype, 'setIR').mockImplementation(() => {
      throw boom;
    });
    const out = await controller.parse(new Uint8Array(1_000));
    // #589: what was thrown is itself the original error.
    expect(out).toEqual({ ok: false, error: { code: 'E_UNKNOWN', message: 'ir boom', cause: boom } });
    expect(out.ok === false && !out.cancelled && out.error.cause).toBe(boom);
    controller.dispose();
  });

  it('a File reports its size in parse-started', async () => {
    const { controller, events } = makeWith(() => new SuiteStubWorker());
    await controller.parse(new File([new Uint8Array(1_234)], 'a.gcode'));
    expect(events.find((e) => e.type === 'parse-started')).toEqual({ type: 'parse-started', bytes: 1_234 });
    controller.dispose();
  });

  it('a zero-total progress has no fraction; partial slices reach the renderer', async () => {
    const append = vi.spyOn(ToolpathRenderer.prototype, 'appendPartial');
    const { controller, events } = makeWith(() => new MetaWorker({ progressTotal: 0, partial: true }));
    await settle();
    await controller.parse(new Uint8Array(1_000));
    expect(events.filter((e) => e.type === 'stage' && e.stage === 'parsing')[0]).toEqual({
      type: 'stage',
      stage: 'parsing',
      progress: undefined
    });
    expect(append).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('parse after dispose is E_DISPOSED', async () => {
    const { controller } = makeWith(() => new SuiteStubWorker());
    controller.dispose();
    expect(await controller.parse(new Uint8Array(1_000))).toEqual({
      ok: false,
      error: { code: 'E_DISPOSED', message: 'preview disposed' }
    });
  });
});

describe('value queries and progress', () => {
  it('answers before the renderer is ready: colour modes optimistic; stats from the renderer once bound', async () => {
    const { controller } = makeWith(() => new SuiteStubWorker(), {}, false);
    expect(controller.controls.isColorModeAvailable('feedrate')).toBe(true);
    expect(controller.controls.getRenderStats()).toBeNull();
    const stats = { backend: 'sentinel' };
    vi.spyOn(ToolpathRenderer.prototype, 'getRenderStats').mockReturnValue(stats as never);
    controller.bindCanvas(document.createElement('canvas'));
    await settle();
    expect(controller.controls.getRenderStats()).toBe(stats);
    controller.dispose();
  });

  it('capture on the 2D renderer rejects (never throws synchronously)', async () => {
    const { controller } = makeWith(() => new SuiteStubWorker(), { mode: '2d' });
    let p: Promise<Blob> | undefined;
    expect(() => {
      p = controller.controls.capture();
    }).not.toThrow();
    await expect(p).rejects.toMatchObject({ code: 'E_CAPTURE_UNSUPPORTED' });
    controller.dispose();
  });

  it('tick and clearProgress drive the renderer overlay; clearProgress resets the mapper', async () => {
    const { controller } = makeWith(() => new SuiteStubWorker());
    await settle();
    await controller.parse(new Uint8Array(1_000));
    const set = vi.spyOn(ToolpathRenderer.prototype, 'setProgress');
    const observed = controller.observeProgress({ v: 1, timestampMs: 0, state: 'complete' });
    expect(observed?.segIndex).toBe(11);
    const ticked = controller.tickProgress(1e9); // long after the observation: a NEW, stale result
    expect(ticked?.stale).toBe(true);
    expect(ticked).not.toBe(observed);
    expect(set.mock.calls.at(-1)?.[0]).toBe(ticked);
    controller.clearProgress();
    expect(set.mock.calls.at(-1)).toEqual([null]);
    expect(controller.tickProgress(2)?.segIndex).toBeNull();
    controller.dispose();
  });
});

describe('dispose', () => {
  it('is idempotent and silences subscribers', async () => {
    const { controller, events } = makeWith(() => new SuiteStubWorker());
    await settle();
    const sessionDispose = vi.spyOn(controller.raw.session, 'dispose');
    const states: unknown[] = [];
    controller.onStateChange((s) => states.push(s));
    const running = controller.parse(new Uint8Array(1_000));
    const before = events.length;
    controller.dispose();
    controller.dispose();
    await running;
    expect(sessionDispose).toHaveBeenCalledTimes(1);
    expect(events.length).toBe(before);
    const statesAtDispose = states.length;
    controller.clearProgress();
    expect(states.length).toBe(statesAtDispose);
  });
});
