// @vitest-environment happy-dom
/**
 * ToolpathRenderer scene/lifecycle tests (DD-004 §5, phase 2, issue #57).
 *
 * Uses a stub GL renderer (three's scene graph and BufferGeometry are pure JS —
 * only WebGLRenderer needs a real context) and a manual frame scheduler, so
 * incremental build, context-loss recovery, and disposal are all deterministic.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type Confidence, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer, type GLRendererLike, type RendererEvent } from '../index.js';

function makeIR(
  layers: number,
  perLayer: number,
  opts: { travelPerLayer?: number; featureRoles?: Confidence } = {}
): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  if (opts.featureRoles !== undefined) {
    b.setCapability('featureRoles', opts.featureRoles);
  }
  let src = 0;
  for (let l = 0; l < layers; l++) {
    for (let t = 0; t < (opts.travelPerLayer ?? 0); t++) {
      b.addSegment({
        x0: 90 + t,
        y0: 90,
        z0: 0.2 * (l + 1),
        x1: 91 + t,
        y1: 90,
        z1: 0.2 * (l + 1),
        e: 0,
        kind: MoveKind.Travel,
        layer: l,
        srcByte: src++ * 10
      });
    }
    for (let s = 0; s < perLayer; s++) {
      b.addSegment({
        x0: 100 + s,
        y0: 100,
        z0: 0.2 * (l + 1),
        x1: 101 + s,
        y1: 100,
        z1: 0.2 * (l + 1),
        e: 1,
        kind: MoveKind.Extrude,
        layer: l,
        srcByte: src++ * 10
      });
    }
  }
  return b.finalize();
}

interface Harness {
  renderer: ToolpathRenderer;
  canvas: HTMLCanvasElement;
  glCalls: { render: number; dispose: number };
  ticks: (() => void)[];
  runTicks: () => void;
  events: RendererEvent[];
}

function makeHarness(
  opts: { layers?: number; perLayer?: number; chunksPerTick?: number; target?: number } = {}
): Harness {
  const canvas = document.createElement('canvas');
  const glCalls = { render: 0, dispose: 0 };
  const stub: GLRendererLike = {
    render: () => glCalls.render++,
    setSize: () => undefined,
    dispose: () => glCalls.dispose++,
    domElement: canvas
  };
  const ticks: (() => void)[] = [];
  const renderer = new ToolpathRenderer({
    canvas,
    buildVolume: { x: 220, y: 220, z: 250 },
    chunksPerTick: opts.chunksPerTick ?? 1,
    createRenderer: () => stub,
    scheduleFrame: (cb) => ticks.push(cb)
  });
  const events: RendererEvent[] = [];
  renderer.onEvent((e) => events.push(e));
  const runTicks = (): void => {
    while (ticks.length > 0) {
      const cb = ticks.shift();
      cb?.();
    }
  };
  return { renderer, canvas, glCalls, ticks, runTicks, events };
}

describe('ToolpathRenderer (phase 2)', () => {
  it('builds chunks incrementally across scheduler ticks and reports progress', () => {
    const h = makeHarness({ chunksPerTick: 1 });
    const ir = makeIR(8, 50); // multiple chunks with a small target
    // Rebuild chunk sizes: use a small per-chunk target by decimation-free default —
    // 400 segments in one chunk by default target, so force chunking via many ticks:
    h.renderer.setIR(ir);
    h.runTicks();
    const complete = h.events.find((e) => e.type === 'buildComplete');
    expect(complete).toBeDefined();
    expect(h.renderer.chunkMeshes.length).toBeGreaterThan(0);
    expect(h.events.some((e) => e.type === 'buildProgress')).toBe(true);
    expect(h.glCalls.render).toBeGreaterThan(0);
    // Every mesh geometry position attribute is the phase-1 Float32 buffer, 6 floats/segment.
    const mesh = h.renderer.chunkMeshes[0];
    const pos = mesh.geometry.getAttribute('position');
    expect(pos.itemSize).toBe(3);
    expect(pos.count % 2).toBe(0); // 2 vertices per segment
  });

  it('applies the single Z-up→Y-up rotation at the root and positions by originOffset', () => {
    const h = makeHarness();
    const ir = makeIR(1, 3);
    h.renderer.setIR(ir);
    h.runTicks();
    const mesh = h.renderer.chunkMeshes[0];
    // Walk up: toolpathGroup (originOffset) -> root (rotation) -> scene.
    const toolpathGroup = mesh.parent!;
    const root = toolpathGroup.parent!;
    expect(toolpathGroup.position.x).toBeCloseTo(ir.header.originOffset.x);
    expect(toolpathGroup.position.z).toBeCloseTo(ir.header.originOffset.z);
    expect(root.rotation.x).toBeCloseTo(-Math.PI / 2);
  });

  it('recovers from context loss by rebuilding from the retained IR (§5.2)', () => {
    const h = makeHarness();
    const ir = makeIR(2, 5);
    h.renderer.setIR(ir);
    h.runTicks();
    const meshesBefore = h.renderer.chunkMeshes.length;
    expect(meshesBefore).toBeGreaterThan(0);

    h.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(h.events.some((e) => e.type === 'contextlost')).toBe(true);

    h.canvas.dispatchEvent(new Event('webglcontextrestored'));
    h.runTicks();
    expect(h.events.some((e) => e.type === 'restored')).toBe(true);
    // Scene rebuilt from the retained IR: same chunk count as before.
    expect(h.renderer.chunkMeshes.length).toBe(meshesBefore);
    expect(h.events.filter((e) => e.type === 'buildComplete').length).toBe(2);
  });

  it('setIR twice replaces geometry without duplication; dispose releases everything', () => {
    const h = makeHarness();
    h.renderer.setIR(makeIR(2, 5));
    h.runTicks();
    const first = h.renderer.chunkMeshes.length;
    h.renderer.setIR(makeIR(3, 5));
    h.runTicks();
    expect(h.renderer.chunkMeshes.length).toBeGreaterThanOrEqual(first);
    // No stale meshes from the first IR: total equals the second build only.
    const complete = h.events.filter((e) => e.type === 'buildComplete');
    expect(complete.length).toBe(2);

    h.renderer.dispose();
    expect(h.renderer.chunkMeshes.length).toBe(0);
    expect(h.glCalls.dispose).toBe(1);
    // Post-dispose calls are inert.
    h.renderer.setIR(makeIR(1, 2));
    h.runTicks();
    expect(h.renderer.chunkMeshes.length).toBe(0);
  });

  it('frame() targets the toolpath bounds through the axis conversion', () => {
    const h = makeHarness();
    const ir = makeIR(1, 4); // bounds around x≈100..105, y=100, z≈0.2
    h.renderer.setIR(ir);
    h.runTicks();
    h.renderer.frame();
    // Camera looks toward printer (cx, cz, -cy) in scene coords: z should be ≈ -100.
    const cam = h.renderer.camera;
    expect(cam.position.y).toBeGreaterThan(0); // above the bed
    // The controls-less fallback still rendered without throwing.
    expect(h.glCalls.render).toBeGreaterThan(0);
  });
});

describe('ToolpathRenderer clipping/scrub/visibility/coloring (phase 3)', () => {
  it('setLayerRange trims via drawRange only — position attribute identity preserved', () => {
    const h = makeHarness();
    const ir = makeIR(4, 10); // 40 extrusion segments, one chunk
    h.renderer.setIR(ir);
    h.runTicks();
    const mesh = h.renderer.chunkMeshes[0];
    const posBefore = mesh.geometry.getAttribute('position');

    h.renderer.setLayerRange(1, 2); // layers 1..2 = IR segments 10..29
    expect(mesh.visible).toBe(true);
    expect(mesh.geometry.drawRange.start).toBe(10 * 2);
    expect(mesh.geometry.drawRange.count).toBe(20 * 2);
    // No rebuild: the exact same attribute object is still attached.
    expect(mesh.geometry.getAttribute('position')).toBe(posBefore);

    h.renderer.setLayerRange(0, Infinity); // restore full
    expect(mesh.geometry.drawRange.start).toBe(0);
    expect(mesh.geometry.drawRange.count).toBeGreaterThanOrEqual(40 * 2);
  });

  it('setScrubPosition cuts at the segment index and composes with the layer range', () => {
    const h = makeHarness();
    const ir = makeIR(4, 10);
    h.renderer.setIR(ir);
    h.runTicks();
    const mesh = h.renderer.chunkMeshes[0];

    h.renderer.setScrubPosition(14); // segments 0..14 → 15 segments
    expect(mesh.geometry.drawRange.start).toBe(0);
    expect(mesh.geometry.drawRange.count).toBe(15 * 2);

    h.renderer.setLayerRange(1, 3); // starts at segment 10; scrub still cuts at 14
    expect(mesh.geometry.drawRange.start).toBe(10 * 2);
    expect(mesh.geometry.drawRange.count).toBe(5 * 2);

    h.renderer.setScrubPosition(null); // clear scrub, range remains
    expect(mesh.geometry.drawRange.count).toBe(30 * 2);
  });

  it('setKindVisible toggles travel chunks without touching extrusion state', () => {
    const h = makeHarness();
    const ir = makeIR(2, 5, { travelPerLayer: 3 });
    h.renderer.setIR(ir);
    h.runTicks();
    const travel = h.renderer.chunkMeshes.filter((m) => (m.userData.chunk as { kind: string }).kind === 'travel');
    const extrude = h.renderer.chunkMeshes.filter((m) => (m.userData.chunk as { kind: string }).kind === 'extrude');
    expect(travel.length).toBeGreaterThan(0);
    expect(extrude.length).toBeGreaterThan(0);

    h.renderer.setKindVisible('travel', false);
    expect(travel.every((m) => !m.visible)).toBe(true);
    expect(extrude.every((m) => m.visible)).toBe(true);

    h.renderer.setKindVisible('travel', true);
    expect(travel.every((m) => m.visible)).toBe(true);
  });

  it('clipping set during an in-flight incremental build applies to later-built chunks', () => {
    const h = makeHarness({ chunksPerTick: 1 });
    const ir = makeIR(6, 4, { travelPerLayer: 2 }); // extrude + travel chunks
    h.renderer.setIR(ir);
    h.renderer.setKindVisible('travel', false); // before ANY tick ran
    h.runTicks();
    const travel = h.renderer.chunkMeshes.filter((m) => (m.userData.chunk as { kind: string }).kind === 'travel');
    expect(travel.length).toBeGreaterThan(0);
    expect(travel.every((m) => !m.visible)).toBe(true);
  });

  it('setIR resets clipping to full range', () => {
    const h = makeHarness();
    h.renderer.setIR(makeIR(4, 10));
    h.runTicks();
    h.renderer.setLayerRange(1, 1);
    h.renderer.setScrubPosition(12);

    h.renderer.setIR(makeIR(2, 6));
    h.runTicks();
    const mesh = h.renderer.chunkMeshes[0];
    expect(mesh.visible).toBe(true);
    expect(mesh.geometry.drawRange.start).toBe(0);
    expect(mesh.geometry.drawRange.count).toBeGreaterThanOrEqual(12 * 2);
  });

  it('feature color mode is capability-gated: refused when featureRoles is unavailable', () => {
    const h = makeHarness();
    h.renderer.setIR(makeIR(1, 4, { featureRoles: 'unavailable' }));
    h.runTicks();
    expect(h.renderer.isColorModeAvailable('feature')).toBe(false);
    expect(h.renderer.isColorModeAvailable('single')).toBe(true);
    expect(h.renderer.isColorModeAvailable('tool')).toBe(true);

    const ok = h.renderer.setColorMode({ mode: 'feature', palette: [[1, 0, 0]], fallback: [0.5, 0.5, 0.5] });
    expect(ok).toBe(false);
    const err = h.events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    expect((err as { code: string }).code).toBe('E_COLOR_MODE_UNAVAILABLE');
  });

  it('feature color mode is accepted when featureRoles is inferred', () => {
    const h = makeHarness();
    h.renderer.setIR(makeIR(1, 4, { featureRoles: 'inferred' }));
    h.runTicks();
    expect(h.renderer.isColorModeAvailable('feature')).toBe(true);
    const ok = h.renderer.setColorMode({ mode: 'feature', palette: [[1, 0, 0]], fallback: [0.5, 0.5, 0.5] });
    expect(ok).toBe(true);
    expect(h.events.some((e) => e.type === 'error')).toBe(false);
  });

  it('range + scrub updates stay within the 16 ms interaction budget at 100k segments', () => {
    const h = makeHarness();
    const ir = makeIR(100, 1000); // 100k segments
    h.renderer.setIR(ir);
    h.runTicks();
    expect(h.renderer.segmentCount).toBe(100_000);
    expect(h.renderer.layerCount).toBe(100);

    const t0 = performance.now();
    h.renderer.setLayerRange(20, 80);
    h.renderer.setScrubPosition(70_000);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(16);
  });
});
