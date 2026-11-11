// @vitest-environment happy-dom
/**
 * DD-032 Lane B, core: the lens (`renderer.cameraFov` + `setCameraFov`, D2 synchronous range check, D3
 * kept across rebinds, 2D disclosure), `renderStill`'s `cameraFov` (pose.fov beats it), the Studio
 * re-exports, and background precedence on stills. Literal expected values.
 */
import { describe, expect, it } from 'vitest';
import type { GLRendererLike, RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { createPreviewController, renderStill, studioTheme, STUDIO_CAMERA_FOV, type PreviewEvent } from '../index';
import { SuiteStubWorker, makeSuiteStubGL } from '../testing';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

/** A 20 × 20 mm square perimeter at z 0.2, (50, 50)–(70, 70): center (60, 60, 0.2), radius √200. */
function squareIR(): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  const p: [number, number][] = [
    [50, 50],
    [70, 50],
    [70, 70],
    [50, 70],
    [50, 50]
  ];
  for (let i = 0; i < 4; i++) {
    b.addSegment({
      x0: p[i][0],
      y0: p[i][1],
      z0: 0.2,
      x1: p[i + 1][0],
      y1: p[i + 1][1],
      z1: 0.2,
      e: 1,
      kind: MoveKind.Extrude,
      layer: 0,
      srcByte: i * 10
    });
  }
  return b.finalize();
}

type Lens = { cameraFov: number };
const lensOf = (r: unknown): number => (r as Lens).cameraFov;

function controller(cameraFov?: number) {
  return createPreviewController({
    createWorker: () => new SuiteStubWorker(),
    renderer: {
      quality: 'lines',
      ...(cameraFov !== undefined ? { cameraFov } : {}),
      createRenderer: (c) => makeSuiteStubGL(c as HTMLCanvasElement),
      scheduleFrame: (cb) => cb()
    }
  });
}

describe('controller lens (DD-032 §4.2)', () => {
  it('re-exports the Studio preset and its lens', () => {
    expect(STUDIO_CAMERA_FOV).toBe(32);
    expect(studioTheme('dark').background).toEqual({ top: '#23272e', bottom: '#2b3038' });
  });

  it('renderer.cameraFov reaches the 3D renderer', async () => {
    const c = controller(32);
    c.bindCanvas(document.createElement('canvas'));
    await settle();
    expect(lensOf(c.raw.renderer())).toBe(32);
    c.dispose();
  });

  it.each([9, 9.5, 9.9999, 120.0001, 120.5, 121, NaN])(
    'renderer.cameraFov %s throws RangeError at construction',
    (fov) => {
      expect(() => controller(fov)).toThrow(RangeError);
      expect(() => controller(fov)).toThrow(`fov must be in [10, 120] degrees (got ${String(fov)})`);
    }
  );

  it('setCameraFov throws synchronously before the 3D renderer has loaded, and queues a valid lens', async () => {
    const c = controller();
    c.bindCanvas(document.createElement('canvas'));
    expect(c.raw.renderer()).toBeNull(); // the 3D load is still pending
    expect(() => c.controls.setCameraFov(5)).toThrow(RangeError);
    c.controls.setCameraFov(40);
    await settle();
    expect(lensOf(c.raw.renderer())).toBe(40);
    c.dispose();
  });

  it('accepts the range ends 10 and 120', async () => {
    const c = controller();
    c.bindCanvas(document.createElement('canvas'));
    await settle();
    c.controls.setCameraFov(10);
    expect(lensOf(c.raw.renderer())).toBe(10);
    c.controls.setCameraFov(120);
    expect(lensOf(c.raw.renderer())).toBe(120);
    c.dispose();
  });

  it('a canvas rebind keeps the last lens (setCameraFov, and the construction option)', async () => {
    const c = controller(20);
    c.bindCanvas(document.createElement('canvas'));
    await settle();
    c.bindCanvas(document.createElement('canvas'));
    await settle();
    expect(lensOf(c.raw.renderer())).toBe(20);
    c.controls.setCameraFov(32);
    c.bindCanvas(null);
    c.bindCanvas(document.createElement('canvas'));
    await settle();
    expect(lensOf(c.raw.renderer())).toBe(32);
    c.dispose();
  });

  it('a rejected setCameraFov does not replace the remembered lens', async () => {
    const c = controller(20);
    c.bindCanvas(document.createElement('canvas'));
    await settle();
    expect(() => c.controls.setCameraFov(200)).toThrow(RangeError);
    c.bindCanvas(document.createElement('canvas'));
    await settle();
    expect(lensOf(c.raw.renderer())).toBe(20);
    c.dispose();
  });

  it('the 2D renderer discloses the lens as renderer-unsupported (a documented parity difference)', () => {
    const c = createPreviewController({ createWorker: () => new SuiteStubWorker(), renderer: { mode: '2d' } });
    const canvas = document.createElement('canvas');
    (canvas as unknown as { getContext: () => unknown }).getContext = () => null;
    const events: PreviewEvent[] = [];
    c.onEvent((e) => events.push(e));
    c.bindCanvas(canvas);
    c.controls.setCameraFov(32);
    const u = events.find((e) => e.type === 'renderer-unsupported') as { feature?: string } | undefined;
    expect(u?.feature).toBe('camera');
    expect(() => c.controls.setCameraFov(5)).toThrow(RangeError);
    c.dispose();
  });
});

interface Seen {
  background: unknown;
  shadow: boolean;
  fov: number;
  position: { x: number; y: number; z: number };
}
/** GL stub recording the last rendered scene background, shadow presence and camera. */
function probeGL(): { gl: (c: RenderTargetCanvas) => GLRendererLike; last: () => Seen } {
  let last: Seen | null = null;
  return {
    gl: (canvas) => ({
      render: (scene?: unknown, camera?: unknown) => {
        const s = scene as { background: unknown; getObjectByName(n: string): unknown };
        const cam = camera as { fov: number; position: { x: number; y: number; z: number } };
        last = {
          background: s.background,
          shadow: s.getObjectByName('contactShadow') !== undefined,
          fov: cam.fov,
          position: { x: cam.position.x, y: cam.position.y, z: cam.position.z }
        };
      },
      setSize: () => undefined,
      dispose: () => undefined,
      domElement: canvas
    }),
    last: () => last!
  };
}
const stubCanvas = (): RenderTargetCanvas =>
  ({
    width: 320,
    height: 240,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }) as unknown as RenderTargetCanvas;

describe('renderStill lens + background precedence (DD-032)', () => {
  // printer (60, 60, 0.2) → scene (x, z, −y)
  const target = { x: 60, y: 0.2, z: -60 };
  const R = Math.hypot(10, 10);
  const dist = (p: Seen['position']): number => Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z);

  it.each([
    [10, 202.817],
    [32, 61.882],
    [120, 18.57]
  ])('cameraFov %s frames the sphere inside the view (distance %s)', async (fov, distance) => {
    const p = probeGL();
    await renderStill(squareIR(), { canvas: stubCanvas(), cameraFov: fov, createRenderer: p.gl });
    expect(p.last().fov).toBe(fov);
    expect(dist(p.last().position)).toBeCloseTo(distance, 2);
    expect((Math.asin(R / dist(p.last().position)) * 180) / Math.PI).toBeLessThan(fov / 2);
  });

  it('cameraFov 50 frames exactly like no cameraFov', async () => {
    const a = probeGL();
    const b = probeGL();
    await renderStill(squareIR(), { canvas: stubCanvas(), createRenderer: a.gl });
    await renderStill(squareIR(), { canvas: stubCanvas(), cameraFov: 50, createRenderer: b.gl });
    expect(b.last().position).toEqual(a.last().position);
    expect(b.last().fov).toBe(50);
  });

  it('an explicit pose.fov beats cameraFov; a pose without fov keeps cameraFov', async () => {
    const pose = { position: [0, 100, 100] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
    const a = probeGL();
    await renderStill(squareIR(), {
      canvas: stubCanvas(),
      cameraFov: 32,
      camera: { ...pose, fov: 40 },
      createRenderer: a.gl
    });
    expect(a.last().fov).toBe(40);
    const b = probeGL();
    await renderStill(squareIR(), { canvas: stubCanvas(), cameraFov: 32, camera: pose, createRenderer: b.gl });
    expect(b.last().fov).toBe(32);
  });

  it.each([9, 9.9999, 120.0001, 121])(
    'cameraFov %s rejects with RangeError before any parse or GL work',
    async (fov) => {
      let made = 0;
      const workers0 = SuiteStubWorker.created;
      await expect(
        renderStill(new Uint8Array([0x47, 0x31]), {
          canvas: stubCanvas(),
          cameraFov: fov,
          createWorker: () => new SuiteStubWorker(),
          createRenderer: (c) => {
            made++;
            return probeGL().gl(c);
          }
        })
      ).rejects.toThrow(`fov must be in [10, 120] degrees (got ${fov})`);
      expect(SuiteStubWorker.created - workers0).toBe(0);
      expect(made).toBe(0);
    }
  );

  it("the theme's gradient beats the background option", async () => {
    const p = probeGL();
    await renderStill(squareIR(), {
      canvas: stubCanvas(),
      theme: studioTheme('dark'),
      background: '#123',
      createRenderer: p.gl
    });
    const bg = p.last().background as { isDataTexture?: boolean };
    expect(bg.isDataTexture).toBe(true);
  });

  it('the cutout recipe { ...studioTheme, background: null } + transparent: no gradient; the shadow follows the plate', async () => {
    const cutout = { theme: { ...studioTheme('dark'), background: null }, background: 'transparent' as const };
    // A still cutout omits the build volume, and the shadow belongs to the plate: no grey blob.
    const p = probeGL();
    await renderStill(squareIR(), { canvas: stubCanvas(), ...cutout, createRenderer: p.gl });
    expect(p.last().background).toBeNull();
    expect(p.last().shadow).toBe(false);
    // The same recipe WITH a plate keeps the shadow: the background never decides it, the plate does.
    const q = probeGL();
    await renderStill(squareIR(), {
      canvas: stubCanvas(),
      ...cutout,
      buildVolume: { x: 200, y: 200, z: 200 },
      createRenderer: q.gl
    });
    expect(q.last().background).toBeNull();
    expect(q.last().shadow).toBe(true);
  });

  it('with a build volume the Studio still carries its contact shadow (it belongs to the plate)', async () => {
    const p = probeGL();
    await renderStill(squareIR(), {
      canvas: stubCanvas(),
      theme: studioTheme('light'),
      buildVolume: { x: 200, y: 200, z: 200 },
      createRenderer: p.gl
    });
    expect(p.last().shadow).toBe(true);
  });
});
