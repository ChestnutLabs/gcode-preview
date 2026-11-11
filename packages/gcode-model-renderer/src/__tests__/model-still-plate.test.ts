// @vitest-environment happy-dom
/**
 * DD-032 §4.3 — the headless still gets the same plate, theme and lens as the live viewer: placement in the
 * result, the framed view contains the drawn part at any lens, background precedence, cache keys, and that
 * a still with no new option renders exactly as before.
 */
import { describe, expect, it } from 'vitest';
import { Camera, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Vector3, type Scene } from 'three';
import { studioTheme, type GLRendererLike } from '@chestnutlabs/gcode-renderer-three';
import { renderModelStill, type RenderModelStillOptions } from '../render-model-still.js';
import { IDENTITY_MAT4, type ModelScene } from '../scene-model.js';
import { enc, makeZip, singleObjectModel, TWO_PLATE_MODEL, TWO_PLATE_SETTINGS } from './zip-fixture.js';

function stl(): ModelScene {
  return {
    objects: [
      {
        id: 'stl',
        geometry: {
          positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 5]),
          indices: new Uint32Array([0, 1, 2, 0, 1, 3])
        },
        transform: IDENTITY_MAT4
      }
    ],
    bounds: { min: [0, 0, 0], max: [10, 10, 5] },
    capabilities: {
      materials: 'unavailable',
      transforms: 'unavailable',
      multiObject: 'unavailable',
      instanced: 'unavailable',
      plates: 'unavailable'
    }
  };
}

interface Seen {
  scene: Scene;
  camera: PerspectiveCamera;
  /** What the scene held AT RENDER TIME (the renderer is disposed, and its plate removed, right after). */
  plate: boolean;
  shadow: boolean;
  disposed: number;
}

async function still(source: Parameters<typeof renderModelStill>[0], opts: Partial<RenderModelStillOptions> = {}) {
  const canvas = document.createElement('canvas');
  const seen: Seen = { scene: null as never, camera: null as never, plate: false, shadow: false, disposed: 0 };
  const gl: GLRendererLike = {
    render: (s: Scene, c: Camera) => {
      seen.scene = s;
      seen.camera = c as PerspectiveCamera;
      seen.plate = s.getObjectByName('buildVolume') !== undefined;
      seen.shadow = s.getObjectByName('contactShadow') !== undefined;
    },
    setSize: () => undefined,
    dispose: () => {
      seen.disposed++;
    },
    domElement: canvas
  };
  const result = await renderModelStill(source, { canvas, width: 400, height: 300, createRenderer: () => gl, ...opts });
  return { result, seen };
}

function ndcMax(camera: PerspectiveCamera, min: number[], max: number[]): number {
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  let worst = 0;
  for (let i = 0; i < 8; i++) {
    const p = new Vector3(i & 1 ? max[0] : min[0], i & 4 ? max[2] : min[2], -(i & 2 ? max[1] : min[1])).project(camera);
    worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y));
  }
  return worst;
}

const BED = { x: 256, y: 256, z: 256 };
const settings = {
  name: 'Metadata/project_settings.config',
  data: enc(JSON.stringify({ printable_area: ['0x0', '256x0', '256x256', '0x256'] }))
};

describe('renderModelStill — no new option is exactly today', () => {
  it('draws no plate, no offset, null placement, and the cache key ignores absent options', async () => {
    const { result, seen } = await still(stl());
    expect(seen.plate).toBe(false);
    expect(seen.shadow).toBe(false);
    expect(result.placement).toBeNull();
    expect(result.placementOffset).toBeNull();
    expect(seen.camera.fov).toBe(50);
    expect(seen.scene.background).toBeNull();
    const explicit = await still(stl(), { buildVolume: undefined, theme: undefined, cameraFov: undefined });
    expect(explicit.result.cacheKey).toBe(result.cacheKey);
    expect(seen.disposed).toBe(1);
  });
});

describe('renderModelStill — plate', () => {
  it('draws the plate with the model on it, frames the presented part, and reports the placement', async () => {
    const { result, seen } = await still(stl(), { buildVolume: BED, theme: studioTheme('dark') });
    expect(result.placement).toBe('approximated');
    expect(result.placementOffset).toEqual({ x: 123, y: 123, z: 0 });
    expect(seen.plate).toBe(true);
    expect(seen.shadow).toBe(true);
    const e = ndcMax(seen.camera, [123, 123, 0], [133, 133, 5]);
    expect(e).toBeLessThanOrEqual(1);
    expect(e).toBeGreaterThan(0.6);
  });

  it('a Bambu/Orca project reads known / inferred, and a multi-plate project unscoped draws none', async () => {
    const zipOf = (model: string, ...extra: { name: string; data: Uint8Array }[]) => ({
      kind: '3mf' as const,
      bytes: makeZip([{ name: '3D/3dmodel.model', data: enc(model) }, ...extra])
    });
    const known = await still(zipOf(singleObjectModel('100 100 0'), settings), { buildVolume: BED });
    expect(known.result.placement).toBe('known');
    expect(known.result.placementOffset).toEqual({ x: 0, y: 0, z: 0 });
    const multi = zipOf(TWO_PLATE_MODEL, settings, {
      name: 'Metadata/model_settings.config',
      data: enc(TWO_PLATE_SETTINGS)
    });
    const two = await still(multi, { buildVolume: BED, renderScope: { plateId: 2 } });
    expect(two.result.placement).toBe('inferred');
    expect(two.result.placementOffset!.x).toBeCloseTo(-307.2, 4);
    const none = await still(multi, { buildVolume: BED });
    expect(none.result.placement).toBeNull();
    expect(none.seen.plate).toBe(false);
    const ghost = await still(multi, { buildVolume: BED, renderScope: { plateId: 9 } });
    expect(ghost.result.placement).toBeNull();
    expect(ghost.seen.plate).toBe(false);
  });

  it('disposes the plate, its shadow and the gradient with the renderer', async () => {
    const { seen } = await still(stl(), { buildVolume: BED, theme: studioTheme('dark') });
    expect(seen.plate).toBe(true); // it was drawn ...
    expect(seen.scene.getObjectByName('modelPlate')).toBeUndefined(); // ... and removed after the still
    expect(seen.disposed).toBe(1);
  });
});

describe('renderModelStill — lens', () => {
  it.each([10, 32, 50, 120])('cameraFov %s: the camera uses it and the framed part is inside the view', async (fov) => {
    const { seen } = await still(stl(), { buildVolume: BED, cameraFov: fov });
    expect(seen.camera.fov).toBe(fov);
    const e = ndcMax(seen.camera, [123, 123, 0], [133, 133, 5]);
    expect(e).toBeLessThanOrEqual(1);
  });

  it('rejects an out-of-range lens before any work, never clamping', async () => {
    await expect(still(stl(), { cameraFov: 9 })).rejects.toThrow(RangeError);
    await expect(still(stl(), { cameraFov: 121 })).rejects.toThrow(RangeError);
    await expect(still(stl(), { cameraFov: NaN })).rejects.toThrow(RangeError);
  });
});

describe('renderModelStill — background precedence and lighting', () => {
  const hex = (b: Scene['background']): number | string =>
    b instanceof Color ? b.getHex() : b === null ? 'null' : b.constructor.name;

  it('theme.background (solid / gradient) beats background; null falls through to it; then transparent', async () => {
    expect(
      hex((await still(stl(), { background: '#ff0000', theme: { background: '#00ff00' } })).seen.scene.background)
    ).toBe(0x00ff00);
    expect(hex((await still(stl(), { background: '#ff0000', theme: studioTheme('dark') })).seen.scene.background)).toBe(
      'DataTexture'
    );
    expect(
      hex(
        (await still(stl(), { background: '#ff0000', theme: { ...studioTheme('dark'), background: null } })).seen.scene
          .background
      )
    ).toBe(0xff0000);
    expect(
      hex((await still(stl(), { theme: { ...studioTheme('dark'), background: null } })).seen.scene.background)
    ).toBe('null');
    expect(hex((await still(stl(), { background: '#ff0000' })).seen.scene.background)).toBe(0xff0000);
  });

  it('model lighting is unchanged under studioTheme', async () => {
    const lights = (s: Scene) => {
      const out: unknown[] = [];
      s.traverse((o) => {
        if (o instanceof HemisphereLight) out.push(['hemi', o.color.getHex(), o.groundColor.getHex(), o.intensity]);
        if (o instanceof DirectionalLight) out.push(['dir', o.color.getHex(), o.intensity]);
      });
      return out;
    };
    const base = lights((await still(stl(), { buildVolume: BED })).seen.scene);
    const themed = lights(
      (await still(stl(), { buildVolume: BED, theme: { ...studioTheme('light'), hemisphereIntensity: 9 } })).seen.scene
    );
    expect(themed).toEqual(base);
    expect(base).toEqual([
      ['hemi', 0xffffff, 0x9098a5, 2.0],
      ['dir', 0xffffff, 1.6],
      ['dir', 0xffffff, 0.5]
    ]);
  });
});

describe('renderModelStill — cache key', () => {
  it('folds the plate, theme and lens; identical options give an identical key', async () => {
    const base = (await still(stl())).result.cacheKey;
    const plate = (await still(stl(), { buildVolume: BED })).result.cacheKey;
    const plate2 = (await still(stl(), { buildVolume: BED })).result.cacheKey;
    const bigger = (await still(stl(), { buildVolume: { ...BED, x: 300 } })).result.cacheKey;
    const themed = (await still(stl(), { buildVolume: BED, theme: studioTheme('dark') })).result.cacheKey;
    const lens = (await still(stl(), { buildVolume: BED, cameraFov: 32 })).result.cacheKey;
    expect(plate).toBe(plate2);
    expect(new Set([base, plate, bigger, themed, lens]).size).toBe(5);
  });

  it('a textured theme is non-cacheable (unique each call, never a false hit)', async () => {
    const tex = document.createElement('canvas');
    const t = { ...studioTheme('dark'), bedSurface: { ...studioTheme('dark').bedSurface!, texture: tex } };
    const a = (await still(stl(), { buildVolume: BED, theme: t })).result.cacheKey;
    const b = (await still(stl(), { buildVolume: BED, theme: t })).result.cacheKey;
    expect(a).not.toBe(b);
  });
});
