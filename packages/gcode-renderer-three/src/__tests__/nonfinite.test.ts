// @vitest-environment happy-dom
/**
 * Non-finite IR / volume inputs (#501, three.js half): a consumer-built `ToolpathIR` (or a float32
 * overflow) can carry Infinity or NaN in a coordinate or in `ir.bounds`. Every path that consumes it must
 * either skip the bad segment or fail with a typed error — never hang, never leave a NaN camera.
 * Literal expected values throughout; the build-volume throws fire BEFORE any loop runs, so a regression
 * fails the `toThrow` immediately instead of spinning the (synchronous) grid loop.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type MappedProgress, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { Group } from 'three';
import { ToolpathRenderer, buildChunks, createBuildVolume, type GLRendererLike } from '../index.js';

type Box = { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };

/** Layer 0: finite extrude (index 0), `bad` extrude (index 1), finite travel (2), finite extrude (3). */
function makeIR(bad: Partial<Record<'x0' | 'y0' | 'z0' | 'x1' | 'y1' | 'z1', number>> = {}): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  const base = { x0: 10, y0: 10, z0: 0.2, x1: 20, y1: 10, z1: 0.2, e: 1, tool: 0, layer: 0 };
  b.addSegment({ ...base, kind: MoveKind.Extrude, srcByte: 0 });
  b.addSegment({ ...base, ...bad, kind: MoveKind.Extrude, srcByte: 10 });
  b.addSegment({ ...base, e: 0, kind: MoveKind.Travel, srcByte: 20 });
  b.addSegment({ ...base, x0: 30, x1: 40, kind: MoveKind.Extrude, srcByte: 30 });
  return b.finalize();
}

/** The same IR with its bounds boxes overwritten (a consumer handing in a `ToolpathIR` directly). */
function withBounds(ir: ToolpathIR, over: { bounds?: Box; modelBounds?: Box; objectBounds?: Box }): ToolpathIR {
  return { ...ir, ...over } as ToolpathIR;
}

const FINITE_BOX: Box = { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } };
const box = (maxX: number, minZ = 0): Box => ({ min: { x: 0, y: 0, z: minZ }, max: { x: maxX, y: 10, z: 10 } });

function makeRenderer(volume?: { x: number; y: number; z: number }) {
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
    chunksPerTick: 8,
    quality: 'lines',
    ...(volume ? { buildVolume: volume } : {}),
    createRenderer: () => stub,
    scheduleFrame: (cb) => ticks.push(cb)
  });
  return {
    renderer,
    runTicks: () => {
      while (ticks.length > 0) ticks.shift()?.();
    }
  };
}

function poseOf(r: ToolpathRenderer): number[] {
  const p = r.camera.position;
  return [p.x, p.y, p.z];
}

describe('buildChunks — non-finite endpoints are skipped and counted (#501)', () => {
  for (const [label, v] of [
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['NaN', NaN]
  ] as const) {
    it(`skips an extrude segment with x1 = ${label}`, () => {
      const r = buildChunks(makeIR({ x1: v }));
      expect(r.skippedNonFinite).toBe(1);
      expect(r.totalSegmentsIncluded).toBe(3);
      const kept = r.chunks.flatMap((c) => Array.from(c.segIndices)).sort();
      expect(kept).toEqual([0, 2, 3]);
      for (const c of r.chunks) for (const f of c.positions) expect(Number.isFinite(f)).toBe(true);
    });
  }

  it('skips a travel segment with a non-finite z0, whichever endpoint component it is', () => {
    for (const k of ['x0', 'y0', 'z0', 'x1', 'y1', 'z1'] as const) {
      const r = buildChunks(makeIR({ [k]: Infinity }));
      expect(r.skippedNonFinite).toBe(1);
    }
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    b.addSegment({ x0: 0, y0: 0, z0: 0.2, x1: 5, y1: 0, z1: 0.2, e: 1, kind: MoveKind.Extrude, layer: 0, srcByte: 0 });
    b.addSegment({ x0: 5, y0: 0, z0: Infinity, x1: 9, y1: 0, z1: 0.2, kind: MoveKind.Travel, layer: 0, srcByte: 10 });
    const r = buildChunks(b.finalize());
    expect(r.skippedNonFinite).toBe(1);
    expect(r.totalSegmentsIncluded).toBe(1);
    expect(r.chunks.filter((c) => c.kind === 'travel')).toEqual([]);
  });

  it('a well-formed IR reports skippedNonFinite 0', () => {
    expect(buildChunks(makeIR()).skippedNonFinite).toBe(0);
    expect(buildChunks(makeIR()).totalSegmentsIncluded).toBe(4);
  });

  it('a non-finite segment is not counted toward auto-decimation and never becomes a layer boundary', () => {
    // First extrude of the layer is the bad one: the boundary must be the first FINITE extrude (index 1).
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    const seg = (i: number, x1: number): void =>
      b.addSegment({
        x0: i,
        y0: 0,
        z0: 0.2,
        x1,
        y1: 0,
        z1: 0.2,
        e: 1,
        kind: MoveKind.Extrude,
        layer: 0,
        srcByte: i * 10
      });
    seg(0, Infinity);
    for (let i = 1; i <= 9; i++) seg(i, i + 1);
    const r = buildChunks(b.finalize(), { decimation: 5 });
    expect(r.skippedNonFinite).toBe(1);
    const kept = r.chunks.flatMap((c) => Array.from(c.segIndices)).sort((p, q) => p - q);
    expect(kept).toEqual([1, 5, 9]); // first/last finite extrude + every 5th
  });

  it('skipped segments do not inflate the tube-budget decimation', () => {
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    for (let i = 0; i < 6; i++) {
      b.addSegment({
        x0: i,
        y0: 0,
        z0: 0.2,
        x1: i < 4 ? i + 1 : Infinity,
        y1: 0,
        z1: 0.2,
        e: 1,
        kind: MoveKind.Extrude,
        layer: 0,
        srcByte: i * 10
      });
    }
    // 4 finite extrudes over a budget of 2 → every 2nd (not ceil(6 / 2) = 3).
    expect(buildChunks(b.finalize(), { tubeSegmentBudget: 2 }).decimationApplied).toBe(2);
  });

  it('an all-non-finite IR yields no chunks and no throw', () => {
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    b.addSegment({ x0: 0, y0: 0, z0: 0, x1: NaN, y1: 0, z1: 0, e: 1, kind: MoveKind.Extrude, layer: 0, srcByte: 0 });
    const r = buildChunks(b.finalize());
    expect(r.chunks).toEqual([]);
    expect(r.skippedNonFinite).toBe(1);
    expect(r.totalSegmentsIncluded).toBe(0);
  });
});

describe('buildChunks — explicit decimation validation (#501)', () => {
  for (const bad of [0, -1, -5, NaN, Infinity, -Infinity, 2.5]) {
    it(`rejects decimation ${String(bad)} with a RangeError`, () => {
      expect(() => buildChunks(makeIR(), { decimation: bad })).toThrow(RangeError);
      expect(() => buildChunks(makeIR(), { decimation: bad })).toThrow(
        `decimation must be a whole number >= 1 or 'auto' (got ${String(bad)})`
      );
    });
  }
  it('accepts 1, a whole number and "auto"', () => {
    expect(buildChunks(makeIR(), { decimation: 1 }).decimationApplied).toBe(1);
    expect(buildChunks(makeIR(), { decimation: 3 }).decimationApplied).toBe(3);
    expect(buildChunks(makeIR(), { decimation: 'auto' }).decimationApplied).toBe(1);
  });
});

describe('camera framing with non-finite bounds (#501)', () => {
  const VOLUME = { x: 200, y: 100, z: 50 };
  /** The pose of the volume-only fallback: what frame() must land on when no bounds are usable. */
  function fallbackPose(): number[] {
    const ref = makeRenderer(VOLUME);
    ref.renderer.frame();
    return poseOf(ref.renderer);
  }

  const cases: [string, Box][] = [
    ['max.x = Infinity', box(Infinity)],
    ['max.x = -Infinity', box(-Infinity)],
    ['max.x = NaN', box(NaN)],
    ['min.z = NaN', box(10, NaN)],
    ['min.z = Infinity', box(10, Infinity)],
    ['max.z = Infinity', { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: Infinity } }],
    ['max.y = NaN', { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: NaN, z: 10 } }]
  ];
  for (const [label, bounds] of cases) {
    it(`ir.bounds ${label} → finite camera, volume fallback`, () => {
      const { renderer, runTicks } = makeRenderer(VOLUME);
      renderer.setIR(withBounds(makeIR(), { bounds }));
      runTicks();
      renderer.frame();
      const pose = poseOf(renderer);
      for (const c of pose) expect(Number.isFinite(c)).toBe(true);
      expect(pose).toEqual(fallbackPose());
      renderer.dispose();
    });
  }

  it("a non-finite modelBounds falls to a finite objectBounds under frameContent 'object'", () => {
    const a = makeRenderer(VOLUME);
    a.renderer.setIR(withBounds(makeIR(), { modelBounds: box(Infinity), objectBounds: FINITE_BOX }));
    a.runTicks();
    a.renderer.setFrameContent('object');
    const ref = makeRenderer(VOLUME);
    ref.renderer.setIR(withBounds(makeIR(), { modelBounds: FINITE_BOX, objectBounds: FINITE_BOX }));
    ref.runTicks();
    ref.renderer.setFrameContent('object');
    for (const c of poseOf(a.renderer)) expect(Number.isFinite(c)).toBe(true);
    expect(poseOf(a.renderer)).toEqual(poseOf(ref.renderer));
    a.renderer.dispose();
    ref.renderer.dispose();
  });

  it("with no finite model/object bounds, 'object' discloses E_FRAME_CONTENT_UNAVAILABLE and frames finite bounds", () => {
    const { renderer, runTicks } = makeRenderer(VOLUME);
    const codes: string[] = [];
    renderer.onEvent((e) => {
      if (e.type === 'error') codes.push(e.code);
    });
    renderer.setIR(withBounds(makeIR(), { modelBounds: box(Infinity), objectBounds: box(NaN), bounds: FINITE_BOX }));
    runTicks();
    renderer.setFrameContent('object');
    expect(codes).toEqual(['E_FRAME_CONTENT_UNAVAILABLE']);
    for (const c of poseOf(renderer)) expect(Number.isFinite(c)).toBe(true);
    renderer.dispose();
  });

  it('a segment with an Infinity coordinate (builder-made IR) still frames to a finite camera', () => {
    const { renderer, runTicks } = makeRenderer(VOLUME);
    const ir = makeIR({ x1: Infinity });
    expect(ir.bounds.max.x).toBe(Infinity); // the premise: the builder carries it into bounds
    renderer.setIR(ir);
    runTicks();
    for (const c of poseOf(renderer)) expect(Number.isFinite(c)).toBe(true);
    expect(renderer.chunkMeshes.length).toBeGreaterThan(0); // the finite segments still draw
    renderer.dispose();
  });

  it('contact-shadow footprint ignores non-finite boxes', () => {
    const { renderer, runTicks } = makeRenderer(VOLUME);
    renderer.setIR(
      withBounds(makeIR(), { bounds: box(Infinity), modelBounds: box(NaN), objectBounds: box(-Infinity) })
    );
    runTicks();
    const fp = (renderer as unknown as { shadowFootprint(): unknown }).shadowFootprint();
    expect(fp).toBeNull();
    renderer.dispose();
  });

  it('pick threshold falls back to 0.5 mm when bounds are non-finite', () => {
    const { renderer, runTicks } = makeRenderer(VOLUME);
    renderer.setIR(withBounds(makeIR(), { bounds: box(Infinity) }));
    runTicks();
    expect((renderer as unknown as { pickThreshold(): number }).pickThreshold()).toBe(0.5);
    renderer.dispose();
  });

  it('progress marker keeps its default scale (1) when bounds are non-finite', () => {
    for (const bounds of [box(Infinity), box(NaN)]) {
      const { renderer, runTicks } = makeRenderer(VOLUME);
      renderer.setIR(withBounds(makeIR(), { bounds }));
      runTicks();
      const p: MappedProgress = {
        segIndex: 0,
        basis: 'byte',
        confidence: 'known',
        band: [0, 0],
        layerIndex: 0,
        stale: false,
        notes: []
      };
      renderer.setProgress(p);
      const marker = (renderer as unknown as { markerMesh: { scale: { x: number } } }).markerMesh;
      expect(marker.scale.x).toBe(1);
      renderer.dispose();
    }
  });

  it('progressive preview ignores non-finite slice bounds', () => {
    const { renderer } = makeRenderer(VOLUME);
    const slice = withBounds(makeIR(), {}) as ToolpathIR & { boundsWithTravel: Box };
    slice.boundsWithTravel = box(Infinity);
    renderer.appendPartial(slice);
    expect((renderer as unknown as { previewBounds: unknown }).previewBounds).toBeNull();
    for (const c of poseOf(renderer)) expect(Number.isFinite(c)).toBe(true);
    renderer.dispose();
  });
});

describe('build volume — bounded by construction (#501)', () => {
  const msg = (axis: string, extent: number, pitch: number, lines: number): string =>
    `buildVolume.${axis} of ${extent} mm at a ${pitch} mm grid needs ${lines} grid lines (> 10000 per axis)`;

  it('a huge but FINITE extent throws instead of looping 10 000+ grid lines', () => {
    expect(() => createBuildVolume({ x: 100010, y: 100, z: 50 })).toThrow(msg('x', 100010, 10, 10002));
    expect(() => createBuildVolume({ x: 100, y: 100010, z: 50 })).toThrow(msg('y', 100010, 10, 10002));
  });

  it('the cap is exactly 10 000 lines per axis', () => {
    expect(createBuildVolume({ x: 99990, y: 100, z: 50 })).toBeInstanceOf(Group); // 9999 + 1 = 10 000
    expect(() => createBuildVolume({ x: 100000, y: 100, z: 50 })).toThrow(msg('x', 100000, 10, 10001));
  });

  it('a tiny pitch over a normal bed hits the same cap', () => {
    expect(() => createBuildVolume({ x: 220, y: 220, z: 250, grid: 0.01 })).toThrow(msg('x', 220, 0.01, 22001));
  });

  it('the cap also guards non-rectangular beds (clipped-grid loops)', () => {
    expect(() =>
      createBuildVolume({
        x: 100010,
        y: 100,
        z: 50,
        shape: { kind: 'circular', center: { x: 0, y: 0 }, diameter: 100 }
      })
    ).toThrow(msg('x', 100010, 10, 10002));
  });

  it('a huge ORIGIN throws a typed error: the pitch no longer advances (1e20 + 10 === 1e20)', () => {
    const text = (axis: string, lo: number, hi: number): string =>
      `buildVolume ${axis} range ${lo}..${hi} is too large for a 10 mm grid (the grid pitch is below the coordinate precision)`;
    expect(() => createBuildVolume({ x: 100, y: 100, z: 50, min: { x: 1e20, y: 0 } })).toThrow(
      text('x', 1e20, 1e20 + 100)
    );
    expect(() => createBuildVolume({ x: 100, y: 100, z: 50, min: { x: 0, y: -1e20 } })).toThrow(
      text('y', -1e20, -1e20 + 100)
    );
  });

  it('the far edge alone is checked too (origin still advances, max does not)', () => {
    const lo = 2 ** 53 - 5; // 9007199254740987: +1 advances; lo + 10 = 9007199254740996: +1 does not
    expect(() => createBuildVolume({ x: 10, y: 100, z: 50, grid: 1, min: { x: lo, y: 0 } })).toThrow(
      'buildVolume x range 9007199254740987..9007199254740996 is too large for a 1 mm grid (the grid pitch is below the coordinate precision)'
    );
  });

  it('the origin alone is checked too (origin does not advance, max still does)', () => {
    const lo = -(2 ** 53) - 4; // -9007199254740996: +1 does not advance; lo + 16 = -9007199254740980: +1 does
    expect(() => createBuildVolume({ x: 16, y: 100, z: 50, grid: 1, min: { x: lo, y: 0 } })).toThrow(
      'buildVolume x range -9007199254740996..-9007199254740980 is too large for a 1 mm grid (the grid pitch is below the coordinate precision)'
    );
  });

  it('the loop bound never drops a line of a bed at the cap (10 000 lines)', () => {
    const g = createBuildVolume({ x: 99990, y: 100, z: 50 });
    const grid = g.children[0] as unknown as { geometry: { getAttribute(n: string): { count: number } } };
    expect(grid.geometry.getAttribute('position').count).toBe(2 * (10000 + 11));
  });

  it('a polygon bed at a huge origin is rejected the same way (clipped-grid loops)', () => {
    expect(() =>
      createBuildVolume({
        x: 100,
        y: 100,
        z: 50,
        min: { x: 1e20, y: 0 },
        shape: { kind: 'circular', center: { x: 1e20, y: 50 }, diameter: 100 }
      })
    ).toThrow(RangeError);
  });

  for (const v of [Infinity, -Infinity, NaN]) {
    it(`rejects extent ${String(v)}`, () => {
      expect(() => createBuildVolume({ x: v, y: 100, z: 50 })).toThrow(
        `buildVolume.x must be a finite number (got ${String(v)})`
      );
      expect(() => createBuildVolume({ x: 100, y: v, z: 50 })).toThrow(
        `buildVolume.y must be a finite number (got ${String(v)})`
      );
      expect(() => createBuildVolume({ x: 100, y: 100, z: v })).toThrow(
        `buildVolume.z must be a finite number (got ${String(v)})`
      );
      expect(() => createBuildVolume({ x: 100, y: 100, z: 50, min: { x: v, y: 0 } })).toThrow(
        `buildVolume.min.x must be a finite number (got ${String(v)})`
      );
      expect(() => createBuildVolume({ x: 100, y: 100, z: 50, min: { x: 0, y: v } })).toThrow(
        `buildVolume.min.y must be a finite number (got ${String(v)})`
      );
    });
  }

  for (const pitch of [0, -10, NaN, Infinity]) {
    it(`rejects grid pitch ${String(pitch)} (it used to loop forever)`, () => {
      expect(() => createBuildVolume({ x: 100, y: 100, z: 50, grid: pitch })).toThrow(RangeError);
      expect(() => createBuildVolume({ x: 100, y: 100, z: 50, grid: pitch })).toThrow(
        `buildVolume.grid must be a positive finite number (got ${String(pitch)})`
      );
    });
  }

  it('rejects non-finite shape and excluded-region points', () => {
    expect(() =>
      createBuildVolume({
        x: 100,
        y: 100,
        z: 50,
        shape: { kind: 'circular', center: { x: 0, y: 0 }, diameter: Infinity }
      })
    ).toThrow('buildVolume.shape (circular) must be finite (got Infinity)');
    expect(() =>
      createBuildVolume({ x: 100, y: 100, z: 50, shape: { kind: 'circular', center: { x: NaN, y: 0 }, diameter: 50 } })
    ).toThrow('buildVolume.shape (circular) must be finite (got NaN)');
    expect(() =>
      createBuildVolume({
        x: 100,
        y: 100,
        z: 50,
        shape: {
          kind: 'polygon',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: Infinity },
            { x: 0, y: 10 }
          ]
        }
      })
    ).toThrow('buildVolume.shape (polygon) points must be finite (got 10, Infinity)');
    expect(() =>
      createBuildVolume({
        x: 100,
        y: 100,
        z: 50,
        excludedRegions: [
          {
            kind: 'rect',
            points: [
              { x: NaN, y: 0 },
              { x: 5, y: 5 }
            ]
          }
        ]
      })
    ).toThrow('buildVolume.excludedRegions points must be finite (got NaN, 0)');
  });

  it('a normal bed still builds', () => {
    expect(createBuildVolume({ x: 220, y: 220, z: 250 })).toBeInstanceOf(Group);
    expect(createBuildVolume({ x: 0, y: 0, z: 0 })).toBeInstanceOf(Group);
  });

  it('setBuildVolume throws a RangeError and leaves the current volume untouched', () => {
    const { renderer } = makeRenderer({ x: 200, y: 100, z: 50 });
    const internals = renderer as unknown as { volumeGroup: Group; volumeDef: { x: number }; root: Group };
    const before = internals.volumeGroup;
    expect(() => renderer.setBuildVolume({ x: Infinity, y: 100, z: 50 })).toThrow(
      'buildVolume.x must be a finite number (got Infinity)'
    );
    expect(internals.volumeGroup).toBe(before);
    expect(internals.volumeDef.x).toBe(200);
    expect(internals.root.children).toContain(before);
    renderer.dispose();
  });

  it('the constructor rejects a bad volume with the same typed error', () => {
    expect(() => makeRenderer({ x: 100010, y: 100, z: 50 })).toThrow(RangeError);
  });
});
