// @vitest-environment happy-dom
/**
 * Render diagnostics (DD-027): the `probeGpuInfo` classifier over a live-ish context, and the
 * `RenderStats` snapshot + `renderStats` event the renderer assembles at build-complete.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer, UNKNOWN_GPU_INFO, probeGpuInfo, type GLRendererLike, type RendererEvent } from '../index.js';

/** A fake WebGL context whose unmasked renderer/vendor come from `renderer`/`vendor`. */
function fakeGl(renderer: string | null, vendor = 'Test Vendor', hasExt = true) {
  const UNMASKED_RENDERER_WEBGL = 0x9246;
  const UNMASKED_VENDOR_WEBGL = 0x9245;
  return {
    getExtension: (name: string) =>
      name === 'WEBGL_debug_renderer_info' && hasExt ? { UNMASKED_RENDERER_WEBGL, UNMASKED_VENDOR_WEBGL } : null,
    getParameter: (p: number) =>
      p === UNMASKED_RENDERER_WEBGL ? renderer : p === UNMASKED_VENDOR_WEBGL ? vendor : null
  };
}

function makeIR(segments = 6): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  for (let s = 0; s < segments; s++) {
    b.addSegment({
      x0: 100 + s,
      y0: 100,
      z0: 0.2,
      x1: 101 + s,
      y1: 100,
      z1: 0.2,
      e: 1,
      kind: MoveKind.Extrude,
      layer: 0,
      srcByte: s * 10
    });
  }
  return b.finalize();
}

function makeRenderer() {
  const canvas = document.createElement('canvas');
  const stub: GLRendererLike = {
    render: () => undefined,
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: canvas
  };
  const ticks: (() => void)[] = [];
  const events: RendererEvent[] = [];
  const renderer = new ToolpathRenderer({
    canvas,
    chunksPerTick: 8,
    quality: 'lines',
    createRenderer: () => stub,
    scheduleFrame: (cb) => ticks.push(cb)
  });
  renderer.onEvent((e) => events.push(e));
  return {
    renderer,
    events,
    runTicks: () => {
      while (ticks.length > 0) ticks.shift()?.();
    }
  };
}

describe('probeGpuInfo (DD-027)', () => {
  it('classifies a hardware GPU and surfaces the raw renderer/vendor strings', () => {
    const gpu = probeGpuInfo({
      getContext: () => fakeGl('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 ..., D3D11)', 'Google Inc. (NVIDIA)'),
      capabilities: { isWebGL2: true }
    });
    expect(gpu.capability).toBe('hardware');
    expect(gpu.gpuRenderer).toContain('RTX 4070');
    expect(gpu.gpuVendor).toBe('Google Inc. (NVIDIA)');
    expect(gpu.webglVersion).toBe(2);
  });

  it('classifies a SwiftShader software fallback', () => {
    const gpu = probeGpuInfo({
      getContext: () => fakeGl('ANGLE (Google, Vulkan 1.3 (SwiftShader Device (LLVM 10)), SwiftShader driver)'),
      capabilities: { isWebGL2: true }
    });
    expect(gpu.capability).toBe('software');
    expect(gpu.gpuRenderer).toContain('SwiftShader');
  });

  it('returns unknown + null strings when WEBGL_debug_renderer_info is gated', () => {
    const gpu = probeGpuInfo({ getContext: () => fakeGl('whatever', 'x', false), capabilities: { isWebGL2: false } });
    expect(gpu.capability).toBe('unknown');
    expect(gpu.gpuRenderer).toBeNull();
    expect(gpu.gpuVendor).toBeNull();
    expect(gpu.webglVersion).toBe(1); // version is still known even when the string is gated
  });

  it('returns UNKNOWN_GPU_INFO for a non-WebGL renderer (no getContext) and never throws', () => {
    expect(probeGpuInfo({})).toEqual(UNKNOWN_GPU_INFO);
    expect(
      probeGpuInfo({
        getContext: () => {
          throw new Error('boom');
        }
      })
    ).toEqual(UNKNOWN_GPU_INFO);
    expect(probeGpuInfo(null)).toEqual(UNKNOWN_GPU_INFO);
  });
});

describe('RenderStats snapshot + event (DD-027)', () => {
  it('is null before the first build, then populated at build-complete', () => {
    const { renderer, events, runTicks } = makeRenderer();
    expect(renderer.getRenderStats()).toBeNull();

    renderer.setIR(makeIR(6));
    runTicks();

    const stats = renderer.getRenderStats();
    expect(stats).not.toBeNull();
    expect(stats!.backend).toBe('3d-webgl');
    expect(stats!.geometryMode).toBe('lines');
    expect(stats!.sourceSegmentCount).toBe(6);
    expect(stats!.renderedSegmentCount).toBe(6);
    expect(stats!.decimationApplied).toBe(1);
    expect(stats!.drawCalls).toBeGreaterThan(0);
    expect(stats!.vertexCount).toBeGreaterThan(0);
    expect(stats!.qualityMode).toBe('adaptive');
    expect(stats!.tubeBytes).toBeNull(); // lines mode
    expect(stats!.tubeByteBudget).toBeNull(); // budget did not bind
    expect(stats!.disclosures).toEqual([]);

    // Renderer-side timings present; parse-spanning ones are core's to fill (null here).
    expect(typeof stats!.geometryBuildMs).toBe('number');
    expect(stats!.firstRenderMs).not.toBeNull();
    expect(stats!.parseMs).toBeNull();
    expect(stats!.totalReadyMs).toBeNull();

    // The stub renderer exposes no getContext → GPU is honestly unknown, never fabricated.
    expect(stats!.capability).toBe('unknown');
    expect(stats!.gpuRenderer).toBeNull();

    // A `renderStats` event carried the same snapshot.
    const emitted = events.filter((e) => e.type === 'renderStats');
    expect(emitted).toHaveLength(1);
    expect((emitted[0] as { stats: unknown }).stats).toBe(stats);
  });
});
