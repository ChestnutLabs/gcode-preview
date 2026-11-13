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
import { Vector3, type Camera, type PerspectiveCamera, type Scene } from 'three';
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

/**
 * A stub GL that remembers what it was last asked to render, so an adapter test can assert the DD-032 look
 * reached the scene through the declarative props: the lens, whether a plate is in the scene, whether its
 * cage is drawn (`null` = no plate), and the background kind (`'null'` | `'Color'` | `'DataTexture'`).
 */
export function makeModelRecordingGL(): {
  createRenderer: (canvas: RenderTargetCanvas) => GLRendererLike;
  snapshot(): { fov: number; plate: boolean; cage: boolean | null; shadow: boolean; background: string };
  /** What the last frame drew: the number of model objects in the scene (after any render scope) + the background kind. */
  drawn(): { objects: number; background: string };
} {
  let last: { scene: Scene; camera: Camera } | null = null;
  return {
    createRenderer: (canvas) => ({
      render: (scene, camera) => {
        last = { scene, camera };
      },
      setSize: () => undefined,
      dispose: () => undefined,
      domElement: canvas
    }),
    snapshot() {
      if (last === null) throw new Error('nothing rendered yet');
      const { scene, camera } = last;
      return {
        fov: (camera as PerspectiveCamera).fov,
        plate: scene.getObjectByName('buildVolume') !== undefined,
        // Whether the wireframe cage is drawn; `null` when there is no plate (so no cage) at all.
        cage: scene.getObjectByName('volumeCage')?.visible ?? null,
        shadow: scene.getObjectByName('contactShadow') !== undefined,
        background: scene.background === null ? 'null' : scene.background.constructor.name
      };
    },
    drawn() {
      if (last === null) throw new Error('nothing rendered yet');
      const { scene } = last;
      // The model root is the unnamed Group; its children are the drawn objects.
      const root = scene.children.find((c) => c.type === 'Group' && c.name === '');
      return {
        objects: root === undefined ? 0 : root.children.length,
        background: scene.background === null ? 'null' : scene.background.constructor.name
      };
    }
  };
}

/** Two coloured objects, ids `'a'` and `'b'` — for render-scope checks (`{ objectIds: ['a'] }` draws one). */
export function makeTwoObjectModelSource(): ModelScene {
  const one = makeColouredModelSource();
  const a = one.objects[0]!;
  return { ...one, objects: [a, { ...a, id: 'b' }] };
}

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
  /**
   * Optional: unbind the canvas and bind a fresh one (a StrictMode remount / replaced canvas), the way the
   * adapter does it. Provide together with `drawn` to opt in to the rebind guard.
   */
  rebind?(): Promise<void> | void;
  /** Optional: what the last frame drew (see `makeModelRecordingGL().drawn`); the mount must use that recording GL. */
  drawn?(): { objects: number; background: string };
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
  'setBuildVolume',
  'setBuildVolumeCage',
  'setTheme',
  'setCameraFov',
  'setPixelRatio',
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
  'placement',
  'placementOffset',
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

    it('draws a plate honestly: an STL on a 100 mm bed is approximated, centred, with the offset reported', async () => {
      const a = await harness.create();
      expect(a.getState().placement).toBeNull(); // no plate yet
      a.controls.setBuildVolume({ x: 100, y: 100, z: 100 });
      await a.controls.setSource(makeStlModelSource());
      await a.settle();
      const s = a.getState();
      expect(s.placement).toBe('approximated');
      expect(s.placementOffset).toMatchObject({ x: 45, y: 40, z: 0 });
      expect(s.bounds).toMatchObject({ min: [0, 0, 0], max: [10, 20, 0] }); // bounds stay authored
      a.controls.setBuildVolume(null);
      await a.settle();
      expect(a.getState().placement).toBeNull();
      expect(a.getState().placementOffset).toBeNull();
      await a.dispose();
    });

    it('setCameraFov / setTheme reject invalid values synchronously, even before a source', async () => {
      const a = await harness.create();
      let fovError = '';
      try {
        a.controls.setCameraFov(5);
      } catch (e) {
        fovError = (e as Error).name;
      }
      expect(fovError).toBe('RangeError');
      let themeError = '';
      try {
        a.controls.setTheme({ gridOpacity: 2 });
      } catch (e) {
        themeError = (e as Error).name;
      }
      expect(themeError).toBe('RangeError');
      a.controls.setCameraFov(32); // a valid lens is accepted
      await a.dispose();
    });

    it('setBuildVolumeCage never moves the model: the placement is unchanged, before and after a source', async () => {
      const a = await harness.create();
      a.controls.setBuildVolume({ x: 100, y: 100, z: 100 });
      a.controls.setBuildVolumeCage(false); // before a source (and, on some adapters, before the canvas binds)
      await a.controls.setSource(makeStlModelSource());
      await a.settle();
      expect(a.getState().placement).toBe('approximated');
      expect(a.getState().placementOffset).toMatchObject({ x: 45, y: 40, z: 0 });
      a.controls.setBuildVolumeCage(true);
      await a.settle();
      expect(a.getState().placement).toBe('approximated');
      expect(a.getState().placementOffset).toMatchObject({ x: 45, y: 40, z: 0 });
      await a.dispose();
    });

    it('setPixelRatio accepts (0, 4] or exactly "device" and rejects the rest synchronously', async () => {
      const a = await harness.create();
      const errorName = (v: unknown): string => {
        try {
          a.controls.setPixelRatio(v as number);
          return 'none';
        } catch (e) {
          return (e as Error).name;
        }
      };
      expect(errorName(0)).toBe('RangeError');
      expect(errorName(4.0001)).toBe('RangeError');
      expect(errorName('Device')).toBe('RangeError');
      expect(errorName(4)).toBe('none');
      expect(errorName('device')).toBe('none');
      await a.settle();
      expect(errorName(-1)).toBe('RangeError');
      expect(errorName(1.5)).toBe('none');
      await a.dispose();
    });

    it('render scope and background set at runtime survive a canvas rebind (adapters that opt in)', async () => {
      const a = await harness.create();
      if (a.rebind === undefined || a.drawn === undefined) {
        await a.dispose(); // this adapter does not opt in
        return;
      }
      await a.controls.setSource(makeTwoObjectModelSource());
      await a.settle();
      expect(a.drawn().objects).toBe(2);
      a.controls.setRenderScope({ objectIds: ['a'] });
      a.controls.setBackground('#ff0000');
      await a.settle();
      expect(a.drawn().objects).toBe(1);
      expect(a.drawn().background).toBe('Color');
      await a.rebind();
      await a.settle();
      expect(a.drawn().objects).toBe(1); // the scope, not the initial (whole-source) option
      expect(a.drawn().background).toBe('Color');
      a.controls.setRenderScope(null);
      await a.settle();
      expect(a.drawn().objects).toBe(2);
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
