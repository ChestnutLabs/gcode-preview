// @vitest-environment happy-dom
/**
 * DD-032 Lane A: the Studio-look renderer primitives — theme fields + validation + the preset, the
 * two-tier grid, the bed outline on every shape, the slab plate, the gradient backdrop, the contact
 * shadow, and the extracted volume-style mapper. Expected values are literal, never the module's own.
 */
import { describe, expect, it } from 'vitest';
import {
  type BufferGeometry,
  DataTexture,
  type Group,
  LinearFilter,
  type LineBasicMaterial,
  type LineLoop,
  type LineSegments,
  type Mesh,
  type MeshBasicMaterial,
  SRGBColorSpace
} from 'three';
import {
  CONTACT_SHADOW_Z,
  DEFAULT_THEME,
  STUDIO_CAMERA_FOV,
  createBackdrop,
  createBuildVolume,
  createContactShadow,
  resolveTheme,
  studioTheme,
  volumeStyle,
  type BuildVolumeDef,
  type BuildVolumeStyle
} from '../index.js';

const child = <T>(g: Group, name: string): T | undefined => g.children.find((c) => c.name === name) as T | undefined;
const positions = (o: { geometry: BufferGeometry }): number[] =>
  Array.from(o.geometry.getAttribute('position').array as Float32Array);
/** Unnamed grid LineSegments (the minor tier) — the first LineSegments child. */
const minorGrid = (g: Group): LineSegments =>
  g.children.find((c) => (c as LineSegments).isLineSegments && c.name === '') as LineSegments;
/** x of each vertical (constant-x) segment in a flat segment list. */
const verticalXs = (p: number[]): number[] => {
  const xs: number[] = [];
  for (let i = 0; i < p.length; i += 6) if (p[i] === p[i + 3] && p[i + 1] !== p[i + 4]) xs.push(p[i]);
  return xs;
};
const horizontalYs = (p: number[]): number[] => {
  const ys: number[] = [];
  for (let i = 0; i < p.length; i += 6) if (p[i + 1] === p[i + 4] && p[i] !== p[i + 3]) ys.push(p[i + 1]);
  return ys;
};

const RECT: BuildVolumeDef = { x: 100, y: 60, z: 50, grid: 10 };

describe('theme (DD-032)', () => {
  it('DEFAULT_THEME and resolveTheme({}) are unchanged (no new keys)', () => {
    const expected = {
      background: null,
      gridColor: 0x448844,
      gridOpacity: 0.35,
      bedColor: 0x888888,
      bedOpacity: 0.5,
      hemisphereSky: 0xffffff,
      hemisphereGround: 0x35404d,
      hemisphereIntensity: 1.6,
      directionalColor: 0xffffff,
      directionalIntensity: 1.1,
      materialPreset: 'matte',
      bedSurface: { mode: 'none' }
    };
    expect(DEFAULT_THEME).toStrictEqual(expected);
    expect(resolveTheme({})).toStrictEqual(expected);
  });

  it('maps gridOpacity, gridMajor, bedOutline, contactShadow and a gradient background', () => {
    const r = resolveTheme({
      background: { top: '#111111', bottom: '#222222' },
      gridOpacity: 0.2,
      gridMajor: { every: 50, opacity: 0.4 },
      bedOutline: { opacity: 0.9, color: '#ff0000' },
      contactShadow: { opacity: 0.5 }
    });
    expect(r.background).toStrictEqual({ top: '#111111', bottom: '#222222' });
    expect(r.gridOpacity).toBe(0.2);
    expect(r.gridMajor).toStrictEqual({ every: 50, opacity: 0.4 });
    expect(r.bedOutline).toStrictEqual({ opacity: 0.9, color: '#ff0000' });
    expect(r.contactShadow).toStrictEqual({ opacity: 0.5 });
  });

  it.each([
    [{ gridOpacity: NaN }, 'theme gridOpacity must be a number in [0,1] (got NaN)'],
    [{ gridOpacity: 1.01 }, 'theme gridOpacity must be a number in [0,1] (got 1.01)'],
    [{ gridMajor: { every: 50, opacity: -0.1 } }, 'theme gridMajor.opacity must be a number in [0,1] (got -0.1)'],
    [{ bedOutline: { opacity: Infinity } }, 'theme bedOutline.opacity must be a number in [0,1] (got Infinity)'],
    [{ contactShadow: { opacity: 2 } }, 'theme contactShadow.opacity must be a number in [0,1] (got 2)'],
    [{ gridMajor: { every: 0, opacity: 0.3 } }, 'theme gridMajor.every must be a positive number (got 0)'],
    [{ gridMajor: { every: NaN, opacity: 0.3 } }, 'theme gridMajor.every must be a positive number (got NaN)'],
    [{ gridMajor: { every: Infinity, opacity: 0.3 } }, 'theme gridMajor.every must be a positive number (got Infinity)']
  ])('rejects %j with a RangeError', (theme, message) => {
    expect(() => resolveTheme(theme)).toThrow(RangeError);
    expect(() => resolveTheme(theme)).toThrow(message);
  });

  it('accepts the opacity bounds 0 and 1', () => {
    expect(resolveTheme({ gridOpacity: 0, bedOutline: { opacity: 1 } }).gridOpacity).toBe(0);
  });

  it('studioTheme matches the §4.4 table; STUDIO_CAMERA_FOV is 32', () => {
    expect(STUDIO_CAMERA_FOV).toBe(32);
    const plate = { mode: 'solid', color: '#7c8086', thickness: 4, edgeColor: '#585c61' };
    expect(studioTheme('dark')).toStrictEqual({
      background: { top: '#23272e', bottom: '#2b3038' },
      bedSurface: plate,
      gridColor: '#ffffff',
      gridOpacity: 0.11,
      gridMajor: { every: 50, opacity: 0.39 },
      bedOutline: { color: '#ffffff', opacity: 0.83 },
      contactShadow: { opacity: 0.4 }
    });
    expect(studioTheme('light')).toStrictEqual({
      background: { top: '#dfe3e8', bottom: '#c9ced5' },
      bedSurface: plate,
      gridColor: '#1b2430',
      gridOpacity: 0.16,
      gridMajor: { every: 50, opacity: 0.55 },
      bedOutline: { color: '#1b2430', opacity: 0.87 },
      contactShadow: { opacity: 0.3 }
    });
    expect(studioTheme('dark')).not.toBe(studioTheme('dark'));
  });
});

describe('volumeStyle', () => {
  it('maps a resolved theme + the cage flag; omits unset DD-032 fields', () => {
    expect(volumeStyle(resolveTheme({}), false)).toStrictEqual({
      gridColor: 0x448844,
      gridOpacity: 0.35,
      boxColor: 0x888888,
      boxOpacity: 0.5,
      bedSurface: { mode: 'none' },
      showCage: false
    });
    const s = volumeStyle(resolveTheme({ gridMajor: { every: 20, opacity: 0.5 }, bedOutline: { opacity: 0.7 } }), true);
    expect(s.showCage).toBe(true);
    expect(s.gridMajor).toStrictEqual({ every: 20, opacity: 0.5 });
    expect(s.bedOutline).toStrictEqual({ opacity: 0.7 });
  });
});

describe('two-tier grid', () => {
  const style: BuildVolumeStyle = { gridColor: 0x00ff00, gridMajor: { every: 50, opacity: 0.6, color: 0xff0000 } };

  it('major lines at multiples of `every` from the bed minimum; coinciding minor lines are not drawn', () => {
    const g = createBuildVolume({ ...RECT, min: { x: -20, y: 5 } }, style);
    const major = child<LineSegments>(g, 'gridMajor')!;
    expect(verticalXs(positions(major))).toEqual([-20, 30, 80]);
    expect(horizontalYs(positions(major))).toEqual([5, 55]);
    const minor = positions(minorGrid(g));
    expect(verticalXs(minor)).toEqual([-10, 0, 10, 20, 40, 50, 60, 70]);
    expect(horizontalYs(minor)).toEqual([15, 25, 35, 45, 65]);
    const m = major.material as LineBasicMaterial;
    expect(m.opacity).toBe(0.6);
    expect(m.color.getHex()).toBe(0xff0000);
  });

  it('major color defaults to the grid color', () => {
    const g = createBuildVolume(RECT, { gridColor: 0x123456, gridMajor: { every: 20, opacity: 0.5 } });
    expect((child<LineSegments>(g, 'gridMajor')!.material as LineBasicMaterial).color.getHex()).toBe(0x123456);
  });

  it('unset → one tier, positions identical to the single-tier grid', () => {
    const g = createBuildVolume(RECT);
    expect(child(g, 'gridMajor')).toBeUndefined();
    const p = positions(minorGrid(g));
    expect(verticalXs(p)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(horizontalYs(p)).toEqual([0, 10, 20, 30, 40, 50, 60]);
  });

  it('every == pitch puts every line in the major tier', () => {
    const g = createBuildVolume(RECT, { gridMajor: { every: 10, opacity: 0.5 } });
    expect(positions(minorGrid(g))).toEqual([]);
    expect(verticalXs(positions(child<LineSegments>(g, 'gridMajor')!))).toHaveLength(11);
  });

  it.each([
    [25, [0, 30, 60, 90]], // 2.5 pitches → round → 3
    [24, [0, 20, 40, 60, 80, 100]], // 2.4 → 2
    [4, [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]], // below one pitch → at least 1
    [0.1 * 3 * 100, [0, 30, 60, 90]] // 30.000000000000004: float drift rounds away
  ])('every %s snaps to whole pitches → majors at %j', (every, xs) => {
    const g = createBuildVolume(RECT, { gridMajor: { every, opacity: 0.5 } });
    expect(verticalXs(positions(child<LineSegments>(g, 'gridMajor')!))).toEqual(xs);
  });

  it('a grid-pitch change never throws: every 50 on a 15 mm grid → majors every 45 mm', () => {
    const g = createBuildVolume({ x: 100, y: 60, z: 50, grid: 15 }, { gridMajor: { every: 50, opacity: 0.5 } });
    expect(verticalXs(positions(child<LineSegments>(g, 'gridMajor')!))).toEqual([0, 45, 90]);
  });

  it('dedupes by integer index on a 0.1 mm pitch (no float equality)', () => {
    const g = createBuildVolume({ x: 1, y: 0.5, z: 1, grid: 0.1 }, { gridMajor: { every: 0.5, opacity: 0.5 } });
    const majors = verticalXs(positions(child<LineSegments>(g, 'gridMajor')!));
    const minors = verticalXs(positions(minorGrid(g)));
    expect(majors).toHaveLength(3); // k = 0, 5, 10
    expect(minors).toHaveLength(8);
    expect(majors.length + minors.length).toBe(11);
  });

  it.each([
    [0, 'gridMajor.every must be a positive number (got 0)'],
    [-50, 'gridMajor.every must be a positive number (got -50)'],
    [NaN, 'gridMajor.every must be a positive number (got NaN)'],
    [Infinity, 'gridMajor.every must be a positive number (got Infinity)']
  ])('a direct style with every %s → RangeError', (every, message) => {
    const run = () => createBuildVolume(RECT, { gridMajor: { every, opacity: 0.5 } });
    expect(run).toThrow(RangeError);
    expect(run).toThrow(message);
  });

  it('non-rect beds clip both tiers to the outline', () => {
    const g = createBuildVolume(
      {
        x: 100,
        y: 100,
        z: 50,
        grid: 10,
        shape: {
          kind: 'polygon',
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 0, y: 100 }
          ]
        }
      },
      { gridMajor: { every: 50, opacity: 0.5 } }
    );
    const major = positions(child<LineSegments>(g, 'gridMajor')!);
    // x = 50 runs from y 0 to the hypotenuse at y 50; x = 0 sits on the edge; x = 100 touches only a vertex.
    expect(verticalXs(major)).toContain(50);
    for (let i = 0; i < major.length; i += 3) expect(major[i] + major[i + 1]).toBeLessThanOrEqual(100 + 1e-6);
    expect(verticalXs(positions(minorGrid(g)))).not.toContain(50);
  });
});

describe('bed outline', () => {
  it('rect: the true bed edge loop when set, renderOrder 1, above the grid', () => {
    const g = createBuildVolume(
      { x: 256, y: 250, z: 50, grid: 10, min: { x: 2, y: 3 } },
      {
        gridColor: 0x00ff00,
        bedOutline: { opacity: 0.8 }
      }
    );
    const loop = child<LineLoop>(g, 'bedOutline')!;
    expect(positions(loop).map((v) => Math.round(v * 1000) / 1000)).toEqual([
      2, 3, 0.01, 258, 3, 0.01, 258, 253, 0.01, 2, 253, 0.01
    ]);
    expect(loop.renderOrder).toBe(1);
    const m = loop.material as LineBasicMaterial;
    expect(m.opacity).toBe(0.8);
    expect(m.color.getHex()).toBe(0x00ff00);
    expect(g.children.indexOf(loop)).toBeGreaterThan(g.children.indexOf(minorGrid(g)));
  });

  it('a set outline is transparent even at opacity 1, so its renderOrder holds', () => {
    const g = createBuildVolume(RECT, { bedOutline: { opacity: 1 } });
    expect((child<LineLoop>(g, 'bedOutline')!.material as LineBasicMaterial).transparent).toBe(true);
  });

  it('rect: with an outline set, grid lines on the bed edge and the cage floor are not drawn', () => {
    const style: BuildVolumeStyle = { gridMajor: { every: 50, opacity: 0.5 }, bedOutline: { opacity: 0.8 } };
    const g = createBuildVolume(RECT, style);
    expect(verticalXs(positions(minorGrid(g)))).toEqual([10, 20, 30, 40, 60, 70, 80, 90]);
    expect(horizontalYs(positions(minorGrid(g)))).toEqual([10, 20, 30, 40]);
    expect(verticalXs(positions(child<LineSegments>(g, 'gridMajor')!))).toEqual([50]);
    expect(horizontalYs(positions(child<LineSegments>(g, 'gridMajor')!))).toEqual([50]);
    const cage = positions(child<LineSegments>(g, 'volumeCage')!);
    expect(cage).toHaveLength(8 * 6); // 4 top edges + 4 verticals, no floor
    for (let i = 0; i < cage.length; i += 6) expect(cage[i + 2] === 0 && cage[i + 5] === 0).toBe(false);
  });

  it('rect unset: no loop, edge grid lines and the cage floor as today', () => {
    const g = createBuildVolume(RECT);
    expect(child(g, 'bedOutline')).toBeUndefined();
    expect(positions(child<LineSegments>(g, 'volumeCage')!)).toHaveLength(12 * 6);
    expect(verticalXs(positions(minorGrid(g)))).toContain(100);
  });

  it('non-rect: with an outline set, grid runs on the bed edge are left to the outline', () => {
    const tri: BuildVolumeDef = {
      x: 100,
      y: 100,
      z: 50,
      grid: 10,
      shape: {
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 0, y: 100 }
        ]
      }
    };
    expect(verticalXs(positions(minorGrid(createBuildVolume(tri))))).toContain(0);
    const g = createBuildVolume(tri, { bedOutline: { opacity: 0.8 } });
    expect(verticalXs(positions(minorGrid(g)))).not.toContain(0);
    expect(horizontalYs(positions(minorGrid(g)))).not.toContain(0);
    expect(verticalXs(positions(minorGrid(g)))).toContain(10);
  });

  const circle: BuildVolumeDef = {
    x: 100,
    y: 100,
    z: 50,
    shape: { kind: 'circular', center: { x: 50, y: 50 }, diameter: 100 }
  };

  it("non-rect unset: today's loop (grid color, opacity +0.3, renderOrder 0)", () => {
    const loop = child<LineLoop>(createBuildVolume(circle, { gridColor: 0x00ff00, gridOpacity: 0.2 }), 'bedOutline')!;
    const m = loop.material as LineBasicMaterial;
    expect(m.opacity).toBeCloseTo(0.5, 10);
    expect(m.color.getHex()).toBe(0x00ff00);
    expect(loop.renderOrder).toBe(0);
  });

  it('non-rect set: the themed color/opacity and renderOrder 1', () => {
    const loop = child<LineLoop>(
      createBuildVolume(circle, { gridColor: 0x00ff00, bedOutline: { opacity: 0.9, color: 0x0000ff } }),
      'bedOutline'
    )!;
    const m = loop.material as LineBasicMaterial;
    expect(m.opacity).toBe(0.9);
    expect(m.color.getHex()).toBe(0x0000ff);
    expect(loop.renderOrder).toBe(1);
    expect(positions(loop)).toHaveLength(96 * 3);
  });
});

describe('slab plate', () => {
  const solid = { mode: 'solid' as const, color: 0x7c8086, edgeColor: 0x585c61, thickness: 4 };

  it('thickness > 0: walls down from z −0.05 by the thickness in edgeColor; top face unchanged', () => {
    const g = createBuildVolume({ x: 10, y: 20, z: 5 }, { bedSurface: solid });
    const edge = child<Mesh>(g, 'bedSurfaceEdge')!;
    const top = child<Mesh>(g, 'bedSurface')!;
    const p = positions(edge);
    expect(p).toHaveLength(4 * 2 * 3 * 3);
    const zs = new Set<number>();
    for (let i = 2; i < p.length; i += 3) zs.add(Math.round(p[i] * 1000) / 1000);
    expect([...zs].sort((a, b) => a - b)).toEqual([-4.05, -0.05]);
    // First wall runs along y = 0 from x 0 to x 10.
    expect(p.slice(0, 9).map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0, -0.05, 10, 0, -0.05, 10, 0, -4.05]);
    const em = edge.material as MeshBasicMaterial;
    expect(em.type).toBe('MeshBasicMaterial');
    expect(em.color.getHex()).toBe(0x585c61);
    expect(em.depthWrite).toBe(false);
    const tm = top.material as MeshBasicMaterial;
    expect(tm.type).toBe('MeshBasicMaterial');
    expect(tm.color.getHex()).toBe(0x7c8086);
    expect(tm.depthWrite).toBe(false);
    const tz = positions(top).filter((_, i) => i % 3 === 2);
    expect(new Set(tz.map((v) => Math.round(v * 1000) / 1000))).toEqual(new Set([-0.05]));
  });

  it('draw order is explicit: walls −2, top −1', () => {
    const g = createBuildVolume({ x: 10, y: 20, z: 5 }, { bedSurface: solid });
    expect(child<Mesh>(g, 'bedSurfaceEdge')!.renderOrder).toBe(-2);
    expect(child<Mesh>(g, 'bedSurface')!.renderOrder).toBe(-1);
  });

  it('edgeColor defaults to the plate color', () => {
    const g = createBuildVolume(
      { x: 10, y: 20, z: 5 },
      { bedSurface: { mode: 'solid', color: 0x112233, thickness: 2 } }
    );
    expect((child<Mesh>(g, 'bedSurfaceEdge')!.material as MeshBasicMaterial).color.getHex()).toBe(0x112233);
  });

  it('thickness 0 or unset: no walls (flat plane as today)', () => {
    expect(child(createBuildVolume(RECT, { bedSurface: { mode: 'solid' } }), 'bedSurfaceEdge')).toBeUndefined();
    expect(
      child(createBuildVolume(RECT, { bedSurface: { mode: 'solid', thickness: 0 } }), 'bedSurfaceEdge')
    ).toBeUndefined();
  });

  it('non-rect beds extrude their shape', () => {
    const tri = {
      kind: 'polygon' as const,
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 0, y: 40 }
      ]
    };
    const g = createBuildVolume({ x: 30, y: 40, z: 5, shape: tri }, { bedSurface: solid });
    const p = positions(child<Mesh>(g, 'bedSurfaceEdge')!);
    expect(p).toHaveLength(3 * 2 * 3 * 3);
    // The closing wall runs from (0,40) back to (0,0).
    expect(p.slice(36, 42).map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 40, -0.05, 0, 0, -0.05]);
  });

  it('a texture goes on the top face only, sampled as sRGB', () => {
    const canvas = document.createElement('canvas');
    const g = createBuildVolume({ x: 10, y: 20, z: 5 }, { bedSurface: { ...solid, texture: canvas } });
    expect((child<Mesh>(g, 'bedSurface')!.material as MeshBasicMaterial).map?.colorSpace).toBe(SRGBColorSpace);
    expect((child<Mesh>(g, 'bedSurfaceEdge')!.material as MeshBasicMaterial).map).toBeNull();
  });
});

describe('createBackdrop', () => {
  it('first row = bottom color, last row = top color (DataTexture row 0 is v = 0)', () => {
    const b = createBackdrop({ top: '#23272e', bottom: '#2b3038' });
    const t = b.texture;
    expect(t).toBeInstanceOf(DataTexture);
    expect(t.image.width).toBe(1);
    expect(t.image.height).toBe(256);
    const d = t.image.data as Uint8Array;
    expect(Array.from(d.slice(0, 4))).toEqual([0x2b, 0x30, 0x38, 255]);
    expect(Array.from(d.slice(255 * 4, 256 * 4))).toEqual([0x23, 0x27, 0x2e, 255]);
    // Midpoint row 128 of 0..255: 0x2b + (0x23-0x2b)·128/255 = 38.98 → 39.
    expect(d[128 * 4]).toBe(39);
  });

  it('sRGB, linear-filtered, no mipmaps, flagged for upload', () => {
    const t = createBackdrop({ top: 0xffffff, bottom: 0x000000 }).texture;
    expect(t.colorSpace).toBe(SRGBColorSpace);
    expect(t.magFilter).toBe(LinearFilter);
    expect(t.minFilter).toBe(LinearFilter);
    expect(t.generateMipmaps).toBe(false);
    expect(t.version).toBeGreaterThan(0);
  });

  it('dispose() disposes the texture', () => {
    const b = createBackdrop({ top: 0xffffff, bottom: 0x000000 });
    let disposed = 0;
    b.texture.addEventListener('dispose', () => disposed++);
    b.dispose();
    expect(disposed).toBe(1);
  });
});

describe('createContactShadow', () => {
  const fp = { min: { x: 10, y: 20 }, max: { x: 30, y: 60 } };

  it('a decal 1.4× the footprint, centred on it, at z −0.04, black, transparent, no depth write', () => {
    const m = createContactShadow(fp, 0.4)!;
    expect(m.name).toBe('contactShadow');
    expect(CONTACT_SHADOW_Z).toBe(-0.04);
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!;
    expect([bb.min.x, bb.max.x, bb.min.y, bb.max.y].map((v) => Math.round(v * 1000) / 1000)).toEqual([6, 34, 12, 68]);
    expect(Math.round(bb.min.z * 1000) / 1000).toBe(-0.04);
    expect(Math.round(bb.max.z * 1000) / 1000).toBe(-0.04);
    const mat = m.material as MeshBasicMaterial;
    expect(mat.color.getHex()).toBe(0x000000);
    expect(mat.opacity).toBe(0.4);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(m.renderOrder).toBe(-0.5);
  });

  it('radial alpha: opaque centre, zero at the edge/corners; linear filter, no mipmaps', () => {
    const tex = (createContactShadow(fp, 0.3)!.material as MeshBasicMaterial).map as DataTexture;
    expect(tex.image.width).toBe(64);
    expect(tex.image.height).toBe(64);
    const d = tex.image.data as Uint8Array;
    const a = (x: number, y: number): number => d[(y * 64 + x) * 4 + 3];
    expect(a(0, 0)).toBe(0);
    expect(a(63, 63)).toBe(0);
    expect(a(0, 32)).toBe(0);
    expect(a(32, 32)).toBe(255);
    expect(a(31, 31)).toBe(255);
    expect(d[(32 * 64 + 32) * 4]).toBe(0);
    expect(tex.magFilter).toBe(LinearFilter);
    expect(tex.minFilter).toBe(LinearFilter);
    expect(tex.generateMipmaps).toBe(false);
    expect(tex.version).toBeGreaterThan(0);
  });

  it('hidden (null) with no content or no area', () => {
    expect(createContactShadow(null, 0.4)).toBeNull();
    expect(createContactShadow({ min: { x: 0, y: 0 }, max: { x: 0, y: 10 } }, 0.4)).toBeNull();
    expect(createContactShadow({ min: { x: 0, y: 0 }, max: { x: 10, y: 0 } }, 0.4)).toBeNull();
  });
});
