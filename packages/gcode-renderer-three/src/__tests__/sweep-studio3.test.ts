// @vitest-environment happy-dom
/**
 * renderer-three sweep 3: the DD-032 Studio primitives (theme checks, backdrop, contact shadow, build
 * volume tiers/outline/walls, dispose walk), the stage lens/framing helpers, the capability classifier,
 * the GPU probe, the render-cost estimate, and the chunk color buffer. Each test pins a clause a source
 * mutant used to survive. Expected values are literal, never the module's own constants.
 */
import { describe, expect, it } from 'vitest';
import {
  BufferGeometry,
  DoubleSide,
  Group,
  type LineBasicMaterial,
  type LineLoop,
  type LineSegments,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type MeshBasicMaterial as MBM
} from 'three';
import { MoveKind, ToolpathIRBuilder } from '@chestnutlabs/toolpath-core';
import {
  DEFAULT_THEME,
  buildChunkColors,
  classifyRenderer,
  createBackdrop,
  createBuildVolume,
  createContactShadow,
  createDefaultGLRenderer,
  detectRenderCapability,
  disposeBuildVolume,
  lensScale,
  probeGpuInfo,
  resolveTheme,
  studioTheme,
  type BuildVolumeDef,
  type GeometryChunk,
  type GLRendererLike,
  type Theme
} from '../index.js';
import { POOL_ENGAGE_MS, SINGLE_REVEAL_MS, estimateTubeBuildMs } from '../render-cost.js';
import { supportsCapture } from '../stage.js';

const child = <T>(g: Group, name: string): T | undefined => g.children.find((c) => c.name === name) as T | undefined;
const positions = (o: { geometry: BufferGeometry }): number[] =>
  Array.from(o.geometry.getAttribute('position').array as Float32Array);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
/** Unnamed grid LineSegments (the minor tier). */
const minorGrid = (g: Group): LineSegments =>
  g.children.find((c) => (c as LineSegments).isLineSegments && c.name === '') as LineSegments;
/** [y, xFrom, xTo] of each horizontal (constant-y) segment, sorted. */
const horizontals = (p: number[]): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < p.length; i += 6) {
    if (p[i + 1] === p[i + 4]) out.push([r3(p[i + 1]), r3(Math.min(p[i], p[i + 3])), r3(Math.max(p[i], p[i + 3]))]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
};
const verticalXs = (p: number[]): number[] => {
  const xs = new Set<number>();
  for (let i = 0; i < p.length; i += 6) if (p[i] === p[i + 3]) xs.add(r3(p[i]));
  return [...xs].sort((a, b) => a - b);
};

describe('resolveTheme value checks (sweep 3)', () => {
  it.each([
    [{ hemisphereIntensity: Number.NaN }, 'theme hemisphereIntensity must be a finite number >= 0 (got NaN)'],
    [{ hemisphereIntensity: -1 }, 'theme hemisphereIntensity must be a finite number >= 0 (got -1)'],
    [{ hemisphereIntensity: Infinity }, 'theme hemisphereIntensity must be a finite number >= 0 (got Infinity)'],
    [{ directionalIntensity: Number.NaN }, 'theme directionalIntensity must be a finite number >= 0 (got NaN)'],
    [{ directionalIntensity: -0.5 }, 'theme directionalIntensity must be a finite number >= 0 (got -0.5)'],
    [{ directionalIntensity: -Infinity }, 'theme directionalIntensity must be a finite number >= 0 (got -Infinity)'],
    [{ bedSurface: { mode: 'solid', opacity: 1.5 } }, 'theme bedSurface.opacity must be a number in [0,1] (got 1.5)'],
    [
      { bedSurface: { mode: 'solid', opacity: Number.NaN } },
      'theme bedSurface.opacity must be a number in [0,1] (got NaN)'
    ],
    [{ bedSurface: { mode: 'solid', opacity: -0.1 } }, 'theme bedSurface.opacity must be a number in [0,1] (got -0.1)'],
    [
      { bedSurface: { mode: 'solid', thickness: -2 } },
      'theme bedSurface.thickness must be a finite number >= 0 (got -2)'
    ],
    [
      { bedSurface: { mode: 'solid', thickness: Number.NaN } },
      'theme bedSurface.thickness must be a finite number >= 0 (got NaN)'
    ],
    [
      { bedSurface: { mode: 'solid', thickness: Infinity } },
      'theme bedSurface.thickness must be a finite number >= 0 (got Infinity)'
    ],
    [{ bedSurface: { mode: 'solidd' } }, "theme bedSurface.mode must be one of 'none', 'solid' (got solidd)"],
    [{ bedSurface: {} }, "theme bedSurface.mode must be one of 'none', 'solid' (got undefined)"],
    [{ materialPreset: 'shiny' }, "theme materialPreset must be one of 'matte', 'glossy' (got shiny)"]
  ])('rejects %j with a RangeError', (theme, message) => {
    const run = (): unknown => resolveTheme(theme as unknown as Theme);
    expect(run).toThrow(RangeError);
    expect(run).toThrow(message);
  });

  it('accepts the bounds: intensities and thickness 0, plate opacity 0 and 1, both modes and presets', () => {
    expect(resolveTheme({ hemisphereIntensity: 0, directionalIntensity: 0 })).toMatchObject({
      hemisphereIntensity: 0,
      directionalIntensity: 0
    });
    expect(resolveTheme({ bedSurface: { mode: 'solid', opacity: 0, thickness: 0 } }).bedSurface).toEqual({
      mode: 'solid',
      opacity: 0,
      thickness: 0
    });
    expect(resolveTheme({ bedSurface: { mode: 'none', opacity: 1 } }).bedSurface).toEqual({ mode: 'none', opacity: 1 });
    expect(resolveTheme({ materialPreset: 'glossy' }).materialPreset).toBe('glossy');
    expect(resolveTheme({ materialPreset: 'matte' }).materialPreset).toBe('matte');
  });

  it("AnyBridge's two theme shapes resolve unchanged (colour strings are not checked here)", () => {
    expect(resolveTheme({ background: '#1e2228', bedSurface: { mode: 'solid', opacity: 0.9 } })).toEqual({
      background: '#1e2228',
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
      bedSurface: { mode: 'solid', opacity: 0.9 }
    });
    const none = resolveTheme({ background: '#f4f5f7', bedSurface: { mode: 'none' } });
    expect(none.background).toBe('#f4f5f7');
    expect(none.bedSurface).toEqual({ mode: 'none' });
    expect(none.gridOpacity).toBe(0.35);
  });

  it('every shipped preset passes its own checks (DEFAULT_THEME and both Studio modes)', () => {
    const d = DEFAULT_THEME;
    expect(() =>
      resolveTheme({
        background: d.background,
        gridColor: d.gridColor,
        gridOpacity: d.gridOpacity,
        bedColor: d.bedColor,
        hemisphereIntensity: d.hemisphereIntensity,
        directionalIntensity: d.directionalIntensity,
        materialPreset: d.materialPreset,
        bedSurface: d.bedSurface
      })
    ).not.toThrow();
    for (const mode of ['dark', 'light'] as const) {
      const r = resolveTheme(studioTheme(mode));
      expect(r.bedSurface).toEqual({ mode: 'solid', color: '#7c8086', thickness: 4, edgeColor: '#585c61' });
    }
  });
});

describe('createContactShadow guards (sweep 3)', () => {
  const fp = { min: { x: 10, y: 20 }, max: { x: 30, y: 60 } };

  it.each([Number.NaN, -0.1, 1.1, Infinity])('opacity %s → RangeError (an option)', (opacity) => {
    expect(() => createContactShadow(fp, opacity)).toThrow(RangeError);
    expect(() => createContactShadow(fp, opacity)).toThrow(
      `contactShadow opacity must be a number in [0,1] (got ${String(opacity)})`
    );
    // Checked even with no footprint: a bad option is never hidden by an empty plate.
    expect(() => createContactShadow(null, opacity)).toThrow(RangeError);
  });

  it('opacity 0 and 1 are accepted', () => {
    expect((createContactShadow(fp, 0)!.material as MBM).opacity).toBe(0);
    expect((createContactShadow(fp, 1)!.material as MBM).opacity).toBe(1);
  });

  it.each([
    [{ min: { x: 0, y: 0 }, max: { x: Infinity, y: 10 } }],
    [{ min: { x: -Infinity, y: 0 }, max: { x: 10, y: 10 } }],
    [{ min: { x: 0, y: 0 }, max: { x: 10, y: Infinity } }],
    [{ min: { x: 0, y: -Infinity }, max: { x: 10, y: 10 } }],
    [{ min: { x: Number.NaN, y: 0 }, max: { x: 10, y: 10 } }],
    [{ min: { x: -1e308, y: 0 }, max: { x: 1e308, y: 10 } }],
    [{ min: { x: 0, y: -1e308 }, max: { x: 10, y: 1e308 } }]
  ])('a non-finite footprint %j (file data) draws nothing', (footprint) => {
    expect(createContactShadow(footprint, 0.4)).toBeNull();
  });

  it('the decal is double-sided (visible from under the plate)', () => {
    expect((createContactShadow(fp, 0.4)!.material as MBM).side).toBe(DoubleSide);
  });
});

describe('createBackdrop ramp ends (sweep 3)', () => {
  it('the last row is exactly top even over a full 0..255 span', () => {
    const d = createBackdrop({ top: 0xffffff, bottom: 0x000000 }).texture.image.data as Uint8Array;
    expect(Array.from(d.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(d.slice(255 * 4, 256 * 4))).toEqual([255, 255, 255, 255]);
    expect(Array.from(d.slice(254 * 4, 255 * 4))).toEqual([254, 254, 254, 255]);
  });
});

describe('build volume (sweep 3)', () => {
  const RECT: BuildVolumeDef = { x: 100, y: 60, z: 50, grid: 10 };
  /** A 100 × 60 rectangle drawn as a polygon bed: takes the clipped (non-rect) path. */
  const SQUARE_POLY: BuildVolumeDef = {
    x: 100,
    y: 60,
    z: 50,
    grid: 10,
    shape: {
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 60 },
        { x: 0, y: 60 }
      ]
    }
  };

  it('an opaque line stays opaque (cage at boxOpacity 1)', () => {
    const g = createBuildVolume(RECT, { boxOpacity: 1 });
    expect((child<LineSegments>(g, 'volumeCage')!.material as LineBasicMaterial).transparent).toBe(false);
    expect(
      (child<LineSegments>(createBuildVolume(RECT), 'volumeCage')!.material as LineBasicMaterial).transparent
    ).toBe(true);
  });

  it('rect: a set outline uses its own colour', () => {
    const g = createBuildVolume(RECT, { gridColor: 0x00ff00, bedOutline: { color: 0xff0000, opacity: 0.8 } });
    expect((child<LineLoop>(g, 'bedOutline')!.material as LineBasicMaterial).color.getHex()).toBe(0xff0000);
  });

  it('polygon: major lines take the major colour and opacity, not the minor ones', () => {
    const g = createBuildVolume(SQUARE_POLY, {
      gridColor: 0x00ff00,
      gridOpacity: 0.2,
      gridMajor: { every: 50, opacity: 0.7, color: 0x0000ff }
    });
    const m = child<LineSegments>(g, 'gridMajor')!.material as LineBasicMaterial;
    expect(m.color.getHex()).toBe(0x0000ff);
    expect(m.opacity).toBe(0.7);
  });

  it('polygon: a set outline is transparent even at opacity 1', () => {
    const g = createBuildVolume(SQUARE_POLY, { bedOutline: { opacity: 1 } });
    expect((child<LineLoop>(g, 'bedOutline')!.material as LineBasicMaterial).transparent).toBe(true);
  });

  it('polygon: horizontal lines are split into tiers too (major y 50; minor 10..40)', () => {
    const g = createBuildVolume(SQUARE_POLY, { gridMajor: { every: 50, opacity: 0.5 }, bedOutline: { opacity: 0.8 } });
    const major = positions(child<LineSegments>(g, 'gridMajor')!);
    expect(horizontals(major)).toEqual([[50, 0, 100]]);
    expect(verticalXs(major)).toEqual([50]);
    expect(horizontals(positions(minorGrid(g))).map((h) => h[0])).toEqual([10, 20, 30, 40]);
  });

  it('polygon edge test is clamped to the edge: an edge extension does not hide an interior run', () => {
    // An L-shaped bed. The notch edge (100,30)→(50,30) extended to x < 50 runs along the interior grid
    // line y = 30; that run (x 0..50) is inside the bed and must be drawn. The x 50..100 run lies ON the
    // notch edge, so the outline draws it instead.
    const L: BuildVolumeDef = {
      x: 100,
      y: 60,
      z: 50,
      grid: 10,
      shape: {
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 30 },
          { x: 50, y: 30 },
          { x: 50, y: 60 },
          { x: 0, y: 60 }
        ]
      }
    };
    const g = createBuildVolume(L, { bedOutline: { opacity: 0.8 } });
    expect(horizontals(positions(minorGrid(g))).filter((h) => h[0] === 30)).toEqual([[30, 0, 50]]);
  });

  it('polygon edge tolerance is 1e-6 mm: a run 0.5 mm off an edge is still drawn', () => {
    const notch: BuildVolumeDef = {
      x: 100,
      y: 60,
      z: 50,
      grid: 10,
      shape: {
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 30.5 },
          { x: 50, y: 30.5 },
          { x: 50, y: 60 },
          { x: 0, y: 60 }
        ]
      }
    };
    const g = createBuildVolume(notch, { bedOutline: { opacity: 0.8 } });
    expect(horizontals(positions(minorGrid(g))).filter((h) => h[0] === 30)).toEqual([[30, 0, 100]]);
  });

  it('a repeated polygon point (zero-length edge) changes nothing', () => {
    const pts = (SQUARE_POLY.shape as { points: { x: number; y: number }[] }).points;
    const dup: BuildVolumeDef = {
      ...SQUARE_POLY,
      shape: { kind: 'polygon', points: [pts[0], pts[1], pts[1], pts[2], pts[3]] }
    };
    const style = { bedOutline: { opacity: 0.8 } };
    expect(positions(minorGrid(createBuildVolume(dup, style)))).toEqual(
      positions(minorGrid(createBuildVolume(SQUARE_POLY, style)))
    );
  });

  it('slab walls take the plate opacity', () => {
    const g = createBuildVolume(
      { x: 10, y: 20, z: 5 },
      { bedSurface: { mode: 'solid', color: 0x112233, opacity: 0.5, thickness: 2 } }
    );
    const m = child<Mesh>(g, 'bedSurfaceEdge')!.material as MBM;
    expect(m.opacity).toBe(0.5);
    expect(m.transparent).toBe(true);
  });

  it('no major tier: every line is minor (no gridMajor child)', () => {
    const g = createBuildVolume(RECT);
    expect(child(g, 'gridMajor')).toBeUndefined();
    expect(verticalXs(positions(minorGrid(g)))).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it('disposeBuildVolume frees every material of a multi-material mesh, and its map', () => {
    const g = new Group();
    const mats = [new MeshBasicMaterial(), new MeshBasicMaterial()];
    const geom = new BufferGeometry();
    g.add(new Mesh(geom, mats as Material[]));
    const freed: string[] = [];
    mats.forEach((m, i) => m.addEventListener('dispose', () => freed.push(`mat${i}`)));
    geom.addEventListener('dispose', () => freed.push('geom'));
    disposeBuildVolume(g);
    expect(freed.sort()).toEqual(['geom', 'mat0', 'mat1']);
  });
});

describe('stage helpers (sweep 3)', () => {
  it('lensScale is from/to: 50° → 32° backs off by tan25°/tan16°', () => {
    expect(lensScale(50, 32)).toBeCloseTo(1.62622, 4);
    expect(lensScale(32, 50)).toBeCloseTo(0.61492, 4);
    expect(lensScale(50, 50)).toBe(1);
  });

  it.each([
    [5, 50, 'fov must be in [10, 120] degrees (got 5)'],
    [50, 130, 'fov must be in [10, 120] degrees (got 130)'],
    [Number.NaN, 50, 'fov must be in [10, 120] degrees (got NaN)'],
    [50, Number.NaN, 'fov must be in [10, 120] degrees (got NaN)']
  ])('lensScale(%s, %s) → RangeError', (from, to, message) => {
    expect(() => lensScale(from, to)).toThrow(RangeError);
    expect(() => lensScale(from, to)).toThrow(message);
  });

  it('supportsCapture needs BOTH render-to-target and readback', () => {
    const base = {
      render: () => undefined,
      setSize: () => undefined,
      dispose: () => undefined
    } as unknown as GLRendererLike;
    expect(supportsCapture({ ...base, setRenderTarget: () => undefined } as GLRendererLike)).toBe(false);
    expect(supportsCapture({ ...base, readRenderTargetPixels: () => undefined } as GLRendererLike)).toBe(false);
    expect(
      supportsCapture({
        ...base,
        setRenderTarget: () => undefined,
        readRenderTargetPixels: () => undefined
      } as GLRendererLike)
    ).toBe(true);
  });

  /** A minimal WebGL2 context (as in studio-wiring.test.ts) that records the attributes three asks for. */
  function glCanvas(seen: Record<string, unknown>[]): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    const params: Record<number, unknown> = {
      0x1f02: 'WebGL 2.0',
      0x8b8c: 'WebGL GLSL ES 3.00',
      0x0ba2: new Int32Array([0, 0, 1, 1]),
      0x0c10: new Int32Array([0, 0, 1, 1])
    };
    const named: Record<string, number> = {
      VERSION: 0x1f02,
      SHADING_LANGUAGE_VERSION: 0x8b8c,
      VIEWPORT: 0x0ba2,
      SCISSOR_BOX: 0x0c10
    };
    const consts = new Map<string, number>();
    const target: Record<string | symbol, unknown> = { canvas, drawingBufferWidth: 1, drawingBufferHeight: 1 };
    const gl = new Proxy(target, {
      get(t, p) {
        if (p in t) return t[p];
        if (p === 'getParameter') return (k: number) => params[k] ?? 16;
        if (p === 'getContextAttributes') return () => ({ alpha: false, antialias: true });
        if (p === 'getSupportedExtensions') return () => [];
        if (p === 'getShaderPrecisionFormat') return () => ({ precision: 23, rangeMin: 127, rangeMax: 127 });
        if (p === 'getShaderParameter' || p === 'getProgramParameter') return () => true;
        if (p === 'isContextLost') return () => false;
        if (p === 'getProgramInfoLog' || p === 'getShaderInfoLog') return () => '';
        if (typeof p === 'string' && /^[A-Z_0-9]+$/.test(p)) {
          if (named[p] !== undefined) return named[p];
          if (!consts.has(p)) consts.set(p, 0x100000 + consts.size);
          return consts.get(p);
        }
        return () => ({});
      }
    });
    (canvas as unknown as { getContext: (id: string, a: Record<string, unknown>) => unknown }).getContext = (id, a) => {
      if (id !== 'webgl2') return null;
      seen.push(a);
      return gl;
    };
    return canvas;
  }

  it('createDefaultGLRenderer defaults: antialias on, no preserved buffer, opaque clear', () => {
    const seen: Record<string, unknown>[] = [];
    const gl = createDefaultGLRenderer(glCanvas(seen));
    expect(seen[0]).toMatchObject({ antialias: true, preserveDrawingBuffer: false });
    expect(gl.getClearAlpha()).toBe(1);
    gl.dispose();
    const seen2: Record<string, unknown>[] = [];
    const gl2 = createDefaultGLRenderer(glCanvas(seen2), {
      antialias: false,
      preserveDrawingBuffer: true,
      alpha: true
    });
    expect(seen2[0]).toMatchObject({ antialias: false, preserveDrawingBuffer: true });
    expect(gl2.getClearAlpha()).toBe(0);
    gl2.dispose();
  });
});

describe('classifyRenderer markers, each on its own (sweep 3)', () => {
  // A literal copy of the marker lists: a sample must hit exactly ONE marker, so dropping that marker
  // flips its classification.
  const SW = [
    'swiftshader',
    'llvmpipe',
    'basic render driver',
    'software rasterizer',
    'microsoft basic render',
    'softpipe',
    'lavapipe'
  ];
  const HW = [
    'nvidia',
    'geforce',
    'quadro',
    'radeon',
    'amd ',
    'intel',
    'apple',
    'adreno',
    'mali',
    'powervr',
    'mesa',
    'iris',
    'metal',
    'directx',
    'd3d11',
    'vega',
    'rtx',
    'gtx'
  ];
  const SOFTWARE = [
    'SwiftShader',
    'llvmpipe (LLVM 15)',
    'Basic Render Driver',
    'Software Rasterizer',
    'Microsoft Basic Render',
    'softpipe',
    'lavapipe'
  ];
  const HARDWARE = [
    'NVIDIA',
    'GeForce',
    'Quadro P1000',
    'Radeon',
    'AMD FirePro',
    'Intel',
    'Apple',
    'Adreno 650',
    'Mali-G78',
    'PowerVR',
    'Mesa',
    'Iris',
    'Metal',
    'DirectX',
    'D3D11',
    'Vega 8',
    'RTX',
    'GTX'
  ];
  const hits = (s: string): string[] => [...SW, ...HW].filter((m) => s.toLowerCase().includes(m));

  it.each(SOFTWARE)('%s → software', (s) => {
    expect(hits(s)).toHaveLength(1);
    expect(classifyRenderer(s)).toBe('software');
  });

  it.each(HARDWARE)('%s → hardware', (s) => {
    expect(hits(s)).toHaveLength(1);
    expect(classifyRenderer(s)).toBe('hardware');
  });

  it("is case-insensitive, needs no trim, and 'radeonsi' is covered by 'radeon'", () => {
    expect(classifyRenderer('GENERIC AMD ')).toBe('hardware');
    expect(classifyRenderer('AMD Radeon (radeonsi, navi21)')).toBe('hardware');
    expect(classifyRenderer('radeonsi')).toBe('hardware');
    expect(classifyRenderer('')).toBe('unknown');
    expect(classifyRenderer('   ')).toBe('unknown');
    expect(classifyRenderer(undefined)).toBe('unknown');
  });

  it('detectRenderCapability: a non-string renderer (a String object) is blind, not classified', () => {
    const gl = {
      getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 1 }),
      getParameter: () => new String('NVIDIA GeForce') as unknown as string
    };
    expect(detectRenderCapability(gl)).toEqual({ capability: 'unknown', rawRenderer: null });
    expect(detectRenderCapability({ getExtension: () => undefined, getParameter: () => 'NVIDIA' })).toEqual({
      capability: 'unknown',
      rawRenderer: null
    });
  });
});

describe('probeGpuInfo edges (sweep 3)', () => {
  const ext = { UNMASKED_RENDERER_WEBGL: 0x9246, UNMASKED_VENDOR_WEBGL: 0x9245 };
  const ctx = (renderer: unknown, vendor: unknown, withExt = true) => ({
    getExtension: () => (withExt ? ext : undefined),
    getParameter: (p: number) => (p === 0x9246 ? renderer : p === 0x9245 ? vendor : null)
  });

  it('webglVersion is null when the renderer reports no capabilities', () => {
    expect(probeGpuInfo({ getContext: () => ctx('NVIDIA', 'NV') }).webglVersion).toBeNull();
  });

  it('an absent (undefined) extension keeps the WebGL version and reports blind GPU strings', () => {
    expect(probeGpuInfo({ getContext: () => ctx('NVIDIA', 'NV', false), capabilities: { isWebGL2: true } })).toEqual({
      webglVersion: 2,
      capability: 'unknown',
      gpuRenderer: null,
      gpuVendor: null
    });
  });

  it('empty or non-string renderer/vendor strings are null, never fabricated', () => {
    const r = probeGpuInfo({ getContext: () => ctx('', ''), capabilities: { isWebGL2: true } });
    expect(r).toEqual({ webglVersion: 2, capability: 'unknown', gpuRenderer: null, gpuVendor: null });
    const s = probeGpuInfo({
      getContext: () => ctx(new String('NVIDIA'), new String('NV')),
      capabilities: { isWebGL2: false }
    });
    expect(s).toEqual({ webglVersion: 1, capability: 'unknown', gpuRenderer: null, gpuVendor: null });
    const v = probeGpuInfo({ getContext: () => ctx('NVIDIA', 7), capabilities: { isWebGL2: true } });
    expect(v).toEqual({ webglVersion: 2, capability: 'hardware', gpuRenderer: 'NVIDIA', gpuVendor: null });
  });

  it('a getContext that is not a function, or returns undefined, is unknown', () => {
    const unknown = { webglVersion: null, capability: 'unknown', gpuRenderer: null, gpuVendor: null };
    expect(probeGpuInfo({ getContext: 'nope' })).toEqual(unknown);
    expect(probeGpuInfo({ getContext: () => undefined })).toEqual(unknown);
    expect(probeGpuInfo(null)).toEqual(unknown);
  });
});

describe('render-cost literals (sweep 3)', () => {
  it('ring vertices × 445 ns, ×3 on software; thresholds 250 ms', () => {
    // 1000 segments × (8 + 1) ring vertices × 445 ns = 4.005 ms.
    expect(estimateTubeBuildMs(1000, 8, 'hardware')).toBeCloseTo(4.005, 9);
    expect(estimateTubeBuildMs(1000, 8, 'unknown')).toBeCloseTo(4.005, 9);
    expect(estimateTubeBuildMs(1000, 8, 'software')).toBeCloseTo(12.015, 9);
    expect(estimateTubeBuildMs(1000, 0, 'hardware')).toBeCloseTo(0.445, 9);
    expect(POOL_ENGAGE_MS).toBe(250);
    expect(SINGLE_REVEAL_MS).toBe(250);
  });
});

describe('buildChunkColors layout (sweep 3)', () => {
  it('both vertices of a segment get the same r, g, b', () => {
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    for (let s = 0; s < 2; s++) {
      b.addSegment({
        x0: s,
        y0: 0,
        z0: 0.2,
        x1: s + 1,
        y1: 0,
        z1: 0.2,
        e: 1,
        kind: MoveKind.Extrude,
        layer: 0,
        srcByte: s
      });
    }
    const ir = b.finalize();
    const chunk: GeometryChunk = {
      kind: 'extrude',
      layerStart: 0,
      layerEnd: 0,
      count: 2,
      positions: new Float32Array(12),
      segIndices: Uint32Array.from([0, 1])
    };
    const c = buildChunkColors(ir, chunk, {
      mode: 'colorChange',
      palette: [[0.25, 0.5, 0.75]],
      fallback: [0.25, 0.5, 0.75]
    });
    expect(Array.from(c)).toEqual([0.25, 0.5, 0.75, 0.25, 0.5, 0.75, 0.25, 0.5, 0.75, 0.25, 0.5, 0.75]);
  });
});
