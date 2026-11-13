// @vitest-environment happy-dom
/**
 * `ModelPlate` driven directly (no viewer): the footprint under the presented part, the stored theme and bed,
 * the no-placement and no-bed guards, and the pure background helpers. Literal expected values throughout.
 */
import { describe, expect, it, vi } from 'vitest';
import { Box3, Color, Scene, Vector3, type Mesh } from 'three';
import { studioTheme } from '@chestnutlabs/gcode-renderer-three';
import type { ModelContent } from '../model-content.js';
import { ModelPlate, applyModelBackground, bedOf, isTransparentBackground } from '../model-plate.js';
import { IDENTITY_MAT4, type ModelScene } from '../scene-model.js';

/** A 10 × 20 × 5 mm part with its min corner at the origin. */
function part(): ModelScene {
  return {
    objects: [
      {
        id: 'p',
        geometry: { positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 20, 5]) },
        transform: IDENTITY_MAT4
      }
    ],
    bounds: { min: [0, 0, 0], max: [10, 20, 5] },
    capabilities: {
      materials: 'unavailable',
      transforms: 'unavailable',
      multiObject: 'unavailable',
      instanced: 'unavailable',
      plates: 'unavailable'
    }
  };
}

function fakeContent() {
  const setPresentationOffset = vi.fn();
  return { content: { setPresentationOffset } as unknown as ModelContent, setPresentationOffset };
}

const BED = { x: 100, y: 100, z: 50 };
const shadowOf = (p: ModelPlate): Mesh | undefined =>
  p.volumeGroup?.getObjectByName('contactShadow') as Mesh | undefined;
const boxOf = (m: Mesh): Box3 => {
  m.geometry.computeBoundingBox();
  return m.geometry.boundingBox!;
};

describe('ModelPlate: structure', () => {
  it('adds one group named modelPlate, rotated −90° about X (printer Z-up → scene Y-up)', () => {
    const scene = new Scene();
    const plate = new ModelPlate(scene, BED, undefined);
    const root = scene.getObjectByName('modelPlate')!;
    expect(root.parent).toBe(scene);
    expect(root.rotation.x).toBe(-Math.PI / 2);
    plate.dispose();
    expect(scene.getObjectByName('modelPlate')).toBeUndefined();
  });
});

describe('ModelPlate.update: placement and the contact-shadow footprint', () => {
  it('centres the part on the bed and sizes the shadow to the presented 10 × 20 footprint × 1.4', () => {
    const scene = new Scene();
    const plate = new ModelPlate(scene, BED, studioTheme('dark'));
    const { content, setPresentationOffset } = fakeContent();
    const s = part();
    const result = plate.update(content, s, s, null);
    expect(result.placement).toBe('approximated');
    expect(result.placementOffset).toEqual({ x: 45, y: 40, z: 0 });
    expect(setPresentationOffset).toHaveBeenCalledWith({ x: 45, y: 40, z: 0 });
    const box = boxOf(shadowOf(plate)!);
    const size = box.getSize(new Vector3());
    const centre = box.getCenter(new Vector3());
    expect(size.x).toBeCloseTo(14, 4); // 10 × 1.4
    expect(size.y).toBeCloseTo(28, 4); // 20 × 1.4
    expect(centre.x).toBeCloseTo(50, 4); // 45 + 10/2
    expect(centre.y).toBeCloseTo(50, 4); // 40 + 20/2
  });

  it('moves the shadow with a bed that has a non-zero min corner', () => {
    const scene = new Scene();
    const plate = new ModelPlate(
      scene,
      { x: 100, y: 100, z: 50, min: { x: -50, y: -50 } } as never,
      studioTheme('dark')
    );
    const { content } = fakeContent();
    const s = part();
    plate.update(content, s, s, null);
    const centre = boxOf(shadowOf(plate)!).getCenter(new Vector3());
    expect(centre.x).toBeCloseTo(0, 4);
    expect(centre.y).toBeCloseTo(0, 4);
  });

  it('no plate result (nothing shown, or no full scene) → no placement, no shadow, but the offset is still cleared', () => {
    const scene = new Scene();
    const plate = new ModelPlate(scene, BED, studioTheme('dark'));
    const { content, setPresentationOffset } = fakeContent();
    const s = part();
    expect(plate.update(content, null, s, null)).toEqual({ placement: null, placementOffset: null });
    expect(plate.volumeGroup).toBeNull();
    expect(plate.update(content, s, null, null)).toEqual({ placement: null, placementOffset: null });
    expect(plate.volumeGroup).toBeNull();
    expect(setPresentationOffset).toHaveBeenLastCalledWith(null);
    expect(plate.getPlacement()).toEqual({ placement: null, placementOffset: null });
  });

  it('with a bed but nothing shown, the next update with content builds the plate again', () => {
    const scene = new Scene();
    const plate = new ModelPlate(scene, BED, studioTheme('dark'));
    const { content } = fakeContent();
    const s = part();
    plate.update(content, s, null, null);
    expect(plate.volumeGroup).toBeNull();
    plate.update(content, s, s, null);
    expect(plate.volumeGroup).not.toBeNull();
    expect(shadowOf(plate)).toBeDefined();
  });
});

describe('ModelPlate: stored bed and theme', () => {
  it('setTheme is remembered by the next rebuild', () => {
    const scene = new Scene();
    const plate = new ModelPlate(scene, BED, undefined);
    const { content } = fakeContent();
    const s = part();
    plate.update(content, s, s, null);
    expect(shadowOf(plate)).toBeUndefined(); // the default theme draws no contact shadow
    plate.setTheme(studioTheme('dark'));
    plate.rebuild();
    expect(shadowOf(plate)).toBeDefined();
  });

  it('setBuildVolume(null) then rebuild() draws nothing and does not throw (context-restore with the bed removed)', () => {
    const scene = new Scene();
    const plate = new ModelPlate(scene, BED, studioTheme('dark'));
    const { content } = fakeContent();
    const s = part();
    plate.update(content, s, s, null);
    expect(plate.volumeGroup).not.toBeNull();
    plate.setBuildVolume(null);
    expect(() => plate.rebuild()).not.toThrow();
    expect(plate.volumeGroup).toBeNull();
    expect(scene.getObjectByName('modelPlate')!.children).toHaveLength(0);
  });

  it('a later bed is used by the next update', () => {
    const scene = new Scene();
    const plate = new ModelPlate(scene, BED, studioTheme('dark'));
    const { content } = fakeContent();
    const s = part();
    plate.update(content, s, s, null);
    plate.setBuildVolume({ x: 200, y: 200, z: 50 });
    expect(plate.update(content, s, s, null).placementOffset).toEqual({ x: 95, y: 90, z: 0 });
  });

  it('rebuild after dispose draws nothing', () => {
    const scene = new Scene();
    const plate = new ModelPlate(scene, BED, studioTheme('dark'));
    const { content } = fakeContent();
    const s = part();
    plate.update(content, s, s, null);
    plate.dispose();
    plate.rebuild();
    expect(plate.volumeGroup).toBeNull();
    expect(scene.getObjectByName('modelPlate')).toBeUndefined();
  });
});

describe('ModelPlate: cage and hide', () => {
  function built(cage?: boolean) {
    const scene = new Scene();
    const plate = new ModelPlate(scene, BED, studioTheme('dark'), cage);
    const { content } = fakeContent();
    const s = part();
    plate.update(content, s, s, null);
    return { plate, content, s };
  }
  const cageOf = (p: ModelPlate) => p.volumeGroup!.getObjectByName('volumeCage')!;

  it('setCageVisible toggles the cage in place and is remembered by a rebuild', () => {
    const { plate } = built();
    expect(cageOf(plate).visible).toBe(true);
    plate.setCageVisible(false);
    expect(cageOf(plate).visible).toBe(false);
    plate.rebuild();
    expect(cageOf(plate).visible).toBe(false);
    plate.setCageVisible(true);
    expect(cageOf(plate).visible).toBe(true);
  });

  it('the constructor cageVisible flag is honoured', () => {
    expect(cageOf(built(false).plate).visible).toBe(false);
  });

  it('hide() is counted: nested hides restore only when the last one is released, and a release is idempotent', () => {
    const { plate } = built();
    const v = plate.volumeGroup!;
    const a = plate.hide();
    const b = plate.hide();
    expect(v.visible).toBe(false);
    a();
    a(); // a second call of the same release must not decrement again
    expect(v.visible).toBe(false);
    b();
    expect(v.visible).toBe(true);
  });

  it('a plate rebuilt while hidden stays hidden, and shows once released', () => {
    const { plate } = built();
    const release = plate.hide();
    plate.rebuild();
    expect(plate.volumeGroup!.visible).toBe(false);
    release();
    expect(plate.volumeGroup!.visible).toBe(true);
  });

  it('a hide taken with no plate drawn applies to the plate drawn afterwards', () => {
    const scene = new Scene();
    const plate = new ModelPlate(scene, BED, studioTheme('dark'));
    const release = plate.hide();
    const { content } = fakeContent();
    const s = part();
    plate.update(content, s, s, null);
    expect(plate.volumeGroup!.visible).toBe(false);
    release();
    expect(plate.volumeGroup!.visible).toBe(true);
  });
});

describe('bedOf', () => {
  it('null → null; otherwise the rectangle from min (default 0,0) and size', () => {
    expect(bedOf(null)).toBeNull();
    expect(bedOf({ x: 100, y: 80, z: 10 })).toEqual({ min: [0, 0], max: [100, 80] });
    expect(bedOf({ x: 100, y: 80, z: 10, min: { x: -10, y: -20 } } as never)).toEqual({
      min: [-10, -20],
      max: [90, 60]
    });
    expect(bedOf({ x: 100, y: 80, z: 10, min: { x: 5 } } as never)).toEqual({ min: [5, 0], max: [105, 80] });
    expect(bedOf({ x: 100, y: 80, z: 10, min: { y: 7 } } as never)).toEqual({ min: [0, 7], max: [100, 87] });
  });
});

describe('applyModelBackground / isTransparentBackground', () => {
  it('disposes the previous gradient backdrop first, whatever replaces it', () => {
    const scene = new Scene();
    const previous = applyModelBackground(scene, studioTheme('dark'), 'transparent', null)!;
    expect(previous).not.toBeNull();
    const dispose = vi.spyOn(previous, 'dispose');
    expect(applyModelBackground(scene, undefined, 'transparent', previous)).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(scene.background).toBeNull();
  });

  it('a solid theme background wins over the fallback; null/undefined fall through to it', () => {
    const scene = new Scene();
    expect(applyModelBackground(scene, { background: '#112233' }, '#ffffff', null)).toBeNull();
    expect((scene.background as Color).getHexString()).toBe('112233');
    applyModelBackground(scene, { background: null }, '#445566', null);
    expect((scene.background as Color).getHexString()).toBe('445566');
    applyModelBackground(scene, undefined, '#778899', null);
    expect((scene.background as Color).getHexString()).toBe('778899');
    applyModelBackground(scene, {}, 'transparent', null);
    expect(scene.background).toBeNull();
  });

  it('a numeric theme background is a color too', () => {
    const scene = new Scene();
    applyModelBackground(scene, { background: 0x00ff00 }, 'transparent', null);
    expect((scene.background as Color).getHexString()).toBe('00ff00');
  });

  it('transparent only when neither the theme nor the fallback paints', () => {
    expect(isTransparentBackground(undefined, 'transparent')).toBe(true);
    expect(isTransparentBackground({ background: null }, 'transparent')).toBe(true);
    expect(isTransparentBackground({}, 'transparent')).toBe(true);
    expect(isTransparentBackground({ background: '#000000' }, 'transparent')).toBe(false);
    expect(isTransparentBackground(undefined, '#000000')).toBe(false);
    expect(isTransparentBackground({ background: null }, '#000000')).toBe(false);
  });
});
