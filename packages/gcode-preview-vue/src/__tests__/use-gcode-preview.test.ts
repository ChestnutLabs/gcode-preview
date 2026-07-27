// @vitest-environment happy-dom
/**
 * useGcodePreview composable tests (DD-007 §4.1–4.2/§9, phase 1, issue #104).
 *
 * Stub worker (protocol-v1 shaped) + stub GL renderer + manual frame scheduler:
 * lifecycle, HMR/leak behavior, reactivity boundary, controls, progress, and the
 * DD-005 consumer-wins bed precedence are all deterministic — no browser needed.
 */
import { describe, expect, it } from 'vitest';
import { effectScope, isReactive, nextTick } from 'vue';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import type { MachineGeometry } from '@chestnutlabs/toolpath-core';
import type { GLRendererLike } from '@chestnutlabs/gcode-renderer-three';
import { useGcodePreview, type PreviewEvent } from '../index';

function makeIR(layers = 2, perLayer = 6): ToolpathIR {
  const b = new ToolpathIRBuilder({
    parserVersion: 'test',
    units: 'mm',
    unitsSource: 'known',
    source: { byteLength: 1_000 }
  });
  let src = 0;
  for (let l = 0; l < layers; l++) {
    for (let s = 0; s < perLayer; s++) {
      b.addSegment({
        x0: 100 + s,
        y0: 100,
        z0: 0.2 * (l + 1),
        x1: 101 + s,
        y1: 100,
        z1: 0.2 * (l + 1),
        e: 1,
        kind: MoveKind.Extrude,
        layer: l,
        srcByte: src++ * 10
      });
    }
  }
  return b.finalize();
}

/** Protocol-v1-shaped stub worker: parse → done (optionally with metadata), cancel → cancelled. */
class StubWorker {
  static created = 0;
  static terminated = 0;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  constructor(private readonly machine?: MachineGeometry) {
    StubWorker.created++;
  }
  postMessage(msg: { type: string; id: number }): void {
    if (msg.type === 'parse') {
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            v: 1,
            type: 'done',
            id: msg.id,
            ir: makeIR(),
            stats: { bytes: 1_000, wallMs: 1, stopReason: undefined },
            metadata: this.machine === undefined ? undefined : { machine: this.machine }
          }
        });
      });
    } else if (msg.type === 'cancel') {
      queueMicrotask(() => {
        this.onmessage?.({ data: { v: 1, type: 'cancelled', id: msg.id } });
      });
    }
  }
  terminate(): void {
    StubWorker.terminated++;
  }
}

const MACHINE: MachineGeometry = {
  bed: { kind: 'rect', min: { x: 0, y: 0 }, max: { x: 256, y: 256 } },
  heightMm: 256,
  origin: 'front-left',
  confidence: 'known',
  source: { adapterId: 'test', evidence: 'stub' }
};

function makeHarness(opts: { machine?: MachineGeometry; buildVolume?: boolean } = {}) {
  const canvas = document.createElement('canvas');
  const glCalls = { dispose: 0 };
  const stubGL: GLRendererLike = {
    render: () => undefined,
    setSize: () => undefined,
    dispose: () => {
      glCalls.dispose++;
    },
    domElement: canvas
  };
  const ticks: (() => void)[] = [];
  const scope = effectScope();
  const preview = scope.run(() =>
    useGcodePreview({
      createWorker: () => new StubWorker(opts.machine),
      renderer: {
        buildVolume: opts.buildVolume === true ? { x: 220, y: 220, z: 250 } : undefined,
        quality: 'lines',
        chunksPerTick: 8,
        createRenderer: () => stubGL,
        scheduleFrame: (cb) => ticks.push(cb)
      }
    })
  )!;
  const events: PreviewEvent[] = [];
  preview.onEvent((e) => events.push(e));
  const runTicks = (): void => {
    while (ticks.length > 0) ticks.shift()?.();
  };
  // The 3D renderer is loaded on demand (DD-014): binding resolves a few macrotasks later.
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return { preview, canvas, glCalls, scope, events, runTicks, settle };
}

describe('useGcodePreview — lifecycle (§4.2)', () => {
  it('binds the renderer when the canvas ref is set and parses end to end', async () => {
    const h = makeHarness();
    h.preview.canvasRef.value = h.canvas;
    await nextTick();
    await h.settle();
    const outcome = await h.preview.parse(new Uint8Array(1_000));
    h.runTicks();
    expect(outcome.ok).toBe(true);
    expect(h.preview.state.summary).toMatchObject({ segments: 12, layers: 2, complete: true });
    expect(h.preview.state.segmentCount).toBe(12);
    expect(h.preview.raw.renderer()).not.toBeNull();
    expect(h.events.some((e) => e.type === 'parse-complete')).toBe(true);
  });

  it('parse before canvas binding retains the IR; binding later renders it', async () => {
    const h = makeHarness();
    const outcome = await h.preview.parse(new Uint8Array(1_000));
    expect(outcome.ok).toBe(true);
    expect(h.preview.raw.renderer()).toBeNull();
    h.preview.canvasRef.value = h.canvas;
    await nextTick();
    await h.settle();
    h.runTicks();
    expect(h.preview.raw.renderer()?.segmentCount).toBe(12);
  });

  it('scope disposal disposes everything, idempotently', async () => {
    const created0 = StubWorker.created;
    const terminated0 = StubWorker.terminated;
    const h = makeHarness();
    h.preview.canvasRef.value = h.canvas;
    await nextTick();
    await h.settle();
    await h.preview.parse(new Uint8Array(8));
    h.scope.stop();
    h.preview.dispose(); // second call must be a no-op
    expect(StubWorker.created - created0).toBe(1);
    expect(StubWorker.terminated - terminated0).toBe(1);
    expect(h.glCalls.dispose).toBe(1);
    const after = await h.preview.parse(new Uint8Array(8));
    expect(after).toMatchObject({ ok: false, error: { code: 'E_DISPOSED' } });
  });

  it('50 mount/parse/dispose cycles leak no workers (HMR safety)', async () => {
    const created0 = StubWorker.created;
    const terminated0 = StubWorker.terminated;
    for (let i = 0; i < 50; i++) {
      const h = makeHarness();
      h.preview.canvasRef.value = h.canvas;
      await nextTick();
      await h.preview.parse(new Uint8Array(8));
      h.scope.stop();
    }
    expect(StubWorker.created - created0).toBe(50);
    expect(StubWorker.terminated - terminated0).toBe(50);
  });
});

describe('useGcodePreview — reactivity boundary (§4.2)', () => {
  it('never proxies the IR: the parse result and raw renderer are non-reactive', async () => {
    const h = makeHarness();
    h.preview.canvasRef.value = h.canvas;
    await nextTick();
    await h.settle();
    const outcome = await h.preview.parse(new Uint8Array(1_000));
    if (!outcome.ok) throw new Error('parse failed');
    expect(isReactive(outcome.result.ir)).toBe(false);
    expect(isReactive(outcome.result.ir.segments)).toBe(false);
    expect(isReactive(h.preview.raw.renderer())).toBe(false);
    // State carries summaries only — no typed arrays anywhere in it.
    expect(JSON.stringify(h.preview.state.summary)).not.toContain('Float32');
  });
});

describe('useGcodePreview — controls & progress', () => {
  it('controls pass through to the renderer (scrub cuts the draw range)', async () => {
    const h = makeHarness();
    h.preview.canvasRef.value = h.canvas;
    await nextTick();
    await h.settle();
    await h.preview.parse(new Uint8Array(1_000));
    h.runTicks();
    const mesh = h.preview.raw.renderer()!.chunkMeshes[0];
    expect(mesh.geometry.drawRange.count).toBe(24); // 12 segments × 2
    h.preview.controls.setScrubPosition(5);
    expect(mesh.geometry.drawRange.count).toBe(12);
    h.preview.controls.setScrubPosition(null);
    expect(mesh.geometry.drawRange.count).toBe(24);
  });

  it('observeProgress maps and drives the overlay; clearProgress hides it', async () => {
    const h = makeHarness();
    h.preview.canvasRef.value = h.canvas;
    await nextTick();
    await h.settle();
    await h.preview.parse(new Uint8Array(1_000));
    h.runTicks();
    const mapped = h.preview.observeProgress({ v: 1, timestampMs: 1_000, position: { byte: 55 } });
    expect(mapped).toMatchObject({ basis: 'byte', confidence: 'known', segIndex: 5 });
    expect(h.preview.state.presentation).toBe('exact');
    const stale = h.preview.tickProgress(999_999);
    expect(stale?.stale).toBe(true);
    expect(h.preview.state.presentation).toBe('stale');
    h.preview.clearProgress();
    expect(h.preview.state.presentation).toBe('hidden');
  });

  it('observeProgress is null before a successful parse (no fabricated mapping)', () => {
    const h = makeHarness();
    expect(h.preview.observeProgress({ v: 1, timestampMs: 1, position: { percent: 0.5 } })).toBeNull();
  });
});

describe('useGcodePreview — bed geometry precedence (DD-005 consumer-wins)', () => {
  it('auto-applies file-discovered geometry when the consumer configured nothing', async () => {
    const h = makeHarness({ machine: MACHINE });
    h.preview.canvasRef.value = h.canvas;
    await nextTick();
    await h.settle();
    await h.preview.parse(new Uint8Array(1_000));
    expect(h.preview.state.metadata?.machine).toMatchObject({ confidence: 'known' });
    expect(h.events.some((e) => e.type === 'machine-geometry-discovered')).toBe(false);
  });

  it('a consumer-configured volume wins: discovery is surfaced, not applied', async () => {
    const h = makeHarness({ machine: MACHINE, buildVolume: true });
    h.preview.canvasRef.value = h.canvas;
    await nextTick();
    await h.settle();
    await h.preview.parse(new Uint8Array(1_000));
    const ev = h.events.find((e) => e.type === 'machine-geometry-discovered');
    expect(ev).toMatchObject({ machine: { confidence: 'known' } });
  });
});

describe('useGcodePreview — parse-during-parse & cancellation (§5)', () => {
  it('cancel() surfaces parse-cancelled without an error state', async () => {
    const h = makeHarness();
    h.preview.canvasRef.value = h.canvas;
    await nextTick();
    await h.settle();
    const p = h.preview.parse(new Uint8Array(8));
    h.preview.cancel();
    const outcome = await p;
    // The stub answers done and cancelled on microtasks; whichever the session
    // settles first is a valid terminal — but never an error.
    expect('error' in outcome && !outcome.ok).toBe(false);
  });
});
