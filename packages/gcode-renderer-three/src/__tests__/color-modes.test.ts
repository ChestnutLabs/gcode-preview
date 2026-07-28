// @vitest-environment happy-dom
/**
 * Color-by-speed (#177) and color-by-object (#178): additive capability-gated color modes over the
 * IR's `feedrate` / `object` channels, following the DD-009 renderer-options pattern. NaN feedrate and
 * object 0 degrade to the fallback (never a fabricated color); the scene gates each on its capability.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { buildChunkColors, feedrateRange, type GeometryChunk } from '../index.js';

type RGB = [number, number, number];
const A: RGB = [1, 0, 0];
const B: RGB = [0, 1, 0];
const F: RGB = [0.5, 0.5, 0.5];

/** N segments; per-segment feedrate and object taken from the arrays (undefined → NaN / 0). */
function makeIR(feedrates: (number | undefined)[], objects: number[]): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  for (let s = 0; s < feedrates.length; s++) {
    b.addSegment({
      x0: s,
      y0: 0,
      z0: 0.2,
      x1: s + 1,
      y1: 0,
      z1: 0.2,
      e: 1,
      kind: MoveKind.Extrude,
      layer: 0,
      srcByte: s * 10,
      feedrate: feedrates[s],
      object: objects[s]
    });
  }
  return b.finalize();
}

function fullChunk(count: number): GeometryChunk {
  return {
    kind: 'extrude',
    layerStart: 0,
    layerEnd: 0,
    count,
    positions: new Float32Array(count * 6),
    segIndices: Uint32Array.from(Array.from({ length: count }, (_, i) => i))
  };
}

const segColor = (colors: Float32Array, seg: number): RGB => [
  colors[seg * 6],
  colors[seg * 6 + 1],
  colors[seg * 6 + 2]
];

describe('color-by-speed / feedrate (#177)', () => {
  it('maps feedrate onto the ramp; NaN → fallback, auto-ranged', () => {
    const ir = makeIR([1000, 1500, 2000, undefined], [0, 0, 0, 0]);
    expect(feedrateRange(ir)).toEqual([1000, 2000]);
    const colors = buildChunkColors(ir, fullChunk(4), { mode: 'feedrate', ramp: [A, B], fallback: F });
    expect(segColor(colors, 0)).toEqual([1, 0, 0]); // min → ramp start
    expect(segColor(colors, 1)).toEqual([0.5, 0.5, 0]); // mid → interpolated
    expect(segColor(colors, 2)).toEqual([0, 1, 0]); // max → ramp end
    expect(segColor(colors, 3)).toEqual([0.5, 0.5, 0.5]); // NaN → fallback
  });

  it('honors an explicit range (stable scale across files)', () => {
    const ir = makeIR([1500, 1500], [0, 0]);
    const colors = buildChunkColors(ir, fullChunk(2), {
      mode: 'feedrate',
      ramp: [A, B],
      range: [1000, 2000],
      fallback: F
    });
    expect(segColor(colors, 0)).toEqual([0.5, 0.5, 0]); // 1500 within [1000,2000] → midpoint
  });
});

describe('color-by-object (#178)', () => {
  it('shades by object index; 0 → fallback', () => {
    const ir = makeIR([1000, 1000, 1000], [1, 2, 0]);
    const colors = buildChunkColors(ir, fullChunk(3), { mode: 'object', palette: [A, B], fallback: F });
    expect(segColor(colors, 0)).toEqual([1, 0, 0]); // object 1 → palette[0]
    expect(segColor(colors, 1)).toEqual([0, 1, 0]); // object 2 → palette[1]
    expect(segColor(colors, 2)).toEqual([0.5, 0.5, 0.5]); // object 0 (none) → fallback
  });

  it('`only` isolates one object (others dimmed to fallback)', () => {
    const ir = makeIR([1000, 1000], [1, 2]);
    const colors = buildChunkColors(ir, fullChunk(2), { mode: 'object', palette: [A, B], fallback: F, only: 1 });
    expect(segColor(colors, 0)).toEqual([1, 0, 0]); // the isolated object keeps its color
    expect(segColor(colors, 1)).toEqual([0.5, 0.5, 0.5]); // others → fallback
  });
});
