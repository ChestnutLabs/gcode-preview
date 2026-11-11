// @vitest-environment happy-dom
/**
 * DD-032 Lane B: the toolpath scene wiring — gradient backdrop, contact shadow, lens (`cameraFov`) and
 * the §4.4 output pin (no tone mapping, sRGB out). Literal expected values, never module constants.
 */
import { describe, expect, it } from 'vitest';
import { type DataTexture, type Group, type Mesh, type MeshBasicMaterial, type Scene, Vector3 } from 'three';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import {
  ToolpathRenderer,
  createDefaultGLRenderer,
  studioTheme,
  type GLRendererLike,
  type RendererEvent,
  type Theme,
  type ToolpathRendererOptions
} from '../index.js';

/** A 20 × 20 mm square perimeter at z 0.2, from (50, 50) to (70, 70). */
function squareIR(): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  const pts: [number, number][] = [
    [50, 50],
    [70, 50],
    [70, 70],
    [50, 70],
    [50, 50]
  ];
  for (let i = 0; i < 4; i++) {
    b.addSegment({
      x0: pts[i][0],
      y0: pts[i][1],
      z0: 0.2,
      x1: pts[i + 1][0],
      y1: pts[i + 1][1],
      z1: 0.2,
      e: 1,
      kind: MoveKind.Extrude,
      layer: 0,
      srcByte: i * 10
    });
  }
  return b.finalize();
}

function make(opts: Partial<ToolpathRendererOptions> = {}): ToolpathRenderer {
  const canvas = document.createElement('canvas');
  const stub: GLRendererLike = {
    render: () => undefined,
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: canvas
  };
  return new ToolpathRenderer({
    canvas,
    quality: 'lines',
    createRenderer: () => stub,
    scheduleFrame: () => undefined,
    ...opts
  });
}

const sceneOf = (r: ToolpathRenderer): Scene => (r as unknown as { scene: Scene }).scene;
const volumeOf = (r: ToolpathRenderer): Group | null => (r as unknown as { volumeGroup: Group | null }).volumeGroup;
const shadowOf = (r: ToolpathRenderer): Mesh | undefined =>
  sceneOf(r).getObjectByName('contactShadow') as Mesh | undefined;
/** Resolves true once `obj` fires three's `dispose` event. */
function watchDispose(obj: { addEventListener(type: 'dispose', cb: () => void): void }): () => boolean {
  let disposed = false;
  obj.addEventListener('dispose', () => {
    disposed = true;
  });
  return () => disposed;
}
const VOLUME = { x: 200, y: 200, z: 200 };

describe('gradient backdrop', () => {
  it('a { top, bottom } background becomes an sRGB 1×256 ramp, row 0 = bottom', () => {
    const r = make({ theme: studioTheme('dark') });
    const tex = sceneOf(r).background as DataTexture;
    expect(tex.isDataTexture).toBe(true);
    expect(tex.colorSpace).toBe('srgb');
    expect([tex.image.width, tex.image.height]).toEqual([1, 256]);
    const d = tex.image.data as Uint8Array;
    expect(Array.from(d.slice(0, 4))).toEqual([0x2b, 0x30, 0x38, 255]); // bottom #2b3038
    expect(Array.from(d.slice(255 * 4, 256 * 4))).toEqual([0x23, 0x27, 0x2e, 255]); // top #23272e
  });

  it('solid and null backgrounds are unchanged', () => {
    const solid = make({ theme: { background: 0x112233 } });
    expect((sceneOf(solid).background as unknown as { getHex(): number }).getHex()).toBe(0x112233);
    expect(sceneOf(make()).background).toBeNull();
    expect(sceneOf(make({ theme: { ...studioTheme('dark'), background: null } })).background).toBeNull();
  });

  it('setTheme disposes the previous ramp (gradient → gradient → solid → none)', () => {
    const r = make({ theme: studioTheme('dark') });
    const first = sceneOf(r).background as DataTexture;
    const firstGone = watchDispose(first);
    r.setTheme(studioTheme('light'));
    expect(firstGone()).toBe(true);
    const second = sceneOf(r).background as DataTexture;
    expect(second).not.toBe(first);
    expect(Array.from((second.image.data as Uint8Array).slice(0, 4))).toEqual([0xc9, 0xce, 0xd5, 255]);
    const secondGone = watchDispose(second);
    r.setTheme({ background: '#123456' });
    expect(secondGone()).toBe(true);
    expect((sceneOf(r).background as unknown as { getHex(): number }).getHex()).toBe(0x123456);
    r.setTheme({});
    expect(sceneOf(r).background).toBeNull();
  });

  it('dispose() frees the ramp', () => {
    const r = make({ theme: studioTheme('light') });
    const gone = watchDispose(sceneOf(r).background as DataTexture);
    r.dispose();
    expect(gone()).toBe(true);
  });
});

describe('contact shadow', () => {
  it('is a child of the build-volume group, sized from the footprint × 1.4, at z −0.04, order −0.5', () => {
    const r = make({ buildVolume: VOLUME, theme: studioTheme('dark') });
    r.setIR(squareIR());
    const s = shadowOf(r)!;
    expect(s.parent).toBe(volumeOf(r));
    expect(s.renderOrder).toBe(-0.5);
    expect((s.material as MeshBasicMaterial).opacity).toBe(0.4);
    s.geometry.computeBoundingBox();
    const bb = s.geometry.boundingBox!;
    const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;
    expect([bb.min.x, bb.min.y, bb.max.x, bb.max.y].map(r4)).toEqual([46, 46, 74, 74]);
    expect(r4(bb.min.z)).toBe(-0.04);
  });

  it('footprint precedence: modelBounds → objectBounds → bounds (independent of frameContent)', () => {
    const base = squareIR();
    const box = (x0: number, x1: number) => ({ min: { x: x0, y: x0, z: 0 }, max: { x: x1, y: x1, z: 1 } });
    const width = (ir: ToolpathIR): number => {
      const r = make({ buildVolume: VOLUME, theme: studioTheme('dark') });
      r.setIR(ir);
      const g = shadowOf(r)!.geometry;
      g.computeBoundingBox();
      return Math.round((g.boundingBox!.max.x - g.boundingBox!.min.x) * 1e4) / 1e4;
    };
    expect(width({ ...base, modelBounds: box(0, 10), objectBounds: box(0, 30) })).toBe(14);
    expect(width({ ...base, objectBounds: box(0, 30) })).toBe(42);
    expect(width(base)).toBe(28);
  });

  it('is absent without a volume, without theme.contactShadow, and before any IR', () => {
    const noVolume = make({ theme: studioTheme('dark') });
    noVolume.setIR(squareIR());
    expect(shadowOf(noVolume)).toBeUndefined();
    const noShadowTheme = make({ buildVolume: VOLUME, theme: { ...studioTheme('dark'), contactShadow: undefined } });
    noShadowTheme.setIR(squareIR());
    expect(shadowOf(noShadowTheme)).toBeUndefined();
    expect(shadowOf(make({ buildVolume: VOLUME, theme: studioTheme('dark') }))).toBeUndefined();
  });

  it('follows the volume and theme: setBuildVolume rebuilds it, setTheme without it removes it', () => {
    const r = make({ theme: studioTheme('dark') });
    r.setIR(squareIR());
    expect(shadowOf(r)).toBeUndefined();
    r.setBuildVolume(VOLUME);
    expect(shadowOf(r)!.parent).toBe(volumeOf(r));
    r.setTheme(studioTheme('light'));
    expect((shadowOf(r)!.material as MeshBasicMaterial).opacity).toBe(0.3);
    r.setTheme({});
    expect(shadowOf(r)).toBeUndefined();
  });

  it('a new parse streaming over an old IR drops the stale shadow', () => {
    const r = make({ buildVolume: VOLUME, theme: studioTheme('dark') });
    r.setIR(squareIR());
    const old = shadowOf(r)!;
    const gone = watchDispose(old.geometry);
    r.appendPartial(squareIR());
    expect(shadowOf(r)).toBeUndefined();
    expect(gone()).toBe(true);
  });
});

describe('leak matrix: gradient + shadow × setTheme / setBuildVolume / dispose', () => {
  function tracked(r: ToolpathRenderer): { all: () => boolean[] } {
    const s = shadowOf(r)!;
    const mat = s.material as MeshBasicMaterial;
    const checks = [
      watchDispose(s.geometry),
      watchDispose(mat),
      watchDispose(mat.map!),
      watchDispose(sceneOf(r).background as DataTexture)
    ];
    return { all: () => checks.map((c) => c()) };
  }
  function studio(): ToolpathRenderer {
    const r = make({ buildVolume: VOLUME, theme: studioTheme('dark') });
    r.setIR(squareIR());
    return r;
  }

  it('setTheme frees shadow geometry, material, its map, and the ramp', () => {
    const r = studio();
    const t = tracked(r);
    r.setTheme(studioTheme('light'));
    expect(t.all()).toEqual([true, true, true, true]);
  });

  it('setBuildVolume frees the shadow (the ramp stays, it is not volume-owned)', () => {
    const r = studio();
    const t = tracked(r);
    r.setBuildVolume({ x: 250, y: 250, z: 250 });
    expect(t.all()).toEqual([true, true, true, false]);
    expect(shadowOf(r)).toBeDefined();
  });

  it('dispose frees all four', () => {
    const r = studio();
    const t = tracked(r);
    r.dispose();
    expect(t.all()).toEqual([true, true, true, true]);
  });
});

describe('lens (cameraFov)', () => {
  /** Distance camera → target, and the angular radius of the framed sphere vs the half-fov. */
  function framed(r: ToolpathRenderer): number {
    const s = r.getCameraState();
    return new Vector3(s.position.x, s.position.y, s.position.z).distanceTo(
      new Vector3(s.target.x, s.target.y, s.target.z)
    );
  }
  // squareIR: center (60, 60, 0.2), radius = |center − min| = hypot(10, 10) → max(10, 14.142136).
  const R = Math.hypot(10, 10);

  it('cameraFov 50 frames exactly like no cameraFov', () => {
    const a = make({ buildVolume: VOLUME });
    const b = make({ buildVolume: VOLUME, cameraFov: 50 });
    a.setIR(squareIR());
    b.setIR(squareIR());
    expect(b.getCameraState()).toEqual(a.getCameraState());
    expect(b.cameraFov).toBe(50);
  });

  it.each([
    [10, 202.817],
    [32, 61.882],
    [120, 18.57]
  ])('frame() at %s° keeps the framed sphere inside the view (distance %s)', (fov, distance) => {
    const r = make({ cameraFov: fov });
    r.setIR(squareIR());
    expect(r.cameraFov).toBe(fov);
    const d = framed(r);
    expect(Math.round(d * 1000) / 1000).toBeCloseTo(distance, 2);
    expect((Math.asin(R / d) * 180) / Math.PI).toBeLessThan(fov / 2);
  });

  it('setCameraFov dollies by the framingLensScale ratio and emits no camera-changed', () => {
    const r = make();
    r.setIR(squareIR());
    const events: RendererEvent['type'][] = [];
    r.onEvent((e) => events.push(e.type));
    const d50 = framed(r);
    r.setCameraFov(32);
    expect(framed(r) / d50).toBeCloseTo(1.626208, 5); // tan25/tan16
    expect(r.cameraFov).toBe(32);
    expect(events).not.toContain('camera-changed');
  });

  it.each([9, 121, NaN])('cameraFov %s → RangeError (option and setter), lens unchanged', (fov) => {
    expect(() => make({ cameraFov: fov })).toThrow(RangeError);
    const r = make();
    expect(() => r.setCameraFov(fov)).toThrow(RangeError);
    expect(r.cameraFov).toBe(50);
  });
});

describe('lens validation order', () => {
  it('an out-of-range cameraFov throws before any GL renderer is created (nothing to leak)', () => {
    let made = 0;
    const canvas = document.createElement('canvas');
    expect(
      () =>
        new ToolpathRenderer({
          canvas,
          cameraFov: 130,
          createRenderer: () => {
            made++;
            return { render: () => undefined, setSize: () => undefined, dispose: () => undefined, domElement: canvas };
          },
          scheduleFrame: () => undefined
        })
    ).toThrow('fov must be in [10, 120] degrees (got 130)');
    expect(made).toBe(0);
  });
});

describe('output pin (DD-032 §4.4): no tone mapping, sRGB output', () => {
  /** A minimal WebGL2 context: enough for three's WebGLRenderer to initialise in node. */
  function fakeGl(canvas: HTMLCanvasElement): unknown {
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
    return new Proxy(target, {
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
  }
  function glCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    (canvas as unknown as { getContext: (id: string) => unknown }).getContext = (id) =>
      id === 'webgl2' ? fakeGl(canvas) : null;
    return canvas;
  }

  it('the default GL renderer (opaque and alpha) keeps NoToneMapping (0) and srgb output', () => {
    for (const alpha of [false, true]) {
      const gl = createDefaultGLRenderer(glCanvas(), { alpha });
      expect(gl.toneMapping).toBe(0);
      expect(gl.outputColorSpace).toBe('srgb');
      gl.dispose();
    }
  });

  it('the toolpath viewer under the Studio theme does not change them', () => {
    // The real default GL renderer; only its draw call is stubbed (the fake context cannot link shaders).
    const r = new ToolpathRenderer({
      canvas: glCanvas(),
      quality: 'lines',
      theme: studioTheme('dark') as Theme,
      buildVolume: VOLUME,
      cameraFov: 32,
      createRenderer: (c) => {
        const gl = createDefaultGLRenderer(c);
        gl.render = () => undefined;
        return gl;
      },
      scheduleFrame: () => undefined
    });
    r.setIR(squareIR());
    const gl = (r as unknown as { stage: { gl: { toneMapping: number; outputColorSpace: string } } }).stage.gl;
    expect(gl.toneMapping).toBe(0);
    expect(gl.outputColorSpace).toBe('srgb');
    r.dispose();
  });
});
