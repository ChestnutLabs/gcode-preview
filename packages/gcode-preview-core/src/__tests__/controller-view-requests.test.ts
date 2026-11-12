// @vitest-environment happy-dom
/**
 * Scrub and layer-range calls made before a file is shown (Part C of the #542 parity follow-up). A
 * renderer resets its clipping when it is given a new IR, so a call that reached it before parse-complete
 * used to be wiped. The controller now re-applies the latest such request to the file the next successful
 * parse loads. Every expected value is a literal: the suite IR is 2 layers × 6 extrusions in one chunk, so
 * the full draw count is 24 vertices, one layer is 12, and a cut after segment 5 is 12.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { createPreviewController, LayerView2DRenderer } from '../index';
import { SuiteStubWorker, makeSuiteStubGL, makeTestIR } from '../testing';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

/** makeTestIR's 12 extrusions, each 1 mm at F600 (100 ms), so the kinematic axis is 0, 100, …, 1200 ms. */
function timedIR(): ToolpathIR {
  const b = new ToolpathIRBuilder({
    parserVersion: 'g3',
    units: 'mm',
    unitsSource: 'known',
    source: { byteLength: 1_000 }
  });
  for (let i = 0; i < 12; i++) {
    const l = i < 6 ? 0 : 1;
    const s = i % 6;
    b.addSegment({
      x0: 100 + s,
      y0: 100,
      z0: 0.2 * (l + 1),
      x1: 101 + s,
      y1: 100,
      z1: 0.2 * (l + 1),
      e: 1,
      feedrate: 600,
      kind: MoveKind.Extrude,
      layer: l,
      srcByte: i * 10
    });
  }
  return b.finalize();
}

/**
 * Replies `error` to the parses whose 0-based index is in `failing`, never answers the ones in `hanging`
 * (until a cancel), and completes the rest normally.
 */
class ScriptedWorker extends SuiteStubWorker {
  private seen = 0;
  constructor(
    private readonly failing: number[],
    ir?: () => ToolpathIR,
    private readonly hanging: number[] = []
  ) {
    super(undefined, ir);
  }
  override postMessage(msg: { type: string; id: number }): void {
    if (msg.type === 'parse' && this.hanging.includes(this.seen)) {
      this.seen++;
      return;
    }
    if (msg.type === 'parse' && this.failing.includes(this.seen++)) {
      queueMicrotask(() =>
        this.onmessage?.({ data: { v: 1, type: 'error', id: msg.id, error: { code: 'E_PARSE', message: 'boom' } } })
      );
      return;
    }
    super.postMessage(msg);
  }
}

interface Make3DOptions {
  failing?: number[];
  hanging?: number[];
  ir?: () => ToolpathIR;
}

function make3D(opts: Make3DOptions = {}) {
  const canvas = document.createElement('canvas');
  const controller = createPreviewController({
    createWorker: () => new ScriptedWorker(opts.failing ?? [], opts.ir, opts.hanging),
    renderer: {
      quality: 'lines',
      chunksPerTick: 8,
      createRenderer: () => makeSuiteStubGL(canvas),
      scheduleFrame: (cb) => cb()
    }
  });
  controller.bindCanvas(canvas);
  return controller;
}

/** A 3D controller whose renderer is already bound: the ordering where a pre-parse call used to be wiped. */
async function bound3D(opts: Make3DOptions = {}) {
  const controller = make3D(opts);
  await settle();
  expect(controller.raw.renderer()).not.toBeNull();
  return controller;
}

const drawCount = (c: ReturnType<typeof make3D>): number => c.raw.renderer()!.chunkMeshes[0].geometry.drawRange.count;
const load = async (c: ReturnType<typeof make3D>): Promise<void> => {
  await c.parse(new Uint8Array(1_000));
  await settle();
};

afterEach(() => vi.restoreAllMocks());

describe('3D: calls made before the first file is shown', () => {
  it('a scrub cut set on a bound renderer before the parse survives it', async () => {
    const c = await bound3D();
    c.controls.setScrubPosition(5);
    await load(c);
    expect(drawCount(c)).toBe(12);
    c.dispose();
  });

  it('a layer range set on a bound renderer before the parse survives it', async () => {
    const c = await bound3D();
    c.controls.setLayerRange(0, 0);
    await load(c);
    expect(drawCount(c)).toBe(12);
    c.dispose();
  });

  it('the latest call wins, and a clear (null) is a call: 5 then null leaves no cut', async () => {
    const c = await bound3D();
    c.controls.setScrubPosition(5);
    c.controls.setScrubPosition(null);
    await load(c);
    expect(drawCount(c)).toBe(24);
    c.dispose();
  });

  it('setScrubTime before the parse is resolved on the loaded file’s time axis', async () => {
    const c = await bound3D({ ir: timedIR });
    // 250 ms: 2 segments have finished, so the cut is after segment 1 (2 segments, 4 vertices).
    c.controls.setScrubTime(250);
    await load(c);
    expect(c.getState().totalTimeMs).toBe(1200);
    expect(drawCount(c)).toBe(4);
    c.dispose();
  });

  it('setScrubTime(null) before the parse is a clear that wins over an earlier cut', async () => {
    const c = await bound3D();
    c.controls.setScrubPosition(5);
    c.controls.setScrubTime(null);
    await load(c);
    expect(drawCount(c)).toBe(24);
    c.dispose();
  });

  it('a scrub-time and a segment cut share one slot: the later one wins either way', async () => {
    const a = await bound3D({ ir: timedIR });
    a.controls.setScrubPosition(5);
    a.controls.setScrubTime(250);
    await load(a);
    expect(drawCount(a)).toBe(4);
    a.dispose();
    const b = await bound3D({ ir: timedIR });
    b.controls.setScrubTime(250);
    b.controls.setScrubPosition(5);
    await load(b);
    expect(drawCount(b)).toBe(12);
    b.dispose();
  });

  it('also applies when the renderer binds only after the parse completes (the queued path)', async () => {
    // Each half on its own controller: a range and a cut together draw only the smaller of the two.
    const range = make3D({ ir: timedIR });
    range.controls.setLayerRange(0, 0);
    await load(range);
    expect(drawCount(range)).toBe(12);
    range.dispose();
    const scrub = make3D({ ir: timedIR });
    scrub.controls.setScrubTime(250);
    await load(scrub);
    expect(drawCount(scrub)).toBe(4);
    scrub.dispose();
  });

  it('also applies when the canvas is rebound while the file loads (the re-apply waits for the new renderer)', async () => {
    // A call made on the old renderer is not queued for the new one; only the re-apply carries it over.
    const rebound = async (call: (c: ReturnType<typeof make3D>) => void): Promise<number> => {
      const c = await bound3D({ ir: timedIR });
      call(c);
      let boundAtComplete: unknown = 'unseen';
      c.onEvent((e) => {
        if (e.type === 'parse-complete') boundAtComplete = c.raw.renderer();
      });
      const run = c.parse(new Uint8Array(1_000));
      c.bindCanvas(document.createElement('canvas'));
      await run;
      await settle();
      expect(boundAtComplete).toBeNull();
      const n = drawCount(c);
      c.dispose();
      return n;
    };
    expect(await rebound((c) => c.controls.setLayerRange(0, 0))).toBe(12);
    expect(await rebound((c) => c.controls.setScrubPosition(5))).toBe(12);
    expect(await rebound((c) => c.controls.setScrubTime(250))).toBe(4);
  });
});

describe('3D: which parse consumes the request', () => {
  it('a failed parse keeps it for the next successful one', async () => {
    const c = await bound3D({ failing: [0] });
    c.controls.setScrubPosition(5);
    expect(await c.parse(new Uint8Array(1_000))).toMatchObject({ ok: false, error: { code: 'E_PARSE' } });
    await load(c);
    expect(drawCount(c)).toBe(12);
    c.dispose();
  });

  it('a cancelled parse keeps it for the next successful one', async () => {
    const c = await bound3D({ hanging: [0] });
    c.controls.setScrubPosition(5);
    const run = c.parse(new Uint8Array(1_000));
    await settle();
    c.cancel();
    expect(await run).toEqual({ ok: false, cancelled: true });
    await load(c);
    expect(drawCount(c)).toBe(12);
    c.dispose();
  });

  it('newest parse wins (#531): the superseded parse never consumes it, the applied one does', async () => {
    let n = 0;
    // The superseded parse's file has 1 layer; the applied one is the 2-layer suite file.
    const oneLayer = (): ToolpathIR => {
      const b = new ToolpathIRBuilder({
        parserVersion: 'g3',
        units: 'mm',
        unitsSource: 'known',
        source: { byteLength: 10 }
      });
      b.addSegment({
        x0: 0,
        y0: 0,
        z0: 0.2,
        x1: 1,
        y1: 0,
        z1: 0.2,
        e: 1,
        kind: MoveKind.Extrude,
        layer: 0,
        srcByte: 0
      });
      return b.finalize();
    };
    const c = await bound3D({ ir: () => (n++ === 0 ? oneLayer() : makeTestIR()) });
    c.controls.setScrubPosition(5);
    const a = c.parse(new Uint8Array(10));
    const b = c.parse(new Uint8Array(1_000));
    expect(await a).toEqual({ ok: false, cancelled: true });
    expect((await b).ok).toBe(true);
    await settle();
    expect(c.getState().layerCount).toBe(2);
    expect(drawCount(c)).toBe(12);
    c.dispose();
  });
});

describe('3D: calls made once a file is shown', () => {
  it('a call made while a new file is loading applies to that new file', async () => {
    const c = await bound3D();
    await load(c);
    const run = c.parse(new Uint8Array(1_000));
    c.controls.setScrubPosition(5);
    await run;
    await settle();
    expect(drawCount(c)).toBe(12);
    c.dispose();
  });

  it('a call made after the file is shown applies to it only: the next file shows everything', async () => {
    const c = await bound3D();
    await load(c);
    c.controls.setScrubPosition(5);
    c.controls.setLayerRange(0, 0);
    expect(drawCount(c)).toBe(12);
    await load(c);
    expect(drawCount(c)).toBe(24);
    c.dispose();
  });

  it('a call made on the shown file after a failed reload replaces the request made during it', async () => {
    const c = await bound3D({ failing: [1] });
    await load(c);
    // During the failing reload: recorded for the incoming file.
    const run = c.parse(new Uint8Array(1_000));
    c.controls.setScrubPosition(5);
    await run;
    // Back on the shown file: this call is for it, so the request for the next file is gone.
    c.controls.setScrubPosition(3);
    await load(c);
    expect(drawCount(c)).toBe(24);
    c.dispose();
  });

  it('the same holds for the layer range', async () => {
    const c = await bound3D({ failing: [1] });
    await load(c);
    const run = c.parse(new Uint8Array(1_000));
    c.controls.setLayerRange(0, 0);
    await run;
    c.controls.setLayerRange(1, 1);
    await load(c);
    expect(drawCount(c)).toBe(24);
    c.dispose();
  });

  it('a call made after a cancelled reload applies to the shown file only', async () => {
    const c = await bound3D({ hanging: [1] });
    await load(c);
    const run = c.parse(new Uint8Array(1_000));
    await settle();
    c.cancel();
    expect(await run).toEqual({ ok: false, cancelled: true });
    c.controls.setLayerRange(0, 0);
    expect(drawCount(c)).toBe(12);
    await load(c);
    expect(drawCount(c)).toBe(24);
    c.dispose();
  });

  it.each([
    ['setScrubPosition(5)', (c: ReturnType<typeof make3D>) => c.controls.setScrubPosition(5)],
    ['setLayerRange(0, 0)', (c: ReturnType<typeof make3D>) => c.controls.setLayerRange(0, 0)]
  ])('a parse-complete handler’s %s applies to that file only: the next file shows everything', async (_, call) => {
    const c = await bound3D();
    await load(c);
    let armed = true;
    c.onEvent((e) => {
      if (e.type === 'parse-complete' && armed) {
        armed = false;
        call(c);
      }
    });
    await load(c);
    expect(armed).toBe(false);
    expect(drawCount(c)).toBe(12);
    await load(c);
    expect(drawCount(c)).toBe(24);
    c.dispose();
  });

  it.each([
    ['setScrubPosition(5)', (c: ReturnType<typeof make3D>) => c.controls.setScrubPosition(5)],
    ['setLayerRange(0, 0)', (c: ReturnType<typeof make3D>) => c.controls.setLayerRange(0, 0)]
  ])('a state listener’s %s on the new file’s summary applies to that file only', async (_, call) => {
    const c = await bound3D();
    await load(c);
    const shown = c.getState().summary;
    let parsingThen: boolean | null = null;
    c.onStateChange((s) => {
      if (parsingThen === null && s.summary !== shown) {
        // The new file's summary arrives while `parsing` is still true: the window this guards.
        parsingThen = s.parsing;
        call(c);
      }
    });
    await load(c);
    expect(parsingThen).toBe(true);
    expect(drawCount(c)).toBe(12);
    await load(c);
    expect(drawCount(c)).toBe(24);
    c.dispose();
  });

  it('a call made as a superseded parse settles applies to the newer file that is still loading (#531)', async () => {
    const c = await bound3D({ hanging: [1] });
    await load(c);
    const stale = c.parse(new Uint8Array(1_000));
    await settle();
    let called = false;
    c.onStateChange((s) => {
      // The superseded parse's own `parsing: false`; the newer parse has not started its run yet.
      if (!called && !s.parsing) {
        called = true;
        c.controls.setLayerRange(0, 0);
      }
    });
    const fresh = c.parse(new Uint8Array(1_000));
    expect(await stale).toEqual({ ok: false, cancelled: true });
    expect((await fresh).ok).toBe(true);
    await settle();
    expect(called).toBe(true);
    expect(drawCount(c)).toBe(12);
    c.dispose();
  });

  it('a pre-parse request is consumed by the file it applied to: the next file shows everything', async () => {
    const c = await bound3D();
    c.controls.setLayerRange(0, 0);
    await load(c);
    expect(drawCount(c)).toBe(12);
    await load(c);
    expect(drawCount(c)).toBe(24);
    c.dispose();
  });
});

describe('2D: the renderer binds synchronously, so a pre-parse call always reached it first', () => {
  it('the layer range is re-applied after the 2D setIR', async () => {
    const calls: string[] = [];
    const setIR = LayerView2DRenderer.prototype.setIR;
    vi.spyOn(LayerView2DRenderer.prototype, 'setIR').mockImplementation(function (this: LayerView2DRenderer, ir) {
      calls.push('setIR');
      setIR.call(this, ir);
    });
    vi.spyOn(LayerView2DRenderer.prototype, 'setLayerRange').mockImplementation((a, b) => {
      calls.push(`setLayerRange ${a},${b}`);
    });
    vi.spyOn(LayerView2DRenderer.prototype, 'setScrubPosition').mockImplementation((s) => {
      calls.push(`setScrubPosition ${String(s)}`);
    });
    const canvas = document.createElement('canvas');
    const c = createPreviewController({ createWorker: () => new SuiteStubWorker(), renderer: { mode: '2d' } });
    c.bindCanvas(canvas);
    expect(c.raw.renderer()).not.toBeNull();
    c.controls.setLayerRange(0, 0);
    c.controls.setScrubPosition(5);
    await c.parse(new Uint8Array(1_000));
    await settle();
    expect(calls).toEqual([
      'setLayerRange 0,0',
      'setScrubPosition 5',
      'setIR',
      'setLayerRange 0,0',
      'setScrubPosition 5'
    ]);
    c.dispose();
  });
});
