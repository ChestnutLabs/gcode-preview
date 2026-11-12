// @vitest-environment happy-dom
/** Sweep survivors: scope bounds/validation messages, cache-key fragments, plate helpers, restore/setView re-fit. */
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene, Vector3, type OrthographicCamera } from 'three';
import { REVISION } from 'three';
import type { CameraState, ControlsLike, GLRendererLike, RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';
import { createModelViewer } from '../model-viewer.js';
import { renderModelStill } from '../render-model-still.js';
import { computeCacheKey, defaultEnvId } from '../cache-key.js';
import { ModelContent } from '../model-content.js';
import { ModelPlate, bedOf, isTransparentBackground } from '../model-plate.js';
import { applyRenderScope, checkRenderScope, IDENTITY_MAT4, type ModelScene } from '../scene-model.js';

const caps = {
  materials: 'unavailable',
  transforms: 'unavailable',
  multiObject: 'unavailable',
  instanced: 'unavailable',
  plates: 'unavailable'
} as const;
const scene = (over: Partial<ModelScene['objects'][number]> = {}, top: Partial<ModelScene> = {}): ModelScene => ({
  objects: [
    {
      id: 'a',
      geometry: { positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]) },
      transform: IDENTITY_MAT4,
      ...over
    }
  ],
  bounds: { min: [0, 0, 0], max: [10, 10, 0] },
  capabilities: { ...caps },
  ...top
});

describe('applyRenderScope / checkRenderScope', () => {
  it('an empty selector object names the rule in its message', () => {
    expect(() => checkRenderScope({} as never)).toThrow(/exactly one of objectIds, plateId, instanceFilter/);
    expect(() => checkRenderScope({ plateId: 1, objectIds: [] } as never)).toThrow(/exactly one of/);
  });

  it('a selector key present with an undefined value is not counted (scope built from optional fields)', () => {
    const byIds = applyRenderScope(scene(), { objectIds: ['a'], plateId: undefined } as never);
    expect(byIds.objects.map((o) => o.id)).toEqual(['a']);
    expect(byIds.bounds).toEqual({ min: [0, 0, 0], max: [10, 10, 0] });
    const byPlate = applyRenderScope(scene({ plateIds: [1] }), { plateId: 1, objectIds: undefined } as never);
    expect(byPlate.objects.map((o) => o.id)).toEqual(['a']);
    expect(byPlate.bounds).toEqual({ min: [0, 0, 0], max: [10, 10, 0] });
    const byFilter = applyRenderScope(scene({ plateIds: [1] }), {
      instanceFilter: () => true,
      objectIds: undefined,
      plateId: undefined
    } as never);
    expect(byFilter.objects.map((o) => o.id)).toEqual(['a']);
    const msg = 'renderScope must have exactly one of objectIds, plateId, instanceFilter';
    expect(() => checkRenderScope({ objectIds: undefined } as never)).toThrow(new RangeError(msg));
    expect(() => checkRenderScope({ objectIds: undefined, plateId: undefined } as never)).toThrow(new RangeError(msg));
  });

  it('a placement translation in z moves the bounds', () => {
    const t = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 7, 1];
    const s = applyRenderScope(scene({ transform: t }), { objectIds: ['a'] });
    expect(s.bounds).toEqual({ min: [0, 0, 7], max: [10, 10, 7] });
  });

  it('a trailing partial vertex does not count towards the bounds', () => {
    const s = applyRenderScope(
      scene({ geometry: { positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 99]) } }),
      {
        objectIds: ['a']
      }
    );
    expect(s.bounds).toEqual({ min: [0, 0, 0], max: [10, 10, 0] });
  });

  it('empty geometry under a dense transform still yields the empty box', () => {
    const dense = [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 1];
    const s = applyRenderScope(scene({ geometry: { positions: new Float32Array(0) }, transform: dense }), {
      objectIds: ['a']
    });
    expect(s.bounds).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
  });
});

const canvas = (): RenderTargetCanvas => ({ width: 8, height: 8 }) as unknown as RenderTargetCanvas;
const gl = (d: RenderTargetCanvas): GLRendererLike =>
  ({
    render: () => undefined,
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: d
  }) as unknown as GLRendererLike;
const still = (s: ModelScene | { kind: string; bytes: Uint8Array }, o: Record<string, unknown> = {}) =>
  renderModelStill(s as never, { canvas: canvas(), width: 8, height: 8, createRenderer: gl, envId: 'e', ...o });
const plated = (): ModelScene =>
  scene(
    { plateIds: [1] },
    {
      plates: { list: [{ id: 1, objectCount: 1, instanceCount: 1, bounds: { min: [0, 0, 0], max: [10, 10, 0] } }] },
      capabilities: { ...caps, plates: 'known' }
    }
  );

describe('cache key fragments', () => {
  it('the default env id is the three revision', () => {
    expect(defaultEnvId()).toBe(`three${REVISION}`);
    expect(defaultEnvId()).toMatch(/^three\d+$/);
    const b = new Uint8Array([1, 2, 3]);
    expect(computeCacheKey(b, '{}')).toBe(computeCacheKey(b, '{}', defaultEnvId()));
    expect(computeCacheKey(b, '{}', 'a')).not.toBe(computeCacheKey(b, '{}', 'b'));
  });

  it('plate scopes key distinctly; objectIds keys are order-independent', async () => {
    const p1 = (await still(plated(), { renderScope: { plateId: 1 } })).cacheKey;
    const p2 = (await still(plated(), { renderScope: { plateId: 2 } })).cacheKey;
    expect(p1).not.toBe(p2);
    const ab = (await still(plated(), { renderScope: { objectIds: ['a', 'b'] } })).cacheKey;
    const ba = (await still(plated(), { renderScope: { objectIds: ['b', 'a'] } })).cacheKey;
    const aOnly = (await still(plated(), { renderScope: { objectIds: ['a'] } })).cacheKey;
    expect(ab).toBe(ba);
    expect(ab).not.toBe(aOnly);
  });

  it('an opaque instanceFilter is never a cache hit, even for the same function', async () => {
    const f = () => true;
    const k1 = (await still(plated(), { renderScope: { instanceFilter: f } })).cacheKey;
    const k2 = (await still(plated(), { renderScope: { instanceFilter: f } })).cacheKey;
    expect(k1).not.toBe(k2);
  });

  it('the filament palette is part of the key', async () => {
    const s = { kind: 'stl', bytes: new Uint8Array(84) };
    const a = (await still(s, { filamentPalette: ['#112233'] }).catch(() => ({ cacheKey: 'x' }))).cacheKey;
    const sc = plated();
    const k1 = (await still(sc, { filamentPalette: ['#112233'] })).cacheKey;
    const k2 = (await still(sc, { filamentPalette: ['#445566'] })).cacheKey;
    const k0 = (await still(sc)).cacheKey;
    expect(a).toBeDefined();
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k0);
  });

  it('declared plates are returned on the result', async () => {
    const r = await still(plated());
    expect(r.plates).toEqual(plated().plates);
    expect((await still(scene())).plates).toBeUndefined();
  });

  it('a bad scope is rejected before the source is even loaded', async () => {
    await expect(
      still({ kind: 'nope', bytes: new Uint8Array(1) }, { renderScope: { objectIds: 'a' } })
    ).rejects.toThrow(RangeError);
  });
});

describe('plate helpers', () => {
  it('bedOf maps a build volume to a placement rectangle', () => {
    expect(bedOf(null)).toBeNull();
    expect(bedOf({ x: 100, y: 50, z: 10 })).toEqual({ min: [0, 0], max: [100, 50] });
    expect(bedOf({ x: 10, y: 20, z: 5, min: { x: 100, y: 200, z: 0 } } as never)).toEqual({
      min: [100, 200],
      max: [110, 220]
    });
    expect(bedOf({ x: 10, y: 20, z: 5, min: { x: 100 } } as never)).toEqual({ min: [100, 0], max: [110, 20] });
    expect(bedOf({ x: 10, y: 20, z: 5, min: { y: 200 } } as never)).toEqual({ min: [0, 200], max: [10, 220] });
  });

  it('isTransparentBackground is true only when nothing paints', () => {
    expect(isTransparentBackground(undefined, 'transparent')).toBe(true);
    expect(isTransparentBackground({ background: null }, 'transparent')).toBe(true);
    expect(isTransparentBackground({ background: '#ffffff' }, 'transparent')).toBe(false);
    expect(isTransparentBackground(undefined, '#ffffff')).toBe(false);
  });

  const mk = () => {
    const sc = new Scene();
    const content = new ModelContent(sc);
    const model = scene();
    content.setScene(model);
    const plate = new ModelPlate(sc, { x: 100, y: 100, z: 50 }, undefined);
    return { sc, content, model, plate };
  };

  it('update with no scene reports no placement and draws nothing', () => {
    const { content, plate } = mk();
    expect(plate.update(content, null, null, null).placement).toBeNull();
    expect(plate.volumeGroup).toBeNull();
  });

  it('hide() survives a rebuild, nests, and restores exactly once per handle', () => {
    const { content, model, plate } = mk();
    plate.update(content, model, model, null);
    expect(plate.volumeGroup?.visible).toBe(true);
    const r1 = plate.hide();
    const r2 = plate.hide();
    expect(plate.volumeGroup?.visible).toBe(false);
    plate.rebuild(); // e.g. a theme change mid-capture
    expect(plate.volumeGroup?.visible).toBe(false);
    r1();
    r1(); // a second call of the same handle must not release the other hide
    expect(plate.volumeGroup?.visible).toBe(false);
    r2();
    expect(plate.volumeGroup?.visible).toBe(true);
  });

  it('dispose is idempotent and removes the plate', () => {
    const { sc, content, model, plate } = mk();
    plate.update(content, model, model, null);
    plate.dispose();
    plate.dispose();
    expect(sc.getObjectByName('modelPlate')).toBeUndefined();
    plate.rebuild();
    expect(plate.volumeGroup).toBeNull();
  });
});

function stubControls(camera: PerspectiveCamera | OrthographicCamera) {
  const c = {
    object: camera,
    target: new Vector3(),
    enabled: true,
    update: () => undefined,
    dispose: () => undefined,
    addEventListener: () => undefined,
    listenToKeyEvents: () => undefined
  };
  return c as unknown as ControlsLike;
}
function rig() {
  const el = document.createElement('canvas');
  let controls: ControlsLike | null = null;
  const count = { renders: 0 };
  const viewer = createModelViewer(el, {
    createRenderer: () =>
      ({
        render: () => count.renders++,
        setSize: () => undefined,
        dispose: () => undefined,
        domElement: el
      }) as unknown as GLRendererLike,
    createControls: (cam) => (controls = stubControls(cam))
  });
  viewer.resize(800, 600);
  return { viewer, el, count, controls: () => controls! };
}
const plateScene = (): ModelScene =>
  scene(
    { geometry: { positions: new Float32Array([0, 0, 0, 100, 0, 0, 0, 30, 6]) } },
    { bounds: { min: [0, 0, 0], max: [100, 30, 6] } }
  );
const zoomOut = (r: ReturnType<typeof rig>): void => {
  const cam = (r.controls() as unknown as { object: PerspectiveCamera }).object;
  const t = (r.controls() as unknown as { target: Vector3 }).target;
  cam.position.sub(t).multiplyScalar(3).add(t); // distance only — the view direction is unchanged
};
const close = (a: CameraState, b: CameraState): void => {
  for (const k of ['x', 'y', 'z'] as const) {
    expect(a.position[k]).toBeCloseTo(b.position[k], 3);
    expect(a.target[k]).toBeCloseTo(b.target[k], 3);
  }
};

describe('viewer re-fit while library-framed', () => {
  it('setView fits the new direction (distance is refitted, not kept)', async () => {
    const ref = rig();
    await ref.viewer.setSource(plateScene());
    ref.viewer.setView('top');
    const expected = ref.viewer.getCameraState() as CameraState;

    const r = rig();
    await r.viewer.setSource(plateScene());
    zoomOut(r);
    r.viewer.setView('top');
    close(r.viewer.getCameraState() as CameraState, expected);
  });

  it('a context-loss restore re-fits the model', async () => {
    const r = rig();
    await r.viewer.setSource(plateScene());
    const fitted = r.viewer.getCameraState() as CameraState;
    zoomOut(r);
    r.el.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    r.el.dispatchEvent(new Event('webglcontextrestored'));
    close(r.viewer.getCameraState() as CameraState, fitted);
  });
});

describe('viewer: auto-framing resumes and redraws', () => {
  /** Reference pose: load, then resize to a narrow canvas while library-framed. */
  async function refPose(scopeIt = false): Promise<CameraState> {
    const ref = rig();
    await ref.viewer.setSource(plateScene());
    if (scopeIt) ref.viewer.setRenderScope({ objectIds: ['a'] });
    ref.viewer.resize(300, 900);
    return ref.viewer.getCameraState() as CameraState;
  }
  const userMove = (r: ReturnType<typeof rig>): void => {
    const s = r.viewer.getCameraState() as CameraState;
    r.viewer.setCameraState({ ...s, position: { x: s.position.x * 2, y: s.position.y * 2, z: s.position.z * 2 } });
  };

  it('a new source hands the camera back to auto-framing', async () => {
    const expected = await refPose();
    const r = rig();
    await r.viewer.setSource(plateScene());
    userMove(r);
    await r.viewer.setSource(plateScene());
    r.viewer.resize(300, 900);
    close(r.viewer.getCameraState() as CameraState, expected);
  });

  it('a render-scope change hands the camera back to auto-framing', async () => {
    const expected = await refPose(true);
    const r = rig();
    await r.viewer.setSource(plateScene());
    userMove(r);
    r.viewer.setRenderScope({ objectIds: ['a'] });
    r.viewer.resize(300, 900);
    close(r.viewer.getCameraState() as CameraState, expected);
  });

  it('setBackground redraws', async () => {
    const r = rig();
    await r.viewer.setSource(plateScene());
    const n = r.count.renders;
    r.viewer.setBackground('#ff0000');
    expect(r.count.renders).toBe(n + 1);
  });
});
