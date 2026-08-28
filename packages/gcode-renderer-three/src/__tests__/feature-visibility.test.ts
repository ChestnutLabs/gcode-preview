// @vitest-environment happy-dom
/**
 * setFeatureRoleVisible (DD-009 extension, AnyBridge "hide adhesion" request): show/hide a single
 * FeatureRole by collapsing its segments' vertices to NaN (GPU-discarded), reversibly. Unlike the
 * whole-chunk move-kind toggle, feature roles live per-segment inside the extrusion geometry.
 *
 * Guarantees under test: hidden segments' positions go NaN; other segments untouched; showing again
 * restores byte-for-byte; never called → geometry byte-identical (no base copy saved); travel geometry
 * is unaffected (feature roles are an extrusion channel).
 */
import { describe, expect, it } from 'vitest';
import { FeatureRole, MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer, type GLRendererLike } from '../index.js';

/** One extrude segment per `roles[i]`, plus `travel` travel segments (feature roles don't apply). */
function makeIR(roles: number[], travel = 0): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  b.setCapability('featureRoles', 'known');
  let src = 0;
  for (let t = 0; t < travel; t++) {
    b.addSegment({
      x0: 90 + t,
      y0: 90,
      z0: 0.2,
      x1: 91 + t,
      y1: 90,
      z1: 0.2,
      e: 0,
      kind: MoveKind.Travel,
      layer: 0,
      srcByte: src++ * 10
    });
  }
  for (let s = 0; s < roles.length; s++) {
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
      srcByte: src++ * 10,
      feature: roles[s]
    });
  }
  return b.finalize();
}

function makeRenderer(): { renderer: ToolpathRenderer; run: () => void } {
  const canvas = document.createElement('canvas');
  const stub: GLRendererLike = {
    render: () => undefined,
    setSize: () => undefined,
    setPixelRatio: () => undefined,
    dispose: () => undefined,
    domElement: canvas
  };
  const ticks: (() => void)[] = [];
  const renderer = new ToolpathRenderer({
    canvas,
    buildVolume: { x: 220, y: 220, z: 250 },
    chunksPerTick: 1,
    quality: 'lines', // GL_LINES: 6 floats (2 vertices) per segment, in chunk order
    createRenderer: () => stub,
    scheduleFrame: (cb) => ticks.push(cb)
  });
  const run = (): void => {
    while (ticks.length > 0) ticks.shift()?.();
  };
  return { renderer, run };
}

/** The single extrude chunk mesh (lines quality → one LineSegments over all extrude segments). */
function extrudeMesh(renderer: ToolpathRenderer) {
  return renderer.chunkMeshes.find((m) => (m.userData.chunk as { kind: string } | undefined)?.kind === 'extrude')!;
}
const positions = (mesh: { geometry: { getAttribute: (n: string) => { array: ArrayLike<number> } } }): Float32Array =>
  mesh.geometry.getAttribute('position').array as Float32Array;

describe('setFeatureRoleVisible', () => {
  it('hides one role (its segments → NaN) and leaves others intact; showing restores byte-for-byte', () => {
    const { renderer, run } = makeRenderer();
    renderer.setIR(makeIR([FeatureRole.Skirt, FeatureRole.Perimeter, FeatureRole.Skirt, FeatureRole.Perimeter]));
    run();
    const mesh = extrudeMesh(renderer);
    const baseline = positions(mesh).slice(); // 4 segments × 6 floats = 24

    renderer.setFeatureRoleVisible(FeatureRole.Skirt, false);
    const hidden = positions(mesh);
    // segments 0 and 2 (Skirt) → all 6 floats NaN; 1 and 3 (Perimeter) → unchanged
    for (const seg of [0, 2]) for (let f = 0; f < 6; f++) expect(Number.isNaN(hidden[seg * 6 + f])).toBe(true);
    for (const seg of [1, 3]) for (let f = 0; f < 6; f++) expect(hidden[seg * 6 + f]).toBe(baseline[seg * 6 + f]);
    expect(renderer.getHiddenFeatureRoles()).toEqual([FeatureRole.Skirt]);

    renderer.setFeatureRoleVisible(FeatureRole.Skirt, true);
    expect(Array.from(positions(mesh))).toEqual(Array.from(baseline)); // restored exactly
    expect(renderer.getHiddenFeatureRoles()).toEqual([]);
  });

  it('hides multiple roles at once and un-hides them independently', () => {
    const { renderer, run } = makeRenderer();
    renderer.setIR(makeIR([FeatureRole.Skirt, FeatureRole.Brim, FeatureRole.Perimeter]));
    run();
    const mesh = extrudeMesh(renderer);
    renderer.setFeatureRoleVisible(FeatureRole.Skirt, false);
    renderer.setFeatureRoleVisible(FeatureRole.Brim, false);
    const p = positions(mesh);
    expect(Number.isNaN(p[0])).toBe(true); // skirt seg 0
    expect(Number.isNaN(p[6])).toBe(true); // brim seg 1
    expect(Number.isNaN(p[12])).toBe(false); // perimeter seg 2 visible
    // un-hide brim only: seg 1 returns, seg 0 stays hidden
    renderer.setFeatureRoleVisible(FeatureRole.Brim, true);
    const p2 = positions(mesh);
    expect(Number.isNaN(p2[0])).toBe(true);
    expect(Number.isNaN(p2[6])).toBe(false);
  });

  it('never called → geometry is byte-identical (no NaN, no base copy retained)', () => {
    const { renderer, run } = makeRenderer();
    renderer.setIR(makeIR([FeatureRole.Skirt, FeatureRole.Perimeter]));
    run();
    const mesh = extrudeMesh(renderer);
    expect(Array.from(positions(mesh)).some(Number.isNaN)).toBe(false);
    expect(mesh.userData.baseFeaturePositions).toBeUndefined();
  });

  it('does not touch travel geometry (feature roles are extrusion-only)', () => {
    const { renderer, run } = makeRenderer();
    renderer.setIR(makeIR([FeatureRole.Skirt], 2));
    run();
    renderer.setFeatureRoleVisible(FeatureRole.Skirt, false);
    const travel = renderer.chunkMeshes.find(
      (m) => (m.userData.chunk as { kind: string } | undefined)?.kind === 'travel'
    );
    expect(travel).toBeDefined();
    expect(Array.from(positions(travel!)).some(Number.isNaN)).toBe(false);
    expect(travel!.userData.baseFeaturePositions).toBeUndefined();
  });
});
