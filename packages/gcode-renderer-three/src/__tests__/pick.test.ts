/**
 * resolveHitSegment (#184): map a raycast hit's vertex index on a chunk mesh back to the IR segment
 * index. Pure — no GL — so the index math (the tricky part) is unit-tested; the raycast wiring in
 * pickSegment() is exercised in the demo.
 */
import { describe, expect, it } from 'vitest';
import type { LineSegments, Mesh } from 'three';
import { resolveHitSegment } from '../index.js';

/** A mesh-like object carrying the userData resolveHitSegment reads. */
function meshWith(userData: Record<string, unknown>) {
  return { userData } as unknown as LineSegments | Mesh;
}

const chunk = { count: 3, segIndices: Uint32Array.from([10, 11, 12]) };

describe('resolveHitSegment', () => {
  it('lines mode: 2 vertices per segment → IR segment via chunk.segIndices', () => {
    const mesh = meshWith({ chunk });
    expect(resolveHitSegment(mesh, 0)).toBe(10); // floor(0/2)=0
    expect(resolveHitSegment(mesh, 1)).toBe(10);
    expect(resolveHitSegment(mesh, 3)).toBe(11); // floor(3/2)=1
    expect(resolveHitSegment(mesh, 5)).toBe(12); // floor(5/2)=2
  });

  it('tube mode: a vertex→segment table maps the hit', () => {
    const mesh = meshWith({ chunk, vertexSegment: Uint32Array.from([0, 0, 1, 1, 2, 2]) });
    expect(resolveHitSegment(mesh, 4)).toBe(12); // vertexSegment[4]=2 → segIndices[2]
  });

  it('null for a non-chunk mesh or an out-of-range index', () => {
    expect(resolveHitSegment(meshWith({}), 0)).toBeNull();
    expect(resolveHitSegment(meshWith({ chunk }), 100)).toBeNull(); // floor(100/2)=50 ≥ count
  });
});
