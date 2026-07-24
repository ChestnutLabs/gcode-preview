// @vitest-environment happy-dom
/**
 * Live-progress overlay tests (DD-006 §4.5, phase 3, issue #92).
 *
 * Covers the maintainer-required behaviors from the DD-006 acceptance: presentation
 * transitions (exact→band→stale→hidden) with events, marker-for-known vs band-for-
 * approximate honesty, scrub precedence (user scrub owns the cut, overlay restores on
 * release), lines-style ghosting in tubes mode, and setIR overlay reset.
 */
import { describe, expect, it } from 'vitest';
import { LineSegments, Mesh, type LineBasicMaterial } from 'three';
import { MoveKind, ToolpathIRBuilder, type MappedProgress, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer, type GLRendererLike, type QualityMode, type RendererEvent } from '../index.js';

function makeIR(layers: number, perLayer: number): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  let src = 0;
  for (let l = 0; l < layers; l++) {
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

function makeHarness(opts: { quality?: QualityMode } = {}) {
  const canvas = document.createElement('canvas');
  const stub: GLRendererLike = {
    render: () => undefined,
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: canvas
  };
  const ticks: (() => void)[] = [];
  const renderer = new ToolpathRenderer({
    canvas,
    buildVolume: { x: 220, y: 220, z: 250 },
    chunksPerTick: 8,
    quality: opts.quality ?? 'lines',
    createRenderer: () => stub,
    scheduleFrame: (cb) => ticks.push(cb)
  });
  const events: RendererEvent[] = [];
  renderer.onEvent((e) => events.push(e));
  const runTicks = (): void => {
    while (ticks.length > 0) ticks.shift()?.();
  };
  return { renderer, events, runTicks };
}

function mapped(partial: Partial<MappedProgress>): MappedProgress {
  return {
    segIndex: null,
    basis: 'none',
    confidence: 'unavailable',
    band: null,
    layerIndex: null,
    stale: false,
    notes: [],
    ...partial
  };
}

const KNOWN_5 = mapped({ segIndex: 5, basis: 'byte', confidence: 'known', band: [5, 5], layerIndex: 0 });
const BAND_4_9 = mapped({ segIndex: 9, basis: 'layer', confidence: 'inferred', band: [4, 9], layerIndex: 0 });

function overlayOf(mesh: Mesh | LineSegments): { ghost: LineSegments; band: LineSegments } {
  return {
    ghost: mesh.userData.overlayGhost as LineSegments,
    band: mesh.userData.overlayBand as LineSegments
  };
}

describe('progress overlay — presentation modes (DD-006 §4.5)', () => {
  it('known → exact: completed cut + ghost remainder + marker at the segment endpoint', () => {
    const h = makeHarness();
    h.renderer.setIR(makeIR(2, 10));
    h.runTicks();
    h.renderer.setProgress(KNOWN_5);

    expect(h.renderer.progressPresentation).toBe('exact');
    const mesh = h.renderer.chunkMeshes[0];
    // Completed portion: segments 0..5 → draw range (0, 12) in GL_LINES units.
    expect(mesh.geometry.drawRange).toMatchObject({ start: 0, count: 12 });
    const { ghost, band } = overlayOf(mesh);
    expect(ghost.visible).toBe(true);
    expect(ghost.geometry.drawRange).toMatchObject({ start: 12, count: 28 }); // segments 6..19
    expect(band.visible).toBe(false); // a point position has no uncertainty band
    // Marker sits at segment 5's endpoint (origin-relative coords).
    const marker = h.renderer['markerMesh'] as Mesh;
    expect(marker.visible).toBe(true);
    const ir = makeIR(2, 10);
    expect(marker.position.x).toBeCloseTo(ir.segments.x1[5]);
    expect(marker.position.z).toBeCloseTo(ir.segments.z1[5]);
  });

  it('inferred/approximated → band: emphasis band, no marker (no false precision)', () => {
    const h = makeHarness();
    h.renderer.setIR(makeIR(2, 10));
    h.runTicks();
    h.renderer.setProgress(BAND_4_9);

    expect(h.renderer.progressPresentation).toBe('band');
    const mesh = h.renderer.chunkMeshes[0];
    // Completed cut sits at the band's lower edge: segments 0..3 → (0, 8).
    expect(mesh.geometry.drawRange).toMatchObject({ start: 0, count: 8 });
    const { ghost, band } = overlayOf(mesh);
    expect(band.visible).toBe(true);
    expect(band.geometry.drawRange).toMatchObject({ start: 8, count: 12 }); // segments 4..9
    expect(ghost.visible).toBe(true);
    expect(ghost.geometry.drawRange).toMatchObject({ start: 20, count: 20 }); // segments 10..19
    const marker = h.renderer['markerMesh'] as Mesh | null;
    expect(marker === null || marker.visible === false).toBe(true);
  });

  it('stale keeps the position but switches to the stale style', () => {
    const h = makeHarness();
    h.renderer.setIR(makeIR(2, 10));
    h.runTicks();
    h.renderer.setProgress(BAND_4_9);
    const mesh = h.renderer.chunkMeshes[0];
    const freshMaterial = (overlayOf(mesh).band.material as LineBasicMaterial).color.getHex();
    h.renderer.setProgress({ ...BAND_4_9, stale: true });

    expect(h.renderer.progressPresentation).toBe('stale');
    // Cuts unchanged — presentation degrades, position holds.
    expect(mesh.geometry.drawRange).toMatchObject({ start: 0, count: 8 });
    const staleMaterial = (overlayOf(mesh).band.material as LineBasicMaterial).color.getHex();
    expect(staleMaterial).not.toBe(freshMaterial);
  });

  it('unavailable → hidden: overlay gone, full path restored, evented with reason', () => {
    const h = makeHarness();
    h.renderer.setIR(makeIR(2, 10));
    h.runTicks();
    h.renderer.setProgress(KNOWN_5);
    h.events.length = 0;
    h.renderer.setProgress(mapped({ notes: [{ code: 'file-mismatch' }] }));

    expect(h.renderer.progressPresentation).toBe('hidden');
    const mesh = h.renderer.chunkMeshes[0];
    expect(mesh.geometry.drawRange.count).toBe(40); // all 20 segments back
    expect(overlayOf(mesh).ghost.visible).toBe(false);
    expect((h.renderer['markerMesh'] as Mesh).visible).toBe(false);
    const ev = h.events.find((e) => e.type === 'progress-presentation-changed');
    expect(ev).toMatchObject({ mode: 'hidden', reason: 'file-mismatch' });
  });

  it('emits progress-presentation-changed exactly on mode transitions', () => {
    const h = makeHarness();
    h.renderer.setIR(makeIR(2, 10));
    h.runTicks();
    h.events.length = 0;
    h.renderer.setProgress(KNOWN_5);
    h.renderer.setProgress({ ...KNOWN_5, segIndex: 6, band: [6, 6] }); // same mode — no event
    h.renderer.setProgress(BAND_4_9);
    h.renderer.setProgress({ ...BAND_4_9, stale: true });
    h.renderer.setProgress(null);
    const modes = h.events.filter((e) => e.type === 'progress-presentation-changed').map((e) => e.mode);
    expect(modes).toEqual(['exact', 'band', 'stale', 'hidden']);
  });
});

describe('progress overlay — scrub precedence (D5)', () => {
  it('an active user scrub owns the cut; the overlay restores on release', () => {
    const h = makeHarness();
    h.renderer.setIR(makeIR(2, 10));
    h.runTicks();
    h.renderer.setProgress(KNOWN_5);
    const mesh = h.renderer.chunkMeshes[0];
    expect(mesh.geometry.drawRange).toMatchObject({ start: 0, count: 12 });

    h.renderer.setScrubPosition(14);
    // Scrub wins the cut; the ghost is dropped while scrubbing.
    expect(mesh.geometry.drawRange).toMatchObject({ start: 0, count: 30 });
    expect(overlayOf(mesh).ghost.visible).toBe(false);

    h.renderer.setScrubPosition(null);
    // Overlay cut and ghost restored.
    expect(mesh.geometry.drawRange).toMatchObject({ start: 0, count: 12 });
    expect(overlayOf(mesh).ghost.visible).toBe(true);
  });

  it('the band emphasis stays visible during scrub (position indicator, not a cut)', () => {
    const h = makeHarness();
    h.renderer.setIR(makeIR(2, 10));
    h.runTicks();
    h.renderer.setProgress(BAND_4_9);
    h.renderer.setScrubPosition(2);
    const { ghost, band } = overlayOf(h.renderer.chunkMeshes[0]);
    expect(ghost.visible).toBe(false);
    expect(band.visible).toBe(true);
  });
});

describe('progress overlay — composition & lifecycle', () => {
  it('tubes mode ghosts as lines (D5/§8): main mesh is a tube Mesh, overlay passes are LineSegments', () => {
    const h = makeHarness({ quality: 'tubes' });
    h.renderer.setIR(makeIR(2, 10));
    h.runTicks();
    expect(h.renderer.activeQuality).toBe('tubes');
    h.renderer.setProgress(KNOWN_5);
    const mesh = h.renderer.chunkMeshes.find((m) => m instanceof Mesh && !(m instanceof LineSegments)) as Mesh;
    expect(mesh).toBeDefined();
    const { ghost, band } = overlayOf(mesh);
    expect(ghost).toBeInstanceOf(LineSegments);
    expect(band).toBeInstanceOf(LineSegments);
    expect(ghost.visible).toBe(true);
  });

  it('composes with layer-range clipping by intersection', () => {
    const h = makeHarness();
    h.renderer.setIR(makeIR(2, 10)); // layer 0: segments 0..9, layer 1: 10..19
    h.runTicks();
    h.renderer.setProgress(KNOWN_5);
    h.renderer.setLayerRange(1, 1);
    const mesh = h.renderer.chunkMeshes[0];
    // Layer 1 only, all of it after the completed cut → nothing completed visible…
    expect(mesh.geometry.drawRange.count).toBe(0);
    // …and the ghost covers exactly layer 1.
    const { ghost } = overlayOf(mesh);
    expect(ghost.visible).toBe(true);
    expect(ghost.geometry.drawRange).toMatchObject({ start: 20, count: 20 });
  });

  it('setIR resets the overlay to hidden (old segment indices never carry over)', () => {
    const h = makeHarness();
    h.renderer.setIR(makeIR(2, 10));
    h.runTicks();
    h.renderer.setProgress(KNOWN_5);
    expect(h.renderer.progressPresentation).toBe('exact');
    h.events.length = 0;
    h.renderer.setIR(makeIR(3, 4));
    h.runTicks();
    expect(h.renderer.progressPresentation).toBe('hidden');
    const ev = h.events.find((e) => e.type === 'progress-presentation-changed');
    expect(ev).toMatchObject({ mode: 'hidden', reason: 'new-ir' });
  });

  it('kind visibility hides the overlay passes with their chunk', () => {
    const h = makeHarness();
    h.renderer.setIR(makeIR(2, 10));
    h.runTicks();
    h.renderer.setProgress(KNOWN_5);
    h.renderer.setKindVisible('extrude', false);
    const mesh = h.renderer.chunkMeshes[0];
    expect(mesh.visible).toBe(false);
    expect(overlayOf(mesh).ghost.visible).toBe(false);
    h.renderer.setKindVisible('extrude', true);
    expect(overlayOf(mesh).ghost.visible).toBe(true);
  });
});
