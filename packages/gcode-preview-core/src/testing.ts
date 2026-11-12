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
import type { ColorMode, GLRendererLike } from '@chestnutlabs/gcode-renderer-three';
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

/**
 * {@link makeTestIR}'s 12 extrusion segments plus one travel, with non-finite coordinates (#518), for
 * the renderers' skip-and-disclose path. Three segments have a non-finite x/y (layer 0 extrusion 1 with
 * `x1: Infinity`, the travel with `y0: NaN`, layer 1 extrusion 2 with `x0: -Infinity`), so both renderers
 * skip them. A fourth (layer 1 extrusion 4) has only `z1: Infinity`: the flat 2D view still draws it,
 * the 3D renderer skips it. So 2D draws 10 of 13 and skips 3; 3D builds 9 and skips 4.
 */
export function makeNonFiniteTestIR(): ToolpathIR {
  const b = new ToolpathIRBuilder({
    parserVersion: 'behavioral-suite',
    units: 'mm',
    unitsSource: 'known',
    source: { byteLength: 1_000 }
  });
  let src = 0;
  for (let l = 0; l < 2; l++) {
    const z = 0.2 * (l + 1);
    for (let s = 0; s < 6; s++) {
      b.addSegment({
        x0: l === 1 && s === 2 ? -Infinity : 100 + s,
        y0: 100,
        z0: z,
        x1: l === 0 && s === 1 ? Infinity : 101 + s,
        y1: 100,
        z1: l === 1 && s === 4 ? Infinity : z,
        e: 1,
        kind: MoveKind.Extrude,
        layer: l,
        srcByte: src++ * 10
      });
    }
    if (l === 0) {
      b.addSegment({
        x0: 106,
        y0: Number.NaN,
        z0: z,
        x1: 100,
        y1: 110,
        z1: z,
        e: 0,
        kind: MoveKind.Travel,
        layer: 0,
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
  /** `ir` overrides the IR every parse returns (default {@link makeTestIR}). */
  constructor(
    private readonly machine?: MachineGeometry,
    private readonly ir?: () => ToolpathIR
  ) {
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
            ir: this.ir === undefined ? makeTestIR() : this.ir(),
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

/** A recording Canvas 2D context for the 2D cases; see {@link installSuite2DProbe}. */
export interface Suite2DProbe {
  /** `stroke()` calls since the last `clearRect()`: one per segment the last 2D frame drew. */
  strokes(): number;
  /** True once any canvas asked for a `'2d'` context, i.e. a 2D renderer is bound. */
  used(): boolean;
  /** Put the original `HTMLCanvasElement.prototype.getContext` back. */
  restore(): void;
}

/**
 * Route every canvas's `getContext('2d')` to one recording context until `restore()`. DOM shims such as
 * happy-dom have no Canvas 2D, and the 2D renderer draws nothing without one, so the 2D cases count strokes
 * here. It patches the prototype because some adapters (the custom element) create their canvas themselves.
 */
export function installSuite2DProbe(): Suite2DProbe {
  const proto = HTMLCanvasElement.prototype;
  const original = proto.getContext;
  let strokes = 0;
  let used = false;
  const ctx = {
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => {
      strokes++;
    },
    clearRect: () => {
      strokes = 0;
    }
  };
  proto.getContext = function (this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
    if (id !== '2d') return (original as (...a: unknown[]) => unknown).call(this, id, ...rest);
    used = true;
    return ctx;
  } as unknown as typeof proto.getContext;
  return {
    strokes: () => strokes,
    used: () => used,
    restore: () => {
      proto.getContext = original;
    }
  };
}

/**
 * Exhaustive by construction, like {@link REQUIRED_STATE_KEYS}: adding a `GcodePreviewControls`
 * method without listing it here fails the type check.
 */
const CONTROL_KEYS: Record<keyof GcodePreviewControls, true> = {
  setLayerRange: true,
  setScrubPosition: true,
  setScrubTime: true,
  setKindVisible: true,
  setFeatureRoleVisible: true,
  setShowRetractions: true,
  setColorMode: true,
  isColorModeAvailable: true,
  setQuality: true,
  setQualityMode: true,
  setProgressivePreview: true,
  setCameraMode: true,
  setCameraFov: true,
  setPixelRatio: true,
  setView: true,
  getCameraState: true,
  setCameraState: true,
  setTheme: true,
  setBuildVolume: true,
  setBuildVolumeCage: true,
  setFrameContent: true,
  setInteractionQuality: true,
  frame: true,
  capture: true,
  getRenderStats: true,
  pickSegment: true
};

/** Every `GcodePreviewControls` method must be callable through the adapter (parity guard). */
export const REQUIRED_CONTROLS: (keyof GcodePreviewControls)[] = Object.keys(
  CONTROL_KEYS
) as (keyof GcodePreviewControls)[];

/**
 * Exhaustive by construction: a `Record` over every `GcodePreviewState` key, so adding a state field
 * without listing it here fails the type check (and a stale key fails the excess-property check).
 */
const STATE_KEYS: Record<keyof GcodePreviewState, true> = {
  parsing: true,
  parseProgress: true,
  summary: true,
  metadata: true,
  activeQuality: true,
  presentation: true,
  layerCount: true,
  segmentCount: true,
  disclosure: true,
  totalTimeMs: true,
  timeEstimateSource: true,
  availableColorModes: true,
  hasRetractions: true,
  hasColorChanges: true,
  error: true
};

/** Every `GcodePreviewState` field must surface through the adapter (parity guard). */
export const REQUIRED_STATE_KEYS: (keyof GcodePreviewState)[] = Object.keys(STATE_KEYS) as (keyof GcodePreviewState)[];

/** What every adapter must expose to the suite — its PUBLIC surface, uniformly shaped. */
export interface AdapterHarness {
  /**
   * Construct one preview bound to a fresh canvas, wired to a SuiteStubWorker + stub GL. `renderer: '2d'`
   * selects the 2D renderer (the adapter's own renderer-mode option); omitted means the 3D default.
   */
  create(opts?: {
    machine?: MachineGeometry;
    consumerVolume?: boolean;
    renderer?: '2d';
  }): Promise<AdapterInstance> | AdapterInstance;
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

    it('the parse-complete (ready) event carries capabilities + warnings + metadata (#275/M3, #306/#4)', async () => {
      const a = await harness.create();
      const events: PreviewEvent[] = [];
      a.onEvent((e) => events.push(e));
      await a.parse(new Uint8Array(1_000));
      await a.settle();
      const done = events.find(
        (e): e is Extract<PreviewEvent, { type: 'parse-complete' }> => e.type === 'parse-complete'
      );
      if (!done) throw new Error('no parse-complete event emitted');
      // All surfaced on the event so a consumer builds its own capability/disclosure/slice-detail UI
      // without the raw handle. metadata is present but may be undefined (the file carried none).
      expect(typeof done.capabilities).toBe('object');
      expect(Array.isArray(done.warnings)).toBe(true);
      expect('metadata' in done).toBe(true);
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

    it('the camera lens reaches the renderer: dolly, no camera-changed, RangeError (DD-032)', async () => {
      const a = await harness.create();
      await a.parse(new Uint8Array(1_000));
      await a.settle();
      const types: string[] = [];
      a.onEvent((e) => types.push(e.type));
      const dist = (): number => {
        const s = a.controls.getCameraState()!;
        return Math.hypot(s.position.x - s.target.x, s.position.y - s.target.y, s.position.z - s.target.z);
      };
      const d50 = dist();
      a.controls.setCameraFov(32);
      await a.settle();
      // The target stays; the camera backs off by tan(25°)/tan(16°) so the framing is kept.
      expect(dist() / d50).toBeCloseTo(1.626208, 5);
      expect(types.includes('camera-changed')).toBe(false);
      let err: unknown = null;
      try {
        a.controls.setCameraFov(121);
      } catch (e) {
        err = e;
      }
      expect(err instanceof RangeError).toBe(true);
      expect(dist() / d50).toBeCloseTo(1.626208, 5);
      await a.dispose();
    });

    it('the pixel ratio: (0, 4] or exactly "device", RangeError otherwise, before and after a load', async () => {
      const a = await harness.create();
      const errorName = (v: unknown): string => {
        try {
          a.controls.setPixelRatio(v as number);
          return 'none';
        } catch (e) {
          return (e as Error).name;
        }
      };
      // Before the renderer is ready: validated synchronously, never clamped.
      expect(errorName(0)).toBe('RangeError');
      expect(errorName(4.0001)).toBe('RangeError');
      expect(errorName('Device')).toBe('RangeError');
      expect(errorName(4)).toBe('none');
      await a.parse(new Uint8Array(1_000));
      await a.settle();
      expect(errorName(-1)).toBe('RangeError');
      expect(errorName(' device')).toBe('RangeError');
      expect(errorName('device')).toBe('none');
      expect(errorName(1.5)).toBe('none');
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

    it('layer range clips and restores draw ranges (DD-031 parity)', async () => {
      const a = await harness.create();
      await a.parse(new Uint8Array(1_000));
      await a.settle();
      // Test IR is 2 layers × 6 extrude segments (24 draw verts). Clipping to layer 0 leaves 12.
      expect(a.firstChunkDrawCount()).toBe(24);
      a.controls.setLayerRange(0, 0);
      await a.settle();
      expect(a.firstChunkDrawCount()).toBe(12);
      a.controls.setLayerRange(0, Number.POSITIVE_INFINITY);
      await a.settle();
      expect(a.firstChunkDrawCount()).toBe(24);
      await a.dispose();
    });

    it('2D: layer range shows the top requested layer, and "show all" (Infinity) restores it', async () => {
      const probe = installSuite2DProbe();
      try {
        const a = await harness.create({ renderer: '2d' });
        await a.parse(new Uint8Array(1_000));
        await a.settle();
        if (!probe.used()) throw new Error("harness.create must honour opts.renderer '2d' (no 2D renderer drew)");
        // Test IR: 2 layers × 6 extrusions. The 2D view draws the top layer of the range plus one ghost
        // layer beneath it, so layer 0 is 6 strokes and layer 1 is 12.
        const strokesAt = async (end: number): Promise<number> => {
          a.controls.setLayerRange(0, end);
          await a.settle();
          return probe.strokes();
        };
        expect(await strokesAt(0)).toBe(6);
        // Every framework adapter sends Infinity when its layerRange is cleared: the top layer, never blank.
        expect(await strokesAt(Number.POSITIVE_INFINITY)).toBe(12);
        expect(await strokesAt(0)).toBe(6);
        expect(await strokesAt(7)).toBe(12); // past the last layer: the top layer
        expect(await strokesAt(0.5)).toBe(6); // a fractional end is floored, like 3D
        expect(await strokesAt(1.5)).toBe(12);
        await a.dispose();
      } finally {
        probe.restore();
      }
    });

    it('color-mode gating is honest and reachable through controls (DD-031 G6)', async () => {
      const a = await harness.create();
      await a.parse(new Uint8Array(1_000));
      await a.settle();
      // The test IR carries no feature roles → feature coloring is unavailable (never fabricated),
      // while single/tool/moveKind are always available.
      expect(a.controls.isColorModeAvailable('single')).toBe(true);
      expect(a.controls.isColorModeAvailable('moveKind')).toBe(true);
      expect(a.controls.isColorModeAvailable('feature')).toBe(false);
      // setColorMode reports the same gate: single applies (true), gated feature is refused (false).
      expect(a.controls.setColorMode({ mode: 'single', color: [1, 1, 1] } as ColorMode)).toBe(true);
      expect(
        a.controls.setColorMode({ mode: 'feature', palette: [[1, 0, 0]], fallback: [0.5, 0.5, 0.5] } as ColorMode)
      ).toBe(false);
      // The capability-aware state list mirrors the gates for capability-driven UI.
      const modes = a.getState().availableColorModes;
      expect(modes.includes('single')).toBe(true);
      expect(modes.includes('tool')).toBe(true);
      expect(modes.includes('moveKind')).toBe(true);
      expect(modes.includes('feature')).toBe(false);
      // Retraction/color-change presence are booleans a UI can gate on (this IR has neither).
      expect(a.getState().hasRetractions).toBe(false);
      expect(a.getState().hasColorChanges).toBe(false);
      await a.dispose();
    });

    it('render diagnostics + segment picking are reachable through controls, not raw-only (DD-031 G1/G2)', async () => {
      const a = await harness.create();
      await a.parse(new Uint8Array(1_000));
      await a.settle();
      // Reachable through the public controls surface (no raw.renderer()). Honest shapes: a RenderStats
      // object or null; a segment index or null — never a throw, never fabricated.
      const stats = a.controls.getRenderStats();
      expect(stats === null || typeof stats === 'object').toBe(true);
      const hit = a.controls.pickSegment(0, 0);
      expect(hit === null || typeof hit === 'number').toBe(true);
      await a.dispose();
    });

    it('exposes the full controls contract on every adapter (DD-031 parity guard)', async () => {
      const a = await harness.create();
      await a.parse(new Uint8Array(1_000));
      await a.settle();
      // A capability that ships in core must not silently vanish from an adapter: assert each
      // GcodePreviewControls method is callable here (the list is exhaustive by construction).
      expect(REQUIRED_CONTROLS.filter((k) => typeof a.controls[k] !== 'function').join(',')).toBe('');
      await a.dispose();
    });

    it('exposes the full state contract on every adapter (parity guard)', async () => {
      const a = await harness.create();
      await a.parse(new Uint8Array(1_000));
      await a.settle();
      // `in`, not a truthiness check: `metadata` is legitimately undefined but the key must be present.
      const s = a.getState() as unknown as Record<string, unknown>;
      expect(REQUIRED_STATE_KEYS.filter((k) => !(k in s)).join(',')).toBe('');
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

/**
 * What every adapter's COMPONENT must expose to {@link runComponentConformanceSuite} (#502).
 * The behavioral suite drives hooks/controllers; this one mounts the component itself, so
 * event → callback wiring (props, emits, dispatched/DOM events) is covered on every adapter.
 */
export interface ComponentHarness {
  /**
   * Mount the adapter's component, wired to a SuiteStubWorker + stub GL, with these callbacks bound in its
   * own idiom. `opts.renderer` is the component's renderer prop/attribute (omitted = the 3D default), and
   * `opts.ir` is passed to the SuiteStubWorker as the IR each parse returns.
   */
  mount(
    callbacks: {
      /** The component's parse-complete callback (`onReady` / `ready`), with its `segments`. */
      onReady: (segments: number) => void;
      onBuildComplete: (segments: number) => void;
      onDisclosure: (text: string) => void;
      /**
       * The component's renderer-unsupported callback/event (#520), with its `feature` and `message`. Optional
       * so existing harnesses keep compiling; the #520 cases fail with an explicit message without it.
       */
      onRendererUnsupported?: (feature: string, message: string) => void;
    },
    opts?: ComponentMountOptions
  ): Promise<MountedComponent> | MountedComponent;
}

/**
 * What a {@link ComponentHarness} mount configures beyond the callbacks (#518). Every mount also sets the
 * component's quality to `'lines'` (the stub GL has no tube path); the #520 cases expect that.
 */
export interface ComponentMountOptions {
  renderer?: '2d';
  ir?: () => ToolpathIR;
  /** The component's lens prop/attribute at mount (#520). */
  cameraFov?: number;
  /** The component's pixel-ratio prop/attribute at mount (#520). */
  pixelRatio?: number;
}

export interface MountedComponent {
  /**
   * Emit a `buildComplete` from the component's bound renderer (`raw.renderer().emit(...)`), inside the
   * framework's update scope. This is the decimation seam: real decimation needs over 2M segments, and the
   * controller derives its disclosure from the event's `decimationApplied`.
   */
  emitBuild(decimationApplied: number, segments: number): Promise<void> | void;
  /** Parse through the component's own preview handle (`parse(bytes)`), inside the framework's update scope. */
  parse(bytes: Uint8Array): Promise<unknown>;
  /**
   * Call `controls.setCameraMode(mode)` on the component's own preview handle, inside the framework's update
   * scope (#520). Optional like `onRendererUnsupported`.
   */
  setCameraMode?(mode: 'perspective' | 'orthographic'): Promise<void> | void;
  /** Let microtask round-trips + framework effects settle. */
  settle(): Promise<void>;
  unmount(): Promise<void> | void;
}

/** Emit `buildComplete` from a bound renderer; for {@link MountedComponent.emitBuild} implementations. */
export function emitSuiteBuild(renderer: unknown, decimationApplied: number, segments: number): void {
  if (renderer === null || renderer === undefined) throw new Error('emitSuiteBuild: renderer not bound');
  (renderer as { emit(e: unknown): void }).emit({
    type: 'buildComplete',
    segments,
    decimationApplied,
    travelHidden: true,
    quality: 'lines'
  });
}

/** Component-level callback conformance every adapter must pass (#502). */
export function runComponentConformanceSuite(name: string, api: TestApi, harness: ComponentHarness): void {
  const { describe, it, expect } = api;
  describe(`component conformance — ${name}`, () => {
    it('the disclosure callback reports the CURRENT build, after build-complete (#430)', async () => {
      const log: string[] = [];
      const m = await harness.mount({
        onReady: (segments) => log.push(`ready ${segments}`),
        onBuildComplete: (segments) => log.push(`build ${segments}`),
        onDisclosure: (text) => log.push(`disclosure ${text}`)
      });
      await m.settle();
      expect(JSON.stringify(log)).toBe('[]');

      // First build: the new text, not ''.
      await m.emitBuild(3, 9);
      await m.settle();
      expect(JSON.stringify(log)).toBe(
        JSON.stringify([
          'build 9',
          'disclosure Showing every 3rd extrusion segment (layer boundaries kept); travel hidden. 9 segments drawn.'
        ])
      );

      // Next build with a different disclosure: the new text, not the previous build's.
      await m.emitBuild(2, 7);
      await m.settle();
      expect(JSON.stringify(log.slice(2))).toBe(
        JSON.stringify([
          'build 7',
          'disclosure Showing every 2nd extrusion segment (layer boundaries kept); travel hidden. 7 segments drawn.'
        ])
      );

      // An undecimated build clears it, again without lagging a build behind.
      await m.emitBuild(1, 12);
      await m.settle();
      expect(JSON.stringify(log.slice(4))).toBe(JSON.stringify(['build 12', 'disclosure ']));

      await m.unmount();
    });

    it('2D: one build-complete per parse, and the disclosure names the non-finite count (#518)', async () => {
      const log: string[] = [];
      const m = await harness.mount(
        {
          onReady: (segments) => log.push(`ready ${segments}`),
          onBuildComplete: (segments) => log.push(`build ${segments}`),
          onDisclosure: (text) => log.push(`disclosure ${text}`)
        },
        { renderer: '2d', ir: makeNonFiniteTestIR }
      );
      await m.settle();
      expect(JSON.stringify(log)).toBe('[]');
      // ready (parse-complete) first, then build-complete, as in 3D: a build-complete handler sees the new file.
      const expected = JSON.stringify([
        'ready 13',
        'build 10',
        'disclosure 3 segments with a non-finite coordinate were not drawn.'
      ]);

      await m.parse(new Uint8Array(1_000));
      await m.settle();
      expect(JSON.stringify(log)).toBe(expected);

      // A second parse is a second setIR: exactly one more build, not zero and not two.
      await m.parse(new Uint8Array(1_000));
      await m.settle();
      expect(JSON.stringify(log.slice(3))).toBe(expected);

      await m.unmount();
    });

    it('3D: the disclosure names the non-finite count, z included (#518)', async () => {
      const log: string[] = [];
      const m = await harness.mount(
        {
          onReady: (segments) => log.push(`ready ${segments}`),
          onBuildComplete: (segments) => log.push(`build ${segments}`),
          onDisclosure: (text) => log.push(`disclosure ${text}`)
        },
        { ir: makeNonFiniteTestIR }
      );
      await m.settle();
      await m.parse(new Uint8Array(1_000));
      await m.settle();
      // The order is not pinned here: harnesses pass a synchronous scheduleFrame, so the stubbed 3D build
      // completes inside setIR, before parse-complete. In production it runs on later frames, after it.
      expect(JSON.stringify(log.filter((l) => !l.startsWith('ready ')))).toBe(
        JSON.stringify(['build 9', 'disclosure 4 segments with a non-finite coordinate were not drawn.'])
      );
      expect(JSON.stringify(log.filter((l) => l.startsWith('ready ')))).toBe('["ready 13"]');
      await m.unmount();
    });

    it('2D: 3D-only settings at mount each report renderer-unsupported once; 3D reports none (#520)', async () => {
      const log: string[] = [];
      const callbacks = {
        onReady: (segments: number) => log.push(`ready ${segments}`),
        onBuildComplete: (segments: number) => log.push(`build ${segments}`),
        onDisclosure: (text: string) => log.push(`disclosure ${text}`),
        onRendererUnsupported: (feature: string, message: string) => log.push(`unsupported ${feature} ${message}`)
      };
      const m2d = await harness.mount(callbacks, { renderer: '2d', cameraFov: 32, pixelRatio: 2 });
      await m2d.settle();
      requireUnsupportedWired(log);
      expect(JSON.stringify(log)).toBe(
        JSON.stringify([
          'unsupported quality Quality/geometry modes apply only to the 3D renderer; the 2D view has none.',
          'unsupported camera The camera lens applies only to the 3D renderer; the 2D view is flat top-down.',
          'unsupported quality The pixel ratio applies only to the 3D renderer; the 2D view keeps its own resolution.'
        ])
      );
      await m2d.unmount();

      log.length = 0;
      const m3d = await harness.mount(callbacks, { cameraFov: 32, pixelRatio: 2 });
      await m3d.settle();
      expect(JSON.stringify(log)).toBe('[]');
      // One parse, one build: the mount pass re-applied nothing to 3D (a re-applied quality rebuilds).
      await m3d.parse(new Uint8Array(1_000));
      await m3d.settle();
      expect(JSON.stringify(log.filter((l) => !l.startsWith('ready ')))).toBe('["build 12","disclosure "]');
      await m3d.unmount();
    });

    it('2D: a control call after mount reports renderer-unsupported once per call, with no dedupe (#520)', async () => {
      const log: string[] = [];
      const m = await harness.mount(
        {
          onReady: () => undefined,
          onBuildComplete: () => undefined,
          onDisclosure: () => undefined,
          onRendererUnsupported: (feature, message) => log.push(`unsupported ${feature} ${message}`)
        },
        { renderer: '2d' }
      );
      await m.settle();
      requireUnsupportedWired(log);
      log.length = 0; // the harness's mount-time quality notice is covered above
      if (m.setCameraMode === undefined) throw new Error('harness must implement setCameraMode (#520)');
      const line =
        'unsupported camera Camera projection applies only to the 3D renderer; the 2D view is flat top-down.';
      await m.setCameraMode('orthographic');
      await m.settle();
      expect(JSON.stringify(log)).toBe(JSON.stringify([line]));
      // The same request again is a second request: a second event, not deduplicated.
      await m.setCameraMode('orthographic');
      await m.settle();
      expect(JSON.stringify(log)).toBe(JSON.stringify([line, line]));
      await m.unmount();
    });
  });
}

/** The #520 cases need the optional callback wired; a harness without it fails with this, not a bare diff. */
function requireUnsupportedWired(log: readonly string[]): void {
  if (!log.some((l) => l.startsWith('unsupported '))) {
    throw new Error(
      'harness must implement onRendererUnsupported (#520): no renderer-unsupported reached it from a 2D mount'
    );
  }
}
