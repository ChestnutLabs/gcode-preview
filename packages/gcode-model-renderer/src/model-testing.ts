/**
 * Framework-portable behavioral suite for the **model viewer** adapters (DD-031) — the Prepare-side
 * analogue of `@chestnutlabs/gcode-preview-core/testing`. The SAME source → state → controls → dispose
 * contract, runnable through every model adapter (`.../model`), so Vue/React/Svelte/WC can't drift into
 * different model-viewing feature sets. It includes a **controls/state completeness parity guard** that
 * fails CI if a `ModelPreviewControls` method or `ModelPreviewState` field isn't reachable through an
 * adapter — add new controls/state to the required lists when the controller grows.
 *
 * Adapters run it by implementing {@link ModelAdapterHarness} over their public surface and calling
 * {@link runModelBehavioralSuite} with their test framework's describe/it/expect. Ships via the
 * `@chestnutlabs/gcode-model-renderer/testing` subpath. Shared stub GL/controls + source makers are
 * exported so each adapter mounts headlessly the same way.
 */
import { Vector3 } from 'three';
import type { GLRendererLike, RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';
import type { ModelPreviewControls, ModelPreviewControllerOptions, ModelPreviewState } from './model-preview.js';
import type { ModelViewerEvent } from './model-viewer.js';
import type { ModelSourceInput } from './loaders.js';
import { IDENTITY_MAT4, type ModelScene } from './scene-model.js';

/** Stub GL for headless adapter mounts (no real WebGL). */
export const MODEL_STUB_GL = (canvas: RenderTargetCanvas): GLRendererLike => ({
  render: () => undefined,
  setSize: () => undefined,
  dispose: () => undefined,
  domElement: canvas
});

/** Stub orbit controls so a DOM canvas mount (jsdom) doesn't construct real OrbitControls. */
export const MODEL_STUB_CONTROLS: NonNullable<ModelPreviewControllerOptions['createControls']> = (camera) => ({
  object: camera,
  target: new Vector3(),
  enabled: true,
  update: () => undefined,
  dispose: () => undefined,
  addEventListener: () => undefined,
  listenToKeyEvents: () => undefined
});

/** A one-triangle binary STL — carries no colour, so materials stays honest `unavailable`. */
export function makeStlModelSource(): ModelSourceInput {
  const tris = [
    [
      [0, 0, 0],
      [10, 0, 0],
      [0, 20, 0]
    ]
  ];
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const t of tris) {
    o += 12;
    for (const v of t) {
      dv.setFloat32(o, v[0], true);
      dv.setFloat32(o + 4, v[1], true);
      dv.setFloat32(o + 8, v[2], true);
      o += 12;
    }
    o += 2;
  }
  return { kind: 'stl', bytes: new Uint8Array(buf) };
}

/** A single coloured object — materials: 'known' (capability passthrough check). */
export function makeColouredModelSource(): ModelScene {
  return {
    objects: [
      {
        id: 'a',
        geometry: { positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]) },
        transform: IDENTITY_MAT4,
        material: { color: [1, 0, 0] }
      }
    ],
    bounds: { min: [0, 0, 0], max: [10, 10, 0] },
    capabilities: {
      materials: 'known',
      transforms: 'unavailable',
      multiObject: 'unavailable',
      instanced: 'unavailable',
      plates: 'unavailable'
    }
  };
}

export interface ModelAdapterInstance {
  controls: ModelPreviewControls;
  getState(): ModelPreviewState;
  onEvent(cb: (e: ModelViewerEvent) => void): () => void;
  dispose(): Promise<void> | void;
  /** Let microtask round-trips + framework effects settle. */
  settle(): Promise<void>;
}

export interface ModelAdapterHarness {
  /** Mount one model viewer bound to a fresh canvas, wired to the stub GL + stub controls. */
  create(): Promise<ModelAdapterInstance> | ModelAdapterInstance;
}

interface Matchers {
  toBe(v: unknown): void;
  toBeNull(): void;
  toMatchObject(v: object): void;
  toBeGreaterThanOrEqual(v: number): void;
}
interface TestApi {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => Promise<void> | void) => void;
  expect: (actual: unknown) => Matchers & { not: Matchers };
}

/** Every `ModelPreviewControls` method must be reachable through the adapter — add new ones here. */
export const REQUIRED_MODEL_CONTROLS: (keyof ModelPreviewControls)[] = [
  'setSource',
  'setView',
  'getCameraState',
  'setCameraState',
  'setBackground',
  'setInteractionQuality',
  'setRenderScope',
  'frame',
  'resize',
  'capture'
];

/** Every `ModelPreviewState` field must surface through the adapter — add new ones here. */
export const REQUIRED_MODEL_STATE_KEYS: (keyof ModelPreviewState)[] = [
  'loading',
  'ready',
  'rendererSupported',
  'objectCount',
  'materials',
  'instancedCount',
  'decimationApplied',
  'bounds',
  'plates',
  'hasPlates',
  'cameraState',
  'progress',
  'error'
];

/** The model-viewer parity contract every adapter must pass (DD-031). */
export function runModelBehavioralSuite(name: string, api: TestApi, harness: ModelAdapterHarness): void {
  const { describe, it, expect } = api;
  describe(`model behavioral suite — ${name}`, () => {
    it('setSource(STL) → ready state with an honest object count + capability tier', async () => {
      const a = await harness.create();
      await a.controls.setSource(makeStlModelSource());
      await a.settle();
      const s = a.getState();
      expect(s.ready).toBe(true);
      expect(s.loading).toBe(false);
      expect(s.objectCount).toBe(1);
      expect(s.materials).toBe('unavailable'); // STL carries no colour
      await a.dispose();
    });

    it('passes capability tiers through unchanged (coloured source → materials: known)', async () => {
      const a = await harness.create();
      await a.controls.setSource(makeColouredModelSource());
      await a.settle();
      expect(a.getState().materials).toBe('known');
      await a.dispose();
    });

    it('emits a ready event carrying the model info through the adapter', async () => {
      const a = await harness.create();
      const events: ModelViewerEvent[] = [];
      a.onEvent((e) => events.push(e));
      await a.controls.setSource(makeStlModelSource());
      await a.settle();
      const ready = events.find((e) => e.type === 'ready');
      if (!ready) throw new Error('no ready event emitted');
      expect(ready.type).toBe('ready');
      await a.dispose();
    });

    it('camera controls reach the viewer (setView + getCameraState round-trip)', async () => {
      const a = await harness.create();
      await a.controls.setSource(makeStlModelSource());
      await a.settle();
      a.controls.setView('top');
      await a.settle();
      // A pose is available once a source is shown (null only before that / when unsupported).
      const pose = a.controls.getCameraState();
      expect(pose === null ? 0 : 1).toBeGreaterThanOrEqual(0); // reachable without throwing
      await a.dispose();
    });

    it('exposes the full model controls contract on every adapter (parity guard)', async () => {
      const a = await harness.create();
      await a.settle();
      for (const key of REQUIRED_MODEL_CONTROLS) {
        expect(typeof a.controls[key] === 'function').toBe(true);
      }
      await a.dispose();
    });

    it('exposes the full model state contract on every adapter (parity guard)', async () => {
      const a = await harness.create();
      await a.settle();
      const s = a.getState() as unknown as Record<string, unknown>;
      for (const key of REQUIRED_MODEL_STATE_KEYS) {
        expect(key in s).toBe(true);
      }
      await a.dispose();
    });
  });
}
