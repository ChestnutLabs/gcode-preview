/*
 * renderStill → ToolpathRenderer option wiring (G3 sweep, 2026-11-12). The renderer module is mocked with
 * a subclass that records its constructor options (and can rewrite events), so each forwarded option,
 * the geometry-pool defaults and the `background: 'transparent'` alpha context are asserted literally.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  GeometryBuildRequest,
  GeometryWorkerLike,
  GLRendererLike,
  RenderTargetCanvas,
  ToolpathRendererOptions
} from '@chestnutlabs/gcode-renderer-three';
import type { MachineGeometry } from '@chestnutlabs/toolpath-core';

const captured: ToolpathRendererOptions[] = [];
const hooks: { decimation: number | null; moveCamera: boolean } = { decimation: null, moveCamera: false };
const glCalls: { alpha?: boolean; preserveDrawingBuffer?: boolean }[] = [];

vi.mock('@chestnutlabs/gcode-renderer-three', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@chestnutlabs/gcode-renderer-three')>();
  class CapturingRenderer extends mod.ToolpathRenderer {
    constructor(opts: ToolpathRendererOptions) {
      captured.push(opts);
      super(opts);
    }
    override onEvent(cb: Parameters<InstanceType<typeof mod.ToolpathRenderer>['onEvent']>[0]): () => void {
      return super.onEvent((e) => {
        // moveCamera: something moved the camera while the build ran (e.g. a stray control call).
        if (e.type === 'buildComplete' && hooks.moveCamera) this.camera.position.set(1, 1, 1);
        if (e.type === 'buildComplete' && hooks.decimation !== null) cb({ ...e, decimationApplied: hooks.decimation });
        else cb(e);
      });
    }
  }
  return {
    ...mod,
    ToolpathRenderer: CapturingRenderer,
    createDefaultGLRenderer: (canvas: RenderTargetCanvas, o: { alpha?: boolean; preserveDrawingBuffer?: boolean }) => {
      glCalls.push(o);
      return stubGL(canvas);
    }
  };
});

function stubGL(canvas: RenderTargetCanvas): GLRendererLike {
  return { render: () => undefined, setSize: () => undefined, dispose: () => undefined, domElement: canvas };
}

const { renderStill } = await import('../render-still.js');
const three = await import('@chestnutlabs/gcode-renderer-three');
const { makeTestIR } = await import('../testing.js');

function canvas(): RenderTargetCanvas {
  return {
    width: 64,
    height: 48,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  } as unknown as RenderTargetCanvas;
}

/** Render once and return the options the renderer was constructed with. */
async function optsFor(extra: Record<string, unknown>): Promise<ToolpathRendererOptions> {
  captured.length = 0;
  await renderStill(makeTestIR(), { canvas: canvas(), createRenderer: stubGL, ...extra });
  expect(captured).toHaveLength(1);
  return captured[0];
}

beforeEach(() => {
  hooks.decimation = null;
  hooks.moveCamera = false;
  glCalls.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('renderStill → ToolpathRenderer wiring', () => {
  it('always builds without per-tick renders, with a preserved buffer and microtask scheduling', async () => {
    const o = await optsFor({});
    expect(o.renderDuringBuild).toBe(false);
    expect(o.preserveDrawingBuffer).toBe(true);
    expect(o.quality).toBe('auto');
    let ran = false;
    o.scheduleFrame?.(() => {
      ran = true;
    });
    expect(ran).toBe(false); // deferred, not synchronous
    await Promise.resolve();
    expect(ran).toBe(true); // a microtask, not a frame
  });

  it('omits every optional key it was not given', async () => {
    const o = await optsFor({ geometryConcurrency: 'off' });
    for (const key of [
      'cameraMode',
      'cameraFov',
      'frameContent',
      'theme',
      'colorMode',
      'tube',
      'tubeByteBudget',
      'qualityMode',
      'buildVolume',
      'geometryConcurrency',
      'createGeometryWorker',
      'coreBudget',
      'geometryMemoryBudgetBytes'
    ]) {
      expect(Object.prototype.hasOwnProperty.call(o, key), key).toBe(false);
    }
  });

  it('forwards each renderer option literally', async () => {
    const o = await optsFor({
      quality: 'tubes',
      cameraMode: 'orthographic',
      cameraFov: 42,
      frameContent: 'object',
      theme: { gridOpacity: 0.3 },
      colorMode: { mode: 'single', color: [1, 0, 0] },
      tube: { radialSegments: 5 },
      tubeByteBudget: 12345,
      qualityMode: 'full',
      buildVolume: { x: 200, y: 210, z: 220 }
    });
    expect(o.quality).toBe('tubes');
    expect(o.cameraMode).toBe('orthographic');
    expect(o.cameraFov).toBe(42);
    expect(o.frameContent).toBe('object');
    expect(o.theme).toEqual({ gridOpacity: 0.3 });
    expect(o.colorMode).toEqual({ mode: 'single', color: [1, 0, 0] });
    expect(o.tube).toEqual({ radialSegments: 5 });
    expect(o.tubeByteBudget).toBe(12345);
    expect(o.qualityMode).toBe('full');
    expect(o.buildVolume).toEqual({ x: 200, y: 210, z: 220 });
    expect(o.createRenderer).toBe(stubGL);
  });

  it('converts a MachineGeometry bed into a renderer volume', async () => {
    const machine: MachineGeometry = {
      bed: { kind: 'rect', min: { x: 5, y: 6 }, max: { x: 105, y: 206 } },
      heightMm: 150
    } as MachineGeometry;
    const o = await optsFor({ buildVolume: machine });
    expect(o.buildVolume).toMatchObject({ x: 100, y: 200, z: 150, min: { x: 5, y: 6 } });
  });

  it('merges a solid background into the theme, keeping the other theme fields', async () => {
    expect((await optsFor({ background: '#112233' })).theme).toEqual({ background: '#112233' });
    expect((await optsFor({ background: '#112233', theme: { gridOpacity: 0.3 } })).theme).toEqual({
      gridOpacity: 0.3,
      background: '#112233'
    });
    expect(
      (await optsFor({ background: '#112233', theme: { gridOpacity: 0.3, background: '#445566' } })).theme
    ).toEqual({ gridOpacity: 0.3, background: '#445566' });
    // 'transparent' is not a colour: the theme passes through untouched.
    expect((await optsFor({ background: 'transparent', theme: { gridOpacity: 0.3 } })).theme).toEqual({
      gridOpacity: 0.3
    });
  });

  it("'transparent' without createRenderer makes an alpha, preserved GL context; an explicit one wins", async () => {
    captured.length = 0;
    await renderStill(makeTestIR(), { canvas: canvas(), background: 'transparent' });
    expect(glCalls).toEqual([{ alpha: true, preserveDrawingBuffer: true }]);
    expect(typeof captured[0].createRenderer).toBe('function');

    glCalls.length = 0;
    const o = await optsFor({ background: 'transparent' }); // optsFor passes createRenderer: stubGL
    expect(o.createRenderer).toBe(stubGL);
    expect(glCalls).toEqual([]);

    // A solid colour (and no background) leaves the renderer's own default GL backend in place.
    // (The renderer's real default needs a WebGL canvas, so the construction itself fails here; the
    // options were captured first.)
    captured.length = 0;
    await renderStill(makeTestIR(), { canvas: canvas(), background: '#112233', createRenderer: undefined }).catch(
      () => undefined
    );
    expect(glCalls).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(captured[0], 'createRenderer')).toBe(false);
  });
});

describe('renderStill geometry-pool defaults (DD-028)', () => {
  /** A synchronous in-process geometry worker (the real request handler), so a pooled build completes. */
  const worker = (): GeometryWorkerLike => {
    const w: GeometryWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage: (msg: GeometryBuildRequest) => {
        const { response } = three.handleGeometryRequest(msg);
        queueMicrotask(() => w.onmessage?.({ data: response }));
      },
      terminate: () => undefined
    };
    return w;
  };

  it("with no Worker global and no factory, sends no pool options (even for 'auto' or a number)", async () => {
    vi.stubGlobal('Worker', undefined);
    for (const geometryConcurrency of [undefined, 'auto', 3]) {
      const o = await optsFor({ geometryConcurrency, coreBudget: 2, geometryMemoryBudgetBytes: 99 });
      expect(o.geometryConcurrency).toBeUndefined();
      expect(o.createGeometryWorker).toBeUndefined();
      expect(o.coreBudget).toBeUndefined();
      expect(o.geometryMemoryBudgetBytes).toBeUndefined();
    }
  });

  it("with a Worker global, defaults to 'auto' and the browser geometry worker", async () => {
    vi.stubGlobal('Worker', class {});
    const o = await optsFor({});
    expect(o.geometryConcurrency).toBe('auto');
    expect(o.createGeometryWorker).toBe(three.createBrowserGeometryWorker);
    expect(Object.prototype.hasOwnProperty.call(o, 'coreBudget')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(o, 'geometryMemoryBudgetBytes')).toBe(false);
  });

  it('an injected factory wins over the browser default and carries the budgets', async () => {
    vi.stubGlobal('Worker', class {});
    const o = await optsFor({
      geometryConcurrency: 3,
      createGeometryWorker: worker,
      coreBudget: 2,
      geometryMemoryBudgetBytes: 99
    });
    expect(o.geometryConcurrency).toBe(3);
    expect(o.createGeometryWorker).toBe(worker);
    expect(o.coreBudget).toBe(2);
    expect(o.geometryMemoryBudgetBytes).toBe(99);
  });

  it("'off' sends no pool options even with a factory and a Worker global", async () => {
    vi.stubGlobal('Worker', class {});
    const o = await optsFor({ geometryConcurrency: 'off', createGeometryWorker: worker, coreBudget: 2 });
    expect(o.geometryConcurrency).toBeUndefined();
    expect(o.createGeometryWorker).toBeUndefined();
    expect(o.coreBudget).toBeUndefined();
  });
});

describe('renderStill framing', () => {
  /** GL stub recording the camera position of every render. */
  function positionsGL(): { gl: (c: RenderTargetCanvas) => GLRendererLike; last: () => number[] } {
    const seen: number[][] = [];
    return {
      gl: (c: RenderTargetCanvas) => ({
        ...stubGL(c),
        render: (_scene?: unknown, camera?: unknown) => {
          const p = (camera as { position: { x: number; y: number; z: number } }).position;
          seen.push([p.x, p.y, p.z]);
        }
      }),
      last: () => seen[seen.length - 1]
    };
  }

  it('re-frames after the build: the final still is the bounds framing even if the camera moved meanwhile', async () => {
    const clean = positionsGL();
    await renderStill(makeTestIR(), { canvas: canvas(), createRenderer: clean.gl });
    hooks.moveCamera = true;
    const moved = positionsGL();
    await renderStill(makeTestIR(), { canvas: canvas(), createRenderer: moved.gl });
    expect(moved.last()).not.toEqual([1, 1, 1]);
    expect(moved.last()).toEqual(clean.last());
  });
});

describe('renderStill result', () => {
  it("reports the build's decimationApplied", async () => {
    hooks.decimation = 4;
    const r = await renderStill(makeTestIR(), { canvas: canvas(), createRenderer: stubGL });
    expect(r.decimationApplied).toBe(4);
  });
});
