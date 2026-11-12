// @vitest-environment happy-dom
/**
 * Controller tests (DD-007 §4.6, phase 5, issue #112): the portable behavioral suite
 * runs against the controller DIRECTLY (the reference harness every adapter mirrors),
 * plus the snapshot state-model guarantees the framework bridges rely on.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type MachineGeometry, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { createPreviewController, LayerView2DRenderer, type PreviewEvent, type PreviewRendererEvent } from '../index';
import {
  REQUIRED_CONTROLS,
  REQUIRED_STATE_KEYS,
  SuiteStubWorker,
  makeSuiteStubGL,
  runBehavioralSuite,
  type AdapterInstance
} from '../testing';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

function makeController(opts: { machine?: MachineGeometry; consumerVolume?: boolean } = {}) {
  const canvas = document.createElement('canvas');
  const controller = createPreviewController({
    createWorker: () => new SuiteStubWorker(opts.machine),
    renderer: {
      buildVolume: opts.consumerVolume === true ? { x: 220, y: 220, z: 250 } : undefined,
      quality: 'lines',
      chunksPerTick: 8,
      createRenderer: () => makeSuiteStubGL(canvas),
      scheduleFrame: (cb) => cb()
    }
  });
  controller.bindCanvas(canvas);
  return controller;
}

runBehavioralSuite(
  'preview-core controller',
  { describe, it, expect },
  {
    create(opts = {}) {
      const controller = makeController(opts);
      const instance: AdapterInstance = {
        parse: (bytes) => controller.parse(bytes),
        getState: () => controller.getState(),
        controls: controller.controls,
        observeProgress: (obs) => controller.observeProgress(obs),
        clearProgress: () => controller.clearProgress(),
        onEvent: (cb) => controller.onEvent(cb),
        firstChunkDrawCount: () => controller.raw.renderer()!.chunkMeshes[0].geometry.drawRange.count,
        dispose: () => controller.dispose(),
        settle
      };
      return instance;
    }
  }
);

describe('state parity list (REQUIRED_STATE_KEYS)', () => {
  it('names exactly the keys the controller snapshot carries, before and after a parse', async () => {
    const controller = makeController();
    const sorted = (keys: readonly string[]) => [...keys].sort();
    expect(sorted(REQUIRED_STATE_KEYS)).toEqual(sorted(Object.keys(controller.getState())));
    await controller.parse(new Uint8Array(1_000));
    await settle();
    expect(sorted(REQUIRED_STATE_KEYS)).toEqual(sorted(Object.keys(controller.getState())));
    expect(REQUIRED_STATE_KEYS.length).toBe(15);
    await controller.dispose();
  });
});

describe('controls parity list (REQUIRED_CONTROLS)', () => {
  it('names exactly the methods the controller controls object carries', async () => {
    const controller = makeController();
    expect([...REQUIRED_CONTROLS].sort()).toEqual(Object.keys(controller.controls).sort());
    expect(REQUIRED_CONTROLS.length).toBe(26);
    await controller.dispose();
  });
});

describe('controller state model (bridge guarantees)', () => {
  it('replaces the snapshot identity on every change and notifies subscribers', async () => {
    const controller = makeController();
    const before = controller.getState();
    const seen: unknown[] = [];
    controller.onStateChange((s) => seen.push(s));
    await controller.parse(new Uint8Array(1_000));
    await settle();
    const after = controller.getState();
    expect(after).not.toBe(before); // identity change — useSyncExternalStore contract
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(after); // last notification IS the current snapshot
    // Old snapshots are frozen history: the pre-parse snapshot still says parsing:false/summary:null.
    expect(before.summary).toBeNull();
    expect(after.summary).not.toBeNull();
    controller.dispose();
  });

  it('unbinding the canvas keeps IR state; rebinding restores the scene', async () => {
    const controller = makeController();
    await controller.parse(new Uint8Array(1_000));
    await settle();
    controller.bindCanvas(null);
    expect(controller.raw.renderer()).toBeNull();
    expect(controller.getState().summary?.segments).toBe(12);
    const canvas2 = document.createElement('canvas');
    controller.bindCanvas(canvas2);
    await settle();
    expect(controller.raw.renderer()?.segmentCount).toBe(12);
    controller.dispose();
  });
});

describe('renderer.mode selection (DD-014 D5)', () => {
  it('mode "2d" binds synchronously (no Three.js load) and discloses 3D-only requests', async () => {
    const canvas = document.createElement('canvas');
    const controller = createPreviewController({
      createWorker: () => new SuiteStubWorker(),
      renderer: { mode: '2d' }
    });
    controller.bindCanvas(canvas);
    // The 2D renderer is a static, three-free import — ready on the same tick, no settle needed.
    expect(controller.raw.renderer()).not.toBeNull();

    const events: PreviewEvent[] = [];
    controller.onEvent((e) => events.push(e));
    controller.controls.setCameraMode('orthographic'); // 3D-only
    controller.controls.setQuality('high'); // 3D-only
    const disclosed = events
      .filter((e): e is Extract<PreviewEvent, { type: 'renderer-unsupported' }> => e.type === 'renderer-unsupported')
      .map((e) => e.feature)
      .sort();
    expect(disclosed).toEqual(['camera', 'quality']);

    const outcome = await controller.parse(new Uint8Array(1_000));
    expect(outcome.ok).toBe(true);
    expect(controller.getState().summary?.segments).toBe(12);
    controller.dispose();
  });

  it('mode "3d" (default) resolves the renderer asynchronously (Three.js loaded on demand)', async () => {
    const canvas = document.createElement('canvas');
    const controller = createPreviewController({
      createWorker: () => new SuiteStubWorker(),
      renderer: { quality: 'lines', createRenderer: () => makeSuiteStubGL(canvas), scheduleFrame: (cb) => cb() }
    });
    controller.bindCanvas(canvas);
    expect(controller.raw.renderer()).toBeNull(); // dynamic import → not ready this tick
    await settle();
    expect(controller.raw.renderer()).not.toBeNull();
    controller.dispose();
  });
});

describe('LayerView2DRenderer honesty (DD-014 §6/§11)', () => {
  function irWithLayers(conf: 'known' | 'unavailable') {
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    b.addSegment({ x0: 0, y0: 0, z0: 0.2, x1: 1, y1: 0, z1: 0.2, e: 1, kind: MoveKind.Extrude, layer: 0, srcByte: 0 });
    const ir = b.finalize();
    ir.header.capabilities['layers'] = conf;
    return ir;
  }

  it('discloses a non-planar/CNC IR via renderer-unsupported; a planar IR does not', () => {
    const canvas = document.createElement('canvas');
    const r = new LayerView2DRenderer(canvas);
    const events: PreviewRendererEvent[] = [];
    r.onEvent((e) => events.push(e));

    r.setIR(irWithLayers('known'));
    expect(events.filter((e) => e.type === 'renderer-unsupported')).toHaveLength(0);

    r.setIR(irWithLayers('unavailable'));
    const disclosures = events.filter(
      (e): e is Extract<PreviewRendererEvent, { type: 'renderer-unsupported' }> => e.type === 'renderer-unsupported'
    );
    expect(disclosures).toHaveLength(1);
    expect(disclosures[0].feature).toBe('layers');
    r.dispose();
  });

  it('camera/quality on the 2D view disclose, never throw', () => {
    const canvas = document.createElement('canvas');
    const r = new LayerView2DRenderer(canvas);
    const feats: string[] = [];
    r.onEvent((e) => {
      if (e.type === 'renderer-unsupported') feats.push(e.feature);
    });
    r.setCameraMode('orthographic');
    r.setQuality('high');
    expect(feats.sort()).toEqual(['camera', 'quality']);
    r.dispose();
  });
});

describe('parse supersession (#529)', () => {
  // The Nth parse the worker sees returns an IR of (N + 1) * 5 segments, so each file is identifiable.
  const sizedIR = (segments: number): ToolpathIR => {
    const b = new ToolpathIRBuilder({
      parserVersion: 'supersede-test',
      units: 'mm',
      unitsSource: 'known',
      source: { byteLength: 1_000 }
    });
    for (let i = 0; i < segments; i++) {
      b.addSegment({
        x0: 100 + i,
        y0: 100,
        z0: 0.2,
        x1: 101 + i,
        y1: 100,
        z1: 0.2,
        e: 1,
        kind: MoveKind.Extrude,
        layer: 0,
        srcByte: i * 10
      });
    }
    return b.finalize();
  };
  function make(): {
    controller: ReturnType<typeof createPreviewController>;
    events: PreviewEvent[];
  } {
    const canvas = document.createElement('canvas');
    let parses = 0;
    const controller = createPreviewController({
      createWorker: () => new SuiteStubWorker(undefined, () => sizedIR(++parses * 5)),
      renderer: {
        quality: 'lines',
        chunksPerTick: 8,
        createRenderer: () => makeSuiteStubGL(canvas),
        scheduleFrame: (cb) => cb()
      }
    });
    controller.bindCanvas(canvas);
    const events: PreviewEvent[] = [];
    controller.onEvent((e) => events.push(e));
    return { controller, events };
  }
  const types = (events: PreviewEvent[], type: PreviewEvent['type']): number =>
    events.filter((e) => e.type === type).length;

  it('a; b; c in one tick: only C is applied, one ready, no parse-error, A and B report cancelled', async () => {
    const { controller, events } = make();
    const a = controller.parse(new Uint8Array(1_000));
    const b = controller.parse(new Uint8Array(1_001));
    const c = controller.parse(new Uint8Array(1_002));
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    await settle();
    expect(ra).toEqual({ ok: false, cancelled: true });
    expect(rb).toEqual({ ok: false, cancelled: true });
    expect(rc.ok).toBe(true);
    expect(types(events, 'parse-complete')).toBe(1);
    expect(types(events, 'parse-error')).toBe(0);
    expect(types(events, 'parse-cancelled')).toBe(1); // A ran and was cancelled; B never started
    expect(types(events, 'parse-started')).toBe(2); // A and C
    expect(controller.getState().summary?.segments).toBe(10); // C is the 2nd parse the worker saw
    expect(controller.getState().parsing).toBe(false);
    expect(controller.getState().error).toBeNull();
    expect(controller.raw.renderer()!.segmentCount).toBe(10);
    controller.dispose();
  });

  it('a result that completes before its cancel lands is discarded when a newer parse was issued', async () => {
    const { controller, events } = make();
    const a = controller.parse(new Uint8Array(1_000));
    const b = controller.parse(new Uint8Array(1_001));
    expect((await a).ok).toBe(false);
    expect((await b).ok).toBe(true);
    await settle();
    expect(types(events, 'parse-complete')).toBe(1);
    expect(controller.getState().summary?.segments).toBe(10);
    controller.dispose();
  });

  it('a lone parse and a sequential re-parse are unaffected', async () => {
    const { controller, events } = make();
    expect((await controller.parse(new Uint8Array(1_000))).ok).toBe(true);
    expect((await controller.parse(new Uint8Array(1_001))).ok).toBe(true);
    await settle();
    expect(types(events, 'parse-complete')).toBe(2);
    expect(types(events, 'parse-cancelled')).toBe(0);
    expect(controller.getState().summary?.segments).toBe(10);
    controller.dispose();
  });

  it('dispose while a superseded call waits: that call reports cancelled and starts nothing', async () => {
    const { controller } = make();
    const a = controller.parse(new Uint8Array(1_000));
    const b = controller.parse(new Uint8Array(1_001));
    controller.dispose();
    expect(await b).toEqual({ ok: false, cancelled: true });
    await a;
    expect(controller.getState().summary).toBeNull(); // nothing was applied after dispose
  });
});

describe('time estimate + time scrub (#181)', () => {
  it('surfaces a kinematic total (no slicer estimate) and resolves time scrub', async () => {
    const canvas = document.createElement('canvas');
    const controller = createPreviewController({
      createWorker: () => new SuiteStubWorker(),
      renderer: { quality: 'lines', createRenderer: () => makeSuiteStubGL(canvas), scheduleFrame: (cb) => cb() }
    });
    controller.bindCanvas(canvas);
    await controller.parse(new Uint8Array(1_000));
    await settle();
    const st = controller.getState();
    expect(typeof st.totalTimeMs).toBe('number');
    expect(st.timeEstimateSource).toBe('kinematic'); // the stub IR carries no slicer printEstimate
    // Time scrub resolves to a segment-index scrub without throwing (before/after clear).
    expect(() => controller.controls.setScrubTime(500)).not.toThrow();
    expect(() => controller.controls.setScrubTime(null)).not.toThrow();
    controller.dispose();
  });

  it('cuts the draw range at the segments completed by that time (inclusive scrub index)', async () => {
    // 12 one-mm segments at 60000 mm/min = 1 ms each: segment i ends at (i + 1) ms.
    const timed = (): ToolpathIR => {
      const b = new ToolpathIRBuilder({
        parserVersion: 'scrub-time-test',
        units: 'mm',
        unitsSource: 'known',
        source: { byteLength: 1_000 }
      });
      for (let i = 0; i < 12; i++) {
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
    };
    const canvas = document.createElement('canvas');
    const controller = createPreviewController({
      createWorker: () => new SuiteStubWorker(undefined, timed),
      renderer: {
        quality: 'lines',
        chunksPerTick: 8,
        createRenderer: () => makeSuiteStubGL(canvas),
        scheduleFrame: (cb) => cb()
      }
    });
    controller.bindCanvas(canvas);
    // Before any parse there is no time axis: a time scrub is a no-op (it queues a cleared cut), never a throw.
    expect(() => controller.controls.setScrubTime(5)).not.toThrow();
    await controller.parse(new Uint8Array(1_000));
    await settle();
    const draw = (): number => controller.raw.renderer()!.chunkMeshes[0].geometry.drawRange.count;
    expect(draw()).toBe(24); // the pre-parse call left no cut behind
    expect(controller.getState().totalTimeMs).toBeCloseTo(12, 6);
    expect(draw()).toBe(24); // two vertices per segment, nothing cut
    const cases: Array<[number, number]> = [
      [0.5, 0], // nothing has finished: nothing drawn
      [1, 2], // segment 0 ends at 1 ms
      [5, 10], // exactly 5 done: 5 segments, not 6
      [5.5, 10], // segment 5 is still running
      [11.999, 22],
      [12, 24],
      [500, 24]
    ];
    for (const [ms, count] of cases) {
      controller.controls.setScrubTime(ms);
      expect(draw(), 'ms=' + String(ms)).toBe(count);
    }
    controller.controls.setScrubTime(null);
    expect(draw()).toBe(24);
    controller.dispose();
  });
});
