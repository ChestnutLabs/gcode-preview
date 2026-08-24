import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { framingFromCenterRadius } from '../stage.js';

describe('stage — framingFromCenterRadius (DD-018 Phase 0)', () => {
  it('maps printer-coord center → scene-coord target (x, z, -y)', () => {
    const { target } = framingFromCenterRadius(new Vector3(10, 20, 3), 50);
    expect([target.x, target.y, target.z]).toEqual([10, 3, -20]);
  });

  it('sizes viewHalfHeight at 1.25·radius and offsets the camera at the fixed 3/4 pose', () => {
    const r = 40;
    const { target, position, viewHalfHeight } = framingFromCenterRadius(new Vector3(0, 0, 0), r);
    expect(viewHalfHeight).toBe(r * 1.25);
    // Offset is relative to the scene-coord target: (-1.2r, +1.6r, +1.8r).
    expect(position.x).toBeCloseTo(target.x - r * 1.2, 10);
    expect(position.y).toBeCloseTo(target.y + r * 1.6, 10);
    expect(position.z).toBeCloseTo(target.z + r * 1.8, 10);
  });

  it('is pure — returns fresh vectors, mutates no input', () => {
    const center = new Vector3(1, 2, 3);
    const a = framingFromCenterRadius(center, 10);
    const b = framingFromCenterRadius(center, 10);
    expect(center.toArray()).toEqual([1, 2, 3]); // input untouched
    expect(a.target).not.toBe(b.target); // fresh allocations
    expect(a.target.toArray()).toEqual(b.target.toArray()); // deterministic
  });
});
