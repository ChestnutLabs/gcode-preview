import { describe, expect, it } from 'vitest';
import { FeatureRole, MoveKind, ToolpathIRBuilder } from '../index';

/**
 * DD-026 D4/D5/D7 — the non-model classifier + `modelBounds` + `nonModelClassification`.
 *
 * `modelBounds` is produced by the builder's finalize (parse-time site). These build IRs with the
 * object/feature channels already populated (as the dialect runner leaves them post-annotation) and
 * assert the precedence, the confidence, and the honest empty-when-unknowable fallback.
 */

/** Add an extrude segment along +X at a fixed Y/Z with optional feature/object channels. */
function extrude(
  b: ToolpathIRBuilder,
  x: number,
  y: number,
  opts: { feature?: number; object?: number; kind?: number; src: number }
): void {
  b.addSegment({
    x0: x,
    y0: y,
    z0: 0.2,
    x1: x + 1,
    y1: y,
    z1: 0.2,
    e: 1,
    kind: opts.kind ?? MoveKind.Extrude,
    feature: opts.feature,
    object: opts.object,
    layer: 0,
    srcByte: opts.src
  });
}

describe('classifyModelBounds (DD-026 D4/D5/D7)', () => {
  it('membership present → known; modelBounds excludes the non-member prime line', () => {
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    // Prime line far off at the bed edge, object 0 (not a member).
    extrude(b, 5, 5, { object: 0, feature: FeatureRole.Custom, src: 0 });
    // The printed object, members, near x 100.
    extrude(b, 100, 100, { object: 1, feature: FeatureRole.Perimeter, src: 10 });
    extrude(b, 101, 100, { object: 1, feature: FeatureRole.Perimeter, src: 20 });
    const ir = b.finalize();

    expect(ir.header.capabilities.nonModelClassification).toBe('known');
    // Model bounds cover only the object (x 100..102), not the prime line at x 5.
    expect(ir.modelBounds.min.x).toBeCloseTo(100);
    expect(ir.modelBounds.max.x).toBeCloseTo(102);
  });

  it('a tower inside an open object bracket is excluded even though it has a member label (rule 1 beats rule 3)', () => {
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    extrude(b, 100, 100, { object: 1, feature: FeatureRole.Perimeter, src: 0 });
    // Bambu prime tower emitted while the object bracket is still open (object != 0, tower role).
    extrude(b, 200, 200, { object: 1, feature: FeatureRole.PrimeTower, src: 10 });
    const ir = b.finalize();

    expect(ir.header.capabilities.nonModelClassification).toBe('known');
    // Tower at x 200 is excluded; model bounds stay on the object at x 100..101.
    expect(ir.modelBounds.max.x).toBeCloseTo(101);
  });

  it('label-less file with a prime-tower role → inferred; modelBounds excludes the tower', () => {
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    extrude(b, 100, 100, { feature: FeatureRole.Perimeter, src: 0 });
    extrude(b, 101, 100, { feature: FeatureRole.Perimeter, src: 10 });
    extrude(b, 250, 250, { feature: FeatureRole.PrimeTower, src: 20 });
    const ir = b.finalize();

    expect(ir.header.capabilities.nonModelClassification).toBe('inferred');
    expect(ir.modelBounds.max.x).toBeCloseTo(102); // tower at x 250 excluded
  });

  it('label-less file with a skirt role → inferred; modelBounds excludes the skirt', () => {
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    extrude(b, 10, 10, { feature: FeatureRole.Skirt, src: 0 });
    extrude(b, 100, 100, { feature: FeatureRole.Perimeter, src: 10 });
    const ir = b.finalize();

    expect(ir.header.capabilities.nonModelClassification).toBe('inferred');
    expect(ir.modelBounds.min.x).toBeCloseTo(100); // skirt at x 10 excluded
  });

  it('no membership and nothing excludable → unavailable, modelBounds empty (honest, never a guess)', () => {
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    // A Simplify3D-style single object with an unmarked prime line: no object channel, no housekeeping
    // roles. We cannot tell the prime from the model, so we must not guess.
    extrude(b, 5, 5, { feature: FeatureRole.Custom, src: 0 });
    extrude(b, 100, 100, { feature: FeatureRole.Perimeter, src: 10 });
    const ir = b.finalize();

    expect(ir.header.capabilities.nonModelClassification).toBe('unavailable');
    expect(Number.isFinite(ir.modelBounds.min.x)).toBe(false);
  });

  it('equals objectBounds when only an object channel (no housekeeping roles) exists', () => {
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    extrude(b, 100, 100, { object: 1, src: 0 });
    extrude(b, 120, 130, { object: 1, src: 10 });
    const ir = b.finalize();

    expect(ir.modelBounds.min.x).toBeCloseTo(ir.objectBounds.min.x);
    expect(ir.modelBounds.max.x).toBeCloseTo(ir.objectBounds.max.x);
    expect(ir.modelBounds.max.y).toBeCloseTo(ir.objectBounds.max.y);
  });

  it('excludes wipe moves from modelBounds', () => {
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    extrude(b, 100, 100, { feature: FeatureRole.Skirt, src: 0 }); // makes it classifiable (inferred)
    extrude(b, 105, 100, { feature: FeatureRole.Perimeter, src: 10 });
    // A wipe move (extrude bit + wipe bit) far away — excluded by the wipe-kind rule.
    extrude(b, 300, 300, { kind: MoveKind.Extrude | MoveKind.Wipe, feature: FeatureRole.Perimeter, src: 20 });
    const ir = b.finalize();

    expect(ir.modelBounds.max.x).toBeCloseTo(106); // wipe at x 300 excluded
  });
});
