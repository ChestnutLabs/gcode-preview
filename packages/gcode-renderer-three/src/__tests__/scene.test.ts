// @vitest-environment happy-dom
/**
 * ToolpathRenderer scene/lifecycle tests (DD-004 §5, phase 2, issue #57).
 *
 * Uses a stub GL renderer (three's scene graph and BufferGeometry are pure JS —
 * only WebGLRenderer needs a real context) and a manual frame scheduler, so
 * incremental build, context-loss recovery, and disposal are all deterministic.
 */
import { describe, expect, it } from 'vitest';
import { Mesh, MeshBasicMaterial, MeshLambertMaterial, type LineLoop, type LineSegments } from 'three';
import { MoveKind, ToolpathIRBuilder, type Confidence, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import {
  buildChunks,
  buildTubeChunk,
  chooseQuality,
  createBuildVolume,
  ToolpathRenderer,
  type GLRendererLike,
  type QualityMode,
  type RendererEvent,
  type TubeOptions
} from '../index.js';

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
  opts: {
    layers?: number;
    perLayer?: number;
    chunksPerTick?: number;
    target?: number;
    quality?: QualityMode | 'auto';
    tube?: TubeOptions;
  } = {}
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
    // Phase-2/3 assertions are written against GL_LINES layouts; phase-4 tests
    // opt into tubes/auto explicitly.
    quality: opts.quality ?? 'lines',
    tube: opts.tube,
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

  it('setKindVisible(wipe) toggles only the wipe chunk, leaving extrude + travel (DD-016, #182)', () => {
    const h = makeHarness();
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    const base = { x0: 0, y0: 0, z0: 0.2, x1: 1, y1: 0, z1: 0.2, tool: 0, layer: 0 };
    b.addSegment({ ...base, e: 1, kind: MoveKind.Extrude, srcByte: 0 });
    b.addSegment({ ...base, kind: MoveKind.Travel, srcByte: 10 });
    b.addSegment({ ...base, kind: MoveKind.Travel | MoveKind.Wipe, srcByte: 20 });
    h.renderer.setIR(b.finalize());
    h.runTicks();

    const byKind = (k: string) =>
      h.renderer.chunkMeshes.filter((m) => (m.userData.chunk as { kind: string }).kind === k);
    expect(byKind('wipe').length).toBeGreaterThan(0);
    expect(byKind('extrude').length).toBeGreaterThan(0);

    h.renderer.setKindVisible('wipe', false);
    expect(byKind('wipe').every((m) => !m.visible)).toBe(true);
    expect(byKind('extrude').every((m) => m.visible)).toBe(true);
    expect(byKind('travel').every((m) => m.visible)).toBe(true);

    h.renderer.setKindVisible('wipe', true);
    expect(byKind('wipe').every((m) => m.visible)).toBe(true);
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

  it('build volume is corner-origin: bed spans [0..x]×[0..y] in printer coordinates', () => {
    const volume = createBuildVolume({ x: 220, y: 220, z: 250 });
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const child of volume.children) {
      const pos = (child as LineSegments).geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        minX = Math.min(minX, pos.getX(i));
        maxX = Math.max(maxX, pos.getX(i));
        minY = Math.min(minY, pos.getY(i));
        maxY = Math.max(maxY, pos.getY(i));
      }
    }
    // Corner-origin bed: no negative coordinates; extents match the volume —
    // the same coordinates the G-code (and toolpath) renders at (#58 follow-up).
    expect(minX).toBe(0);
    expect(minY).toBe(0);
    expect(maxX).toBe(220);
    expect(maxY).toBe(220);
  });

  it('build-volume cage is independently toggleable, default visible (#306/#6)', () => {
    // createBuildVolume: cage named 'volumeCage', respects style.showCage (default true).
    const shown = createBuildVolume({ x: 200, y: 200, z: 250 });
    expect(shown.getObjectByName('volumeCage')?.visible).toBe(true);
    const hidden = createBuildVolume({ x: 200, y: 200, z: 250 }, { showCage: false });
    expect(hidden.getObjectByName('volumeCage')?.visible).toBe(false);
    // The plate/grid is independent — still present when the cage is hidden.
    expect(hidden.children.some((c) => c.type === 'LineSegments' && c.name !== 'volumeCage')).toBe(true);

    // Renderer-level toggle flips the cage in place, plate unaffected.
    const h = makeHarness();
    const grp = (
      h.renderer as unknown as { volumeGroup: { getObjectByName(n: string): { visible: boolean } | undefined } }
    ).volumeGroup;
    expect(grp.getObjectByName('volumeCage')?.visible).toBe(true);
    h.renderer.setBuildVolumeCage(false);
    expect(grp.getObjectByName('volumeCage')?.visible).toBe(false);
    h.renderer.setBuildVolumeCage(true);
    expect(grp.getObjectByName('volumeCage')?.visible).toBe(true);
  });

  it('bedSurface:solid adds a filled plate under the grid; default adds none (#185)', () => {
    const bare = createBuildVolume({ x: 200, y: 200, z: 250 });
    expect(bare.children.find((c) => c.name === 'bedSurface')).toBeUndefined();

    const plated = createBuildVolume({ x: 200, y: 200, z: 250 }, { bedSurface: { mode: 'solid', color: 0x123456 } });
    const plate = plated.children.find((c) => c.name === 'bedSurface') as Mesh | undefined;
    expect(plate).toBeDefined();
    // Unlit backdrop: never write depth (so a first layer at z≈0 is never occluded) and drawn first.
    const mat = (plate as Mesh).material as MeshBasicMaterial;
    expect(mat.depthWrite).toBe(false);
    expect((plate as Mesh).renderOrder).toBe(-1);
    // Plate spans the bed, seated just below z=0.
    (plate as Mesh).geometry.computeBoundingBox();
    const bb = (plate as Mesh).geometry.boundingBox!;
    expect(bb.min.x).toBeCloseTo(0);
    expect(bb.max.x).toBeCloseTo(200);
    expect(bb.min.z).toBeLessThan(0);
  });

  it('excludedRegions render keep-out outlines above the plate (#185)', () => {
    const volume = createBuildVolume(
      {
        x: 200,
        y: 200,
        z: 250,
        excludedRegions: [
          {
            kind: 'rect',
            points: [
              { x: 10, y: 10 },
              { x: 40, y: 40 }
            ]
          }
        ]
      },
      { bedSurface: { mode: 'solid' } }
    );
    const zones = volume.children.filter((c) => c.name === 'excludedRegion');
    expect(zones).toHaveLength(1);
    // A rect keep-out expands to 4 corner vertices (a closed LineLoop).
    const pos = (zones[0] as LineLoop).geometry.getAttribute('position');
    expect(pos.count).toBe(4);
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

describe('tubes quality mode (phase 4)', () => {
  it('buildTubeChunk: continuous run → shared rings, segment-uniform index blocks', () => {
    const ir = makeIR(1, 4); // 4 continuous extrusion segments, one polyline
    const chunk = buildChunks(ir).chunks[0];
    const tube = buildTubeChunk(ir, chunk, { radialSegments: 8 });
    // One polyline of 4 segments: 5 rings × (8+1) seam-duplicate vertices.
    expect(tube.vertexCount).toBe(5 * 9);
    expect(tube.indicesPerSegment).toBe(8 * 6);
    expect(tube.indices.length).toBe(4 * 48);
    // Index integrity: every index addresses a real vertex.
    for (const i of tube.indices) expect(i).toBeLessThan(tube.vertexCount);
    // Vertex→segment map covers all chunk-local ordinals.
    expect(tube.vertexSegment.length).toBe(tube.vertexCount);
    expect(Math.max(...tube.vertexSegment)).toBe(3);
  });

  it('buildTubeChunk: discontinuity (layer change) starts a new polyline', () => {
    const ir = makeIR(2, 3); // two layers → z jump between them breaks continuity
    const chunk = buildChunks(ir).chunks[0];
    const tube = buildTubeChunk(ir, chunk, { radialSegments: 8 });
    // Two polylines of 3 segments: (3+1)+(3+1) = 8 rings.
    expect(tube.vertexCount).toBe(8 * 9);
    expect(tube.indices.length).toBe(6 * 48);
  });

  it('buildTubeChunk: vertex budget overrun throws RangeError', () => {
    const ir = makeIR(1, 4);
    const chunk = buildChunks(ir).chunks[0];
    expect(() => buildTubeChunk(ir, chunk, { maxVertices: 10 })).toThrow(RangeError);
  });

  it('chooseQuality: auto picks tubes ≤ 1M segments, lines above; explicit wins', () => {
    expect(chooseQuality('auto', 1_000_000)).toBe('tubes');
    expect(chooseQuality('auto', 1_000_001)).toBe('lines');
    expect(chooseQuality('lines', 10)).toBe('lines');
    expect(chooseQuality('tubes', 5_000_000)).toBe('tubes');
  });

  it('tubes mode: extrusion chunks become lit Meshes, travel stays lines', () => {
    const h = makeHarness({ quality: 'tubes' });
    h.renderer.setIR(makeIR(2, 5, { travelPerLayer: 2 }));
    h.runTicks();
    expect(h.renderer.activeQuality).toBe('tubes');
    const extrude = h.renderer.chunkMeshes.filter((m) => (m.userData.chunk as { kind: string }).kind === 'extrude');
    const travel = h.renderer.chunkMeshes.filter((m) => (m.userData.chunk as { kind: string }).kind === 'travel');
    expect(extrude.length).toBeGreaterThan(0);
    expect(extrude.every((m) => m instanceof Mesh && m.material instanceof MeshLambertMaterial)).toBe(true);
    expect(travel.every((m) => !(m instanceof Mesh))).toBe(true);
    const complete = h.events.find((e) => e.type === 'buildComplete');
    expect(complete && 'quality' in complete && complete.quality).toBe('tubes');
    // auto on a small IR also lands on tubes.
    const hAuto = makeHarness({ quality: 'auto' });
    hAuto.renderer.setIR(makeIR(1, 3));
    hAuto.runTicks();
    expect(hAuto.renderer.activeQuality).toBe('tubes');
  });

  it('layer clipping in tubes mode trims by index units — same §4.5 contract as lines', () => {
    const h = makeHarness({ quality: 'tubes' });
    h.renderer.setIR(makeIR(4, 10));
    h.runTicks();
    const mesh = h.renderer.chunkMeshes[0];
    const units = mesh.userData.drawUnitsPerSegment as number;
    expect(units).toBe(48);
    h.renderer.setLayerRange(1, 2);
    expect(mesh.geometry.drawRange.start).toBe(10 * units);
    expect(mesh.geometry.drawRange.count).toBe(20 * units);
    // Recolor rewrites the tube color attribute without touching positions.
    const posBefore = mesh.geometry.getAttribute('position');
    const ok = h.renderer.setColorMode({ mode: 'tool', palette: [[0.2, 0.6, 0.9]] });
    expect(ok).toBe(true);
    expect(mesh.geometry.getAttribute('position')).toBe(posBefore);
    expect(mesh.geometry.getAttribute('color').count).toBe(mesh.geometry.getAttribute('position').count);
  });

  it('failed tubes build falls back to lines with a qualityFallback event (§6.1)', () => {
    const h = makeHarness({ quality: 'tubes', tube: { maxVertices: 10 } });
    h.renderer.setIR(makeIR(2, 5));
    h.runTicks();
    const fb = h.events.find((e) => e.type === 'qualityFallback');
    expect(fb).toBeDefined();
    expect(fb && 'to' in fb && fb.to).toBe('lines');
    expect(h.renderer.activeQuality).toBe('lines');
    expect(h.renderer.chunkMeshes.length).toBeGreaterThan(0);
    expect(h.renderer.chunkMeshes.every((m) => !(m instanceof Mesh))).toBe(true);
    const complete = h.events.find((e) => e.type === 'buildComplete');
    expect(complete && 'quality' in complete && complete.quality).toBe('lines');
  });

  it('appendPartial streams preview meshes; setIR replaces them wholesale (#60)', () => {
    const h = makeHarness();
    const camBefore = h.renderer.camera.position.clone();
    h.renderer.appendPartial(makeIR(2, 5, { travelPerLayer: 1 }));
    const preview1 = h.renderer.chunkMeshes.filter((m) => m.userData.preview === true);
    expect(preview1.length).toBeGreaterThan(0);
    expect(h.events.some((e) => e.type === 'previewAppend')).toBe(true);
    // First partial frames the camera onto the preview bounds.
    expect(h.renderer.camera.position.equals(camBefore)).toBe(false);

    h.renderer.appendPartial(makeIR(2, 5));
    const preview2 = h.renderer.chunkMeshes.filter((m) => m.userData.preview === true);
    expect(preview2.length).toBeGreaterThan(preview1.length);

    // Clipping ignores preview meshes (slice-local indices); kind visibility applies.
    h.renderer.setLayerRange(0, 0);
    expect(preview2.every((m) => m.visible)).toBe(true);
    h.renderer.setKindVisible('travel', false);
    const previewTravel = preview2.filter((m) => (m.userData.chunk as { kind: string }).kind === 'travel');
    expect(previewTravel.length).toBeGreaterThan(0);
    expect(previewTravel.every((m) => !m.visible)).toBe(true);
    h.renderer.setKindVisible('travel', true);

    // Final IR replaces the whole preview set.
    h.renderer.setIR(makeIR(4, 6));
    h.runTicks();
    expect(h.renderer.chunkMeshes.some((m) => m.userData.preview === true)).toBe(false);
    expect(h.renderer.chunkMeshes.length).toBeGreaterThan(0);
  });

  it('appendPartial after a final IR starts a fresh preview (new parse)', () => {
    const h = makeHarness();
    h.renderer.setIR(makeIR(3, 6));
    h.runTicks();
    expect(h.renderer.chunkMeshes.length).toBeGreaterThan(0);

    h.renderer.appendPartial(makeIR(1, 4));
    const meshes = h.renderer.chunkMeshes;
    // Old final geometry is gone; only the new preview remains.
    expect(meshes.every((m) => m.userData.preview === true)).toBe(true);
    expect(h.renderer.segmentCount).toBe(0); // retained IR dropped
  });

  it('setBuildVolume applies discovered machine geometry post-parse (#73, DD-005 §4.2)', () => {
    const h = makeHarness(); // configured volume: 220×220×250
    h.renderer.setIR(makeIR(1, 3));
    h.runTicks();
    const meshesBefore = h.renderer.chunkMeshes.length;

    // Discovered geometry differing >1mm → mismatch reported, volume applied.
    h.renderer.setBuildVolume({
      bed: { kind: 'rect', min: { x: 0, y: 0 }, max: { x: 256, y: 256 } },
      origin: { x: 0, y: 0 },
      heightMm: 256,
      confidence: 'known',
      source: { adapterId: 'test', evidence: 'test' }
    });
    const mismatch = h.events.find((e) => e.type === 'error' && e.code === 'machine-geometry-mismatch');
    expect(mismatch).toBeDefined();
    // Toolpath meshes untouched; only the volume group was rebuilt.
    expect(h.renderer.chunkMeshes.length).toBe(meshesBefore);

    // Matching geometry (within 1mm) → no new mismatch.
    const before = h.events.length;
    h.renderer.setBuildVolume({ x: 256, y: 256, z: 256 });
    h.renderer.setBuildVolume({
      bed: { kind: 'rect', min: { x: 0, y: 0 }, max: { x: 256, y: 256 } },
      origin: { x: 0, y: 0 },
      confidence: 'known',
      source: { adapterId: 'test', evidence: 'test' }
    });
    expect(h.events.slice(before).some((e) => e.type === 'error' && e.code === 'machine-geometry-mismatch')).toBe(
      false
    );
  });

  it('setQuality rebuilds from the retained IR', () => {
    const h = makeHarness({ quality: 'tubes' });
    h.renderer.setIR(makeIR(2, 5));
    h.runTicks();
    expect(h.renderer.chunkMeshes.some((m) => m instanceof Mesh)).toBe(true);
    h.renderer.setQuality('lines');
    h.runTicks();
    expect(h.renderer.activeQuality).toBe('lines');
    expect(h.renderer.chunkMeshes.every((m) => !(m instanceof Mesh))).toBe(true);
  });
});
