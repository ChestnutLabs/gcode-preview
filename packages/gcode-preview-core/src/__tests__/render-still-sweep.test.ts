/*
 * renderStill mutation sweep (G3, 2026-11-12): the contract pinned clause by clause. Option rules
 * (RangeError before any parse or GL work), the bytes path (session teardown, parseOptions, what counts
 * as bytes), the explicit pose as the camera of the FINAL frame, the clip calls, the background merge and
 * the empty-IR guard. Headless: an injected GL backend records what each render saw.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolpathRenderer, type GLRendererLike, type RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';
import { ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { renderStill, type RenderStillOptions } from '../render-still.js';
import { makeTestIR, SuiteStubWorker } from '../testing.js';

function makeStubCanvas(width = 320, height = 240): RenderTargetCanvas {
  return {
    width,
    height,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  } as unknown as RenderTargetCanvas;
}

interface Frame {
  position: [number, number, number];
  fov: number | undefined;
  background: string | null;
}

/** GL stub that records the camera pose, lens and scene background of every render. */
function makeFrameProbeGL(): { gl: (c: RenderTargetCanvas) => GLRendererLike; frames: Frame[] } {
  const frames: Frame[] = [];
  return {
    gl: (canvas: RenderTargetCanvas) => ({
      render: (scene?: unknown, camera?: unknown) => {
        const cam = camera as { position: { x: number; y: number; z: number }; fov?: number };
        const bg = (scene as { background?: { getHexString?: () => string } | null }).background;
        frames.push({
          position: [cam.position.x, cam.position.y, cam.position.z],
          fov: cam.fov,
          background: bg && typeof bg.getHexString === 'function' ? bg.getHexString() : null
        });
      },
      setSize: () => undefined,
      dispose: () => undefined,
      domElement: canvas
    }),
    frames
  };
}

const base = (extra: Partial<RenderStillOptions> = {}): RenderStillOptions => ({
  canvas: makeStubCanvas(),
  createRenderer: makeFrameProbeGL().gl,
  ...extra
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderStill option rules: RangeError before any parse or GL work', () => {
  /** A worker factory that records whether a parse was ever started. */
  function spyWorker(): { create: () => SuiteStubWorker; created: () => number } {
    let n = 0;
    return {
      create: () => {
        n++;
        return new SuiteStubWorker();
      },
      created: () => n
    };
  }

  const bad: [string, Partial<RenderStillOptions>, string][] = [
    ['width NaN', { width: Number.NaN }, 'renderStill width must be a positive finite number (got NaN)'],
    ['width 0', { width: 0 }, 'renderStill width must be a positive finite number (got 0)'],
    ['width -1', { width: -1 }, 'renderStill width must be a positive finite number (got -1)'],
    ['width Infinity', { width: Infinity }, 'renderStill width must be a positive finite number (got Infinity)'],
    ['height 0', { height: 0 }, 'renderStill height must be a positive finite number (got 0)'],
    ['height NaN', { height: Number.NaN }, 'renderStill height must be a positive finite number (got NaN)'],
    [
      'pose fov 5',
      { camera: { position: [1, 2, 3], target: [0, 0, 0], fov: 5 } },
      'fov must be in [10, 120] degrees (got 5)'
    ],
    [
      'pose fov 121',
      { camera: { position: [1, 2, 3], target: [0, 0, 0], fov: 121 } },
      'fov must be in [10, 120] degrees (got 121)'
    ],
    [
      'pose position NaN',
      { camera: { position: [1, Number.NaN, 3], target: [0, 0, 0] } },
      'renderStill camera.position must be three finite numbers (got NaN at [1])'
    ],
    [
      'pose position short',
      { camera: { position: [1, 2] as unknown as [number, number, number], target: [0, 0, 0] } },
      'renderStill camera.position must be three finite numbers (got undefined at [2])'
    ],
    [
      'pose target Infinity',
      { camera: { position: [1, 2, 3], target: [Infinity, 0, 0] } },
      'renderStill camera.target must be three finite numbers (got Infinity at [0])'
    ],
    [
      'pose target string',
      { camera: { position: [1, 2, 3], target: [0, 0, '1' as unknown as number] } },
      'renderStill camera.target must be three finite numbers (got 1 at [2])'
    ],
    ['scrub NaN', { scrub: Number.NaN }, 'renderStill scrub needs a number that is not NaN (got NaN)'],
    ['scrub string', { scrub: '3' as unknown as number }, 'renderStill scrub needs a number that is not NaN (got 3)'],
    [
      'layerRange start NaN',
      { layerRange: [Number.NaN, 1] },
      'renderStill layerRange[0] needs a number that is not NaN (got NaN)'
    ],
    [
      'layerRange end NaN',
      { layerRange: [0, Number.NaN] },
      'renderStill layerRange[1] needs a number that is not NaN (got NaN)'
    ],
    ['cameraFov 9', { cameraFov: 9 }, 'fov must be in [10, 120] degrees (got 9)']
  ];

  for (const [label, extra, message] of bad) {
    it(`rejects ${label} with RangeError, before the worker or the renderer exists`, async () => {
      const worker = spyWorker();
      const ctor = vi.spyOn(ToolpathRenderer.prototype, 'setIR');
      const p = renderStill(new Uint8Array([0x47]), base({ ...extra, createWorker: worker.create }));
      await expect(p).rejects.toThrow(RangeError);
      await expect(p).rejects.toThrow(message);
      expect(worker.created()).toBe(0);
      expect(ctor).not.toHaveBeenCalled();
    });
  }

  it('takes the size from the canvas when width/height are omitted, so a 0×0 canvas is rejected', async () => {
    await expect(renderStill(makeTestIR(), base({ canvas: makeStubCanvas(0, 0) }))).rejects.toThrow(
      'renderStill width must be a positive finite number (got 0)'
    );
    await expect(renderStill(makeTestIR(), base({ canvas: makeStubCanvas(10, 0) }))).rejects.toThrow(
      'renderStill height must be a positive finite number (got 0)'
    );
  });

  it('accepts the boundary values: fov 10 and 120, ±Infinity clips, null scrub, a 1×1 still', async () => {
    for (const fov of [10, 120]) {
      const r = await renderStill(makeTestIR(), base({ camera: { position: [1, 2, 3], target: [0, 0, 0], fov } }));
      expect(r.segmentCount).toBe(12);
    }
    const clips = await renderStill(makeTestIR(), base({ layerRange: [-Infinity, Infinity], scrub: Infinity }));
    expect(clips.segmentCount).toBe(12);
    const nul = await renderStill(makeTestIR(), base({ scrub: null }));
    expect(nul.segmentCount).toBe(12);
    const tiny = await renderStill(makeTestIR(), base({ width: 1, height: 1 }));
    expect([tiny.width, tiny.height]).toEqual([1, 1]);
  });
});

describe('renderStill bytes path', () => {
  /** A stub worker that records parse messages and terminations; `fail` answers with a parse error. */
  function recordingWorker(fail = false): {
    create: () => SuiteStubWorker;
    opts: unknown[];
    terminated: () => number;
  } {
    const opts: unknown[] = [];
    let terminated = 0;
    class Recording extends SuiteStubWorker {
      override postMessage(msg: { type: string; id: number; opts?: unknown }): void {
        if (msg.type === 'parse') opts.push(msg.opts);
        if (fail && msg.type === 'parse') {
          queueMicrotask(() =>
            this.onmessage?.({
              data: { v: 1, type: 'error', id: msg.id, error: { code: 'E_PARSE_TEST', message: 'bad bytes' } }
            })
          );
          return;
        }
        super.postMessage(msg);
      }
      override terminate(): void {
        terminated++;
        super.terminate();
      }
    }
    return { create: () => new Recording(), opts, terminated: () => terminated };
  }

  it('parses an ArrayBuffer (parsed: true) and tears the session down', async () => {
    const w = recordingWorker();
    const r = await renderStill(new ArrayBuffer(4), base({ createWorker: w.create }));
    expect(r.parsed).toBe(true);
    expect(r.segmentCount).toBe(12);
    expect(w.terminated()).toBe(1);
  });

  it('forwards parseOptions to the parse, and sends {} when omitted', async () => {
    const w = recordingWorker();
    await renderStill(new Uint8Array([0x47]), base({ createWorker: w.create, parseOptions: { plate: 2 } }));
    await renderStill(new Uint8Array([0x47]), base({ createWorker: w.create }));
    expect(w.opts).toEqual([{ plate: 2 }, {}]);
  });

  it('rejects with the parse error and still tears the session down, without building', async () => {
    const w = recordingWorker(true);
    const setIR = vi.spyOn(ToolpathRenderer.prototype, 'setIR');
    await expect(renderStill(new Uint8Array([0x47]), base({ createWorker: w.create }))).rejects.toMatchObject({
      code: 'E_PARSE_TEST',
      message: 'bad bytes'
    });
    expect(w.terminated()).toBe(1);
    expect(setIR).not.toHaveBeenCalled();
  });

  it('treats a Uint8Array or ArrayBuffer as bytes even if it carries IR-shaped properties', async () => {
    for (const make of [() => new Uint8Array([0x47]), () => new ArrayBuffer(1)]) {
      const w = recordingWorker();
      const bytes = Object.assign(make(), { segments: {}, layers: [], header: {} });
      const r = await renderStill(bytes as unknown as Uint8Array, base({ createWorker: w.create }));
      expect(r.parsed).toBe(true);
      expect(w.opts).toHaveLength(1);
    }
  });

  it('parses an object missing any one of segments / layers / header instead of treating it as an IR', async () => {
    const ir = makeTestIR();
    for (const drop of ['segments', 'layers', 'header'] as const) {
      const w = recordingWorker();
      const partial: Record<string, unknown> = { segments: ir.segments, layers: ir.layers, header: ir.header };
      delete partial[drop];
      const r = await renderStill(partial as unknown as ToolpathIR, base({ createWorker: w.create }));
      expect(r.parsed, drop).toBe(true);
      expect(w.opts, drop).toHaveLength(1);
    }
  });

  it('treats an object with segments + layers + header as an IR (no parse)', async () => {
    const w = recordingWorker();
    const r = await renderStill(makeTestIR(), base({ createWorker: w.create }));
    expect(r.parsed).toBe(false);
    expect(w.opts).toHaveLength(0);
  });
});

describe('renderStill camera and clips', () => {
  it('renders the explicit pose (position and perspective fov) as the FINAL frame', async () => {
    const probe = makeFrameProbeGL();
    await renderStill(
      makeTestIR(),
      base({ createRenderer: probe.gl, camera: { position: [10, 20, 30], target: [0, 0, 0], fov: 35 } })
    );
    const last = probe.frames[probe.frames.length - 1];
    expect(last.position).toEqual([10, 20, 30]);
    expect(last.fov).toBe(35);
  });

  it('a pose without fov keeps cameraFov; an orthographic pose never gains a fov', async () => {
    const persp = makeFrameProbeGL();
    await renderStill(
      makeTestIR(),
      base({ createRenderer: persp.gl, cameraFov: 70, camera: { position: [10, 20, 30], target: [0, 0, 0] } })
    );
    expect(persp.frames[persp.frames.length - 1].fov).toBe(70);

    const ortho = makeFrameProbeGL();
    await renderStill(
      makeTestIR(),
      base({
        createRenderer: ortho.gl,
        cameraMode: 'orthographic',
        camera: { position: [10, 20, 30], target: [0, 0, 0], fov: 35 }
      })
    );
    const last = ortho.frames[ortho.frames.length - 1];
    expect(last.position).toEqual([10, 20, 30]);
    expect(last.fov).toBeUndefined();
  });

  it('frames to the model bounds when no pose is given (the final frame is not at the origin)', async () => {
    const probe = makeFrameProbeGL();
    await renderStill(makeTestIR(), base({ createRenderer: probe.gl }));
    const last = probe.frames[probe.frames.length - 1];
    expect(last.position.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...last.position)).toBeGreaterThan(0);
  });

  it('forwards layerRange and scrub to the renderer after the build, and skips them when omitted', async () => {
    const range = vi.spyOn(ToolpathRenderer.prototype, 'setLayerRange');
    const scrub = vi.spyOn(ToolpathRenderer.prototype, 'setScrubPosition');
    await renderStill(makeTestIR(), base({ layerRange: [0, 1], scrub: 4 }));
    expect(range.mock.calls).toEqual([[0, 1]]);
    expect(scrub.mock.calls).toEqual([[4]]);

    range.mockClear();
    scrub.mockClear();
    await renderStill(makeTestIR(), base({ scrub: null }));
    expect(range).not.toHaveBeenCalled();
    expect(scrub.mock.calls).toEqual([[null]]);

    scrub.mockClear();
    await renderStill(makeTestIR(), base());
    expect(scrub).not.toHaveBeenCalled();
  });

  it('re-applies colorMode after the build only when one is given', async () => {
    const color = vi.spyOn(ToolpathRenderer.prototype, 'setColorMode');
    await renderStill(makeTestIR(), base());
    expect(color).not.toHaveBeenCalled();
    await renderStill(makeTestIR(), base({ colorMode: { mode: 'single', color: [1, 0, 0] } }));
    expect(color.mock.calls).toEqual([[{ mode: 'single', color: [1, 0, 0] }]]);
  });
});

describe('renderStill background and build lifecycle', () => {
  it('a solid background paints the scene; an explicit theme.background beats it', async () => {
    const solid = makeFrameProbeGL();
    await renderStill(makeTestIR(), base({ createRenderer: solid.gl, background: '#112233' }));
    expect(solid.frames[solid.frames.length - 1].background).toBe('112233');

    const themed = makeFrameProbeGL();
    await renderStill(
      makeTestIR(),
      base({ createRenderer: themed.gl, background: '#112233', theme: { background: '#445566' } })
    );
    expect(themed.frames[themed.frames.length - 1].background).toBe('445566');
  });

  it('transparent leaves the scene background unset', async () => {
    const probe = makeFrameProbeGL();
    await renderStill(makeTestIR(), base({ createRenderer: probe.gl, background: 'transparent' }));
    expect(probe.frames[probe.frames.length - 1].background).toBeNull();
  });

  it('settles on an empty IR even when the renderer never reports buildComplete', async () => {
    const b = new ToolpathIRBuilder({ parserVersion: 'empty', units: 'mm', unitsSource: 'known' });
    const empty: ToolpathIR = b.finalize();
    // Swallow buildComplete so only the IR's own segment-count guard can settle the await.
    const realOnEvent = ToolpathRenderer.prototype.onEvent;
    vi.spyOn(ToolpathRenderer.prototype, 'onEvent').mockImplementation(function (this: ToolpathRenderer, cb) {
      return realOnEvent.call(this, (e) => {
        if (e.type !== 'buildComplete') cb(e);
      });
    });
    const outcome = await Promise.race([
      renderStill(empty, base()).then((r) => r.segmentCount),
      new Promise<'hang'>((resolve) => setTimeout(() => resolve('hang'), 2000))
    ]);
    expect(outcome).toBe(0);
  });

  it('unsubscribes from the renderer exactly once, even when two settle signals arrive', async () => {
    const b = new ToolpathIRBuilder({ parserVersion: 'empty', units: 'mm', unitsSource: 'known' });
    const empty: ToolpathIR = b.finalize();
    let offs = 0;
    const realOnEvent = ToolpathRenderer.prototype.onEvent;
    vi.spyOn(ToolpathRenderer.prototype, 'onEvent').mockImplementation(function (this: ToolpathRenderer, cb) {
      const off = realOnEvent.call(this, cb);
      // An empty IR settles via BOTH the renderer's buildComplete and the segment-count microtask.
      queueMicrotask(() => cb({ type: 'buildComplete', decimationApplied: 1 } as Parameters<typeof cb>[0]));
      return () => {
        offs++;
        off();
      };
    });
    await renderStill(empty, base());
    expect(offs).toBe(1);
  });

  it('a renderer error after the build settled does not change the result', async () => {
    // makeTestIR carries no featureRoles, so the post-build setColorMode emits E_COLOR_MODE_UNAVAILABLE
    // AFTER the await settled (and unsubscribed); the still must still resolve.
    const errors: string[] = [];
    const realOnEvent = ToolpathRenderer.prototype.onEvent;
    vi.spyOn(ToolpathRenderer.prototype, 'onEvent').mockImplementation(function (this: ToolpathRenderer, cb) {
      realOnEvent.call(this, (e) => {
        if (e.type === 'error') errors.push(e.code);
      });
      return realOnEvent.call(this, cb);
    });
    const r = await renderStill(
      makeTestIR(),
      base({ colorMode: { mode: 'feature', palette: [[1, 0, 0]], fallback: [0, 0, 0] } })
    );
    expect(errors).toEqual(['E_COLOR_MODE_UNAVAILABLE']);
    expect(r.segmentCount).toBe(12);
  });
});
