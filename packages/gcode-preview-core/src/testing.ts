/**
 * Framework-portable behavioral suite (DD-007 §4.6, phase 5): the SAME parse → state →
 * controls → progress → dispose contract, runnable through every adapter — the parity
 * lock that keeps Vue/React/Svelte from drifting into different feature sets.
 *
 * Adapters run it by implementing {@link AdapterHarness} over their public surface and
 * calling {@link runBehavioralSuite} with their test framework's describe/it/expect
 * (vitest-compatible shapes). Exported via `@chestnutlabs/gcode-preview-core/testing`.
 */
import {
  MoveKind,
  ToolpathIRBuilder,
  type MachineGeometry,
  type MappedProgress,
  type ProgressObservation,
  type ToolpathIR
} from '@chestnutlabs/toolpath-core';
import type { GLRendererLike } from '@chestnutlabs/gcode-renderer-three';
import type { GcodePreviewControls, GcodePreviewState, PreviewEvent } from './controller.js';

/** 2 layers × 6 extrude segments; srcByte = i*10; source byteLength 1000. */
export function makeTestIR(): ToolpathIR {
  const b = new ToolpathIRBuilder({
    parserVersion: 'behavioral-suite',
    units: 'mm',
    unitsSource: 'known',
    source: { byteLength: 1_000 }
  });
  let src = 0;
  for (let l = 0; l < 2; l++) {
    for (let s = 0; s < 6; s++) {
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

export const TEST_MACHINE: MachineGeometry = {
  bed: { kind: 'rect', min: { x: 0, y: 0 }, max: { x: 256, y: 256 } },
  heightMm: 256,
  origin: { x: 0, y: 0 },
  confidence: 'known',
  source: { adapterId: 'behavioral-suite', evidence: 'stub' }
};

/** Protocol-v1-shaped stub worker: parse → done, cancel → cancelled. Counts lifecycles. */
export class SuiteStubWorker {
  static created = 0;
  static terminated = 0;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  constructor(private readonly machine?: MachineGeometry) {
    SuiteStubWorker.created++;
  }
  postMessage(msg: { type: string; id: number }): void {
    if (msg.type === 'parse') {
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            v: 1,
            type: 'done',
            id: msg.id,
            ir: makeTestIR(),
            stats: { bytes: 1_000, wallMs: 1 },
            metadata: this.machine === undefined ? undefined : { machine: this.machine }
          }
        });
      });
    } else if (msg.type === 'cancel') {
      queueMicrotask(() => this.onmessage?.({ data: { v: 1, type: 'cancelled', id: msg.id } }));
    }
  }
  terminate(): void {
    SuiteStubWorker.terminated++;
  }
}

export function makeSuiteStubGL(canvas: HTMLCanvasElement): GLRendererLike {
  return { render: () => undefined, setSize: () => undefined, dispose: () => undefined, domElement: canvas };
}

/** What every adapter must expose to the suite — its PUBLIC surface, uniformly shaped. */
export interface AdapterHarness {
  /** Construct one preview bound to a fresh canvas, wired to a SuiteStubWorker + stub GL. */
  create(opts?: { machine?: MachineGeometry; consumerVolume?: boolean }): Promise<AdapterInstance> | AdapterInstance;
}

export interface AdapterInstance {
  parse(bytes: Uint8Array): Promise<unknown>;
  getState(): GcodePreviewState;
  controls: GcodePreviewControls;
  observeProgress(obs: ProgressObservation): MappedProgress | null;
  clearProgress(): void;
  onEvent(cb: (e: PreviewEvent) => void): () => void;
  /** Chunk draw-range probe (renderer-level effect check). */
  firstChunkDrawCount(): number;
  dispose(): Promise<void> | void;
  /** Let microtask round-trips + framework effects settle. */
  settle(): Promise<void>;
}

/** The subset of matchers the parity suite uses — structurally satisfied by any vitest/jest `expect`. */
interface Matchers {
  toBe(v: unknown): void;
  toBeNull(): void;
  toMatchObject(v: object): void;
  toBeGreaterThan(v: number): void;
  toBeLessThan(v: number): void;
  toBeCloseTo(v: number, numDigits?: number): void;
}

interface TestApi {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => Promise<void> | void) => void;
  expect: (actual: unknown) => Matchers & { not: Matchers };
}

/** The parity contract every adapter must pass (DD-007 §4.6 amendment). */
export function runBehavioralSuite(name: string, api: TestApi, harness: AdapterHarness): void {
  const { describe, it, expect } = api;
  describe(`behavioral suite — ${name}`, () => {
    it('parses and reports the standard state summary', async () => {
      const a = await harness.create();
      await a.parse(new Uint8Array(1_000));
      await a.settle();
      expect(a.getState().summary).toMatchObject({ segments: 12, layers: 2, complete: true });
      expect(a.getState().segmentCount).toBe(12);
      await a.dispose();
    });

    it('controls reach the renderer: scrub cuts and restores draw ranges', async () => {
      const a = await harness.create();
      await a.parse(new Uint8Array(1_000));
      await a.settle();
      expect(a.firstChunkDrawCount()).toBe(24);
      a.controls.setScrubPosition(5);
      await a.settle();
      expect(a.firstChunkDrawCount()).toBe(12);
      a.controls.setScrubPosition(null);
      await a.settle();
      expect(a.firstChunkDrawCount()).toBe(24);
      await a.dispose();
    });

    it('camera preset views + state round-trip reach the renderer (#268)', async () => {
      const a = await harness.create();
      await a.parse(new Uint8Array(1_000));
      await a.settle();

      const initial = a.controls.getCameraState();
      expect(initial).not.toBeNull();
      expect(initial!.cameraMode).toBe('perspective');

      // A preset snaps deterministically and preserves the projection. 'top' looks straight down
      // scene +Y, so the camera sits above the target on Y and level in X/Z.
      a.controls.setView('top');
      await a.settle();
      const top = a.controls.getCameraState()!;
      expect(top.cameraMode).toBe('perspective');
      expect(top.position.y).toBeGreaterThan(top.target.y);
      expect(Math.abs(top.position.x - top.target.x)).toBeLessThan(1e-3);
      expect(Math.abs(top.position.z - top.target.z)).toBeLessThan(1e-3);

      // getCameraState → setCameraState restores the same view even after moving away.
      const saved = a.controls.getCameraState()!;
      a.controls.setView('front');
      await a.settle();
      a.controls.setCameraState(saved);
      await a.settle();
      const restored = a.controls.getCameraState()!;
      expect(restored.position.x).toBeCloseTo(saved.position.x, 3);
      expect(restored.position.y).toBeCloseTo(saved.position.y, 3);
      expect(restored.position.z).toBeCloseTo(saved.position.z, 3);
      expect(restored.target.x).toBeCloseTo(saved.target.x, 3);
      expect(restored.target.y).toBeCloseTo(saved.target.y, 3);
      expect(restored.target.z).toBeCloseTo(saved.target.z, 3);
      expect(restored.cameraMode).toBe(saved.cameraMode);

      await a.dispose();
    });

    it('drives the DD-006 progress chain honestly (exact → cleared)', async () => {
      const a = await harness.create();
      await a.parse(new Uint8Array(1_000));
      await a.settle();
      const mapped = a.observeProgress({ v: 1, timestampMs: 1_000, position: { byte: 55 } });
      await a.settle();
      expect(mapped).toMatchObject({ basis: 'byte', confidence: 'known', segIndex: 5 });
      expect(a.getState().presentation).toBe('exact');
      a.clearProgress();
      await a.settle();
      expect(a.getState().presentation).toBe('hidden');
      await a.dispose();
    });

    it('progress is unavailable before a parse (no fabricated mapping)', async () => {
      const a = await harness.create();
      expect(a.observeProgress({ v: 1, timestampMs: 1, position: { percent: 0.5 } })).toBeNull();
      await a.dispose();
    });

    it('honors DD-005 bed precedence: consumer volume blocks auto-apply, discovery is evented', async () => {
      const a = await harness.create({ machine: TEST_MACHINE, consumerVolume: true });
      const events: PreviewEvent[] = [];
      a.onEvent((e) => events.push(e));
      await a.parse(new Uint8Array(1_000));
      await a.settle();
      expect(events.filter((e) => e.type === 'machine-geometry-discovered').length).toBe(1);
      await a.dispose();
    });

    it('disposes cleanly: 10 lifecycles leak no workers', async () => {
      const created0 = SuiteStubWorker.created;
      const terminated0 = SuiteStubWorker.terminated;
      for (let i = 0; i < 10; i++) {
        const a = await harness.create();
        await a.parse(new Uint8Array(8));
        await a.settle();
        await a.dispose();
      }
      expect(SuiteStubWorker.created - created0).toBe(10);
      expect(SuiteStubWorker.terminated - terminated0).toBe(10);
    });
  });
}
