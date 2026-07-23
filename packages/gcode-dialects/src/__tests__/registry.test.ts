/**
 * Registry composition + sink application tests (DD-005 §4.1, issue #73).
 */
import { describe, expect, it } from 'vitest';
import { FeatureRole, MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { createDialectRunner } from '../registry';
import type { DialectAdapter } from '../contracts';

function makeIR(segments: number): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  for (let i = 0; i < segments; i++) {
    b.addSegment({
      x0: i,
      y0: 0,
      z0: 0.2,
      x1: i + 1,
      y1: 0,
      z1: 0.2,
      e: 1,
      kind: MoveKind.Extrude,
      layer: 0,
      srcByte: i * 10
    });
  }
  return b.finalize();
}

function adapter(id: string, kind: DialectAdapter['kind'], overrides: Partial<DialectAdapter> = {}): DialectAdapter {
  return {
    id,
    displayName: id,
    kind,
    detect: (input) =>
      input.headText.includes(id) ? { dialectId: id, kind, confidence: 'known', evidence: id } : null,
    ...overrides
  };
}

describe('dialect registry (#73)', () => {
  it('composes one winner per kind: slicer + firmware run together', () => {
    const runner = createDialectRunner([adapter('sliceA', 'slicer'), adapter('fwB', 'firmware')]);
    const run = runner.createRun({ selection: 'auto', headText: 'sliceA fwB', tailText: '' });
    expect(run).not.toBeNull();
    expect(run?.detections.map((d) => d.dialectId).sort()).toEqual(['fwB', 'sliceA']);
  });

  it('confidence tie within a kind selects NONE for that kind (never a guess)', () => {
    const runner = createDialectRunner([adapter('a1', 'slicer'), adapter('a2', 'slicer'), adapter('fw', 'firmware')]);
    const run = runner.createRun({ selection: 'auto', headText: 'a1 a2 fw', tailText: '' });
    expect(run?.detections.map((d) => d.dialectId)).toEqual(['fw']);
  });

  it('selection array restricts the pool; no matches → null run', () => {
    const runner = createDialectRunner([adapter('a1', 'slicer')]);
    expect(runner.createRun({ selection: ['other'], headText: 'a1', tailText: '' })).toBeNull();
    expect(runner.createRun({ selection: 'auto', headText: 'nothing here', tailText: '' })).toBeNull();
  });

  it('annotations apply to the finished IR: features, objects, capabilities, metadata', () => {
    const runner = createDialectRunner([
      adapter('sliceA', 'slicer', {
        onComment(comment, srcByte, sink) {
          if (comment.startsWith('TYPE:WALL')) sink.setFeature(0, 4, FeatureRole.ExternalPerimeter);
        },
        finalize(ir, sink) {
          sink.setObject(2, 3, 1);
          sink.defineObject(1, 'benchy');
          sink.upgradeCapability('featureRoles', 'known');
          sink.setMachine({
            bed: { kind: 'rect', min: { x: 0, y: 0 }, max: { x: 250, y: 210 } },
            origin: { x: 0, y: 0 },
            heightMm: 220,
            confidence: 'inferred',
            source: { adapterId: 'sliceA', evidence: 'bed_shape comment' }
          });
        }
      })
    ]);
    const run = runner.createRun({ selection: 'auto', headText: 'sliceA', tailText: '' });
    run?.onComment('TYPE:WALL-OUTER', 100);
    const ir = makeIR(10);
    const out = run?.finalize(ir);

    expect(Array.from(ir.segments.feature.subarray(0, 6))).toEqual([
      FeatureRole.ExternalPerimeter,
      FeatureRole.ExternalPerimeter,
      FeatureRole.ExternalPerimeter,
      FeatureRole.ExternalPerimeter,
      FeatureRole.ExternalPerimeter,
      0
    ]);
    expect(Array.from(ir.segments.object.subarray(0, 5))).toEqual([0, 0, 1, 1, 0]);
    expect(ir.objects[0]).toEqual({ id: '1', name: 'benchy' });
    expect(ir.header.capabilities.featureRoles).toBe('known');
    expect(ir.header.dialects.map((d) => d.id)).toEqual(['sliceA']);
    expect(out?.metadata?.machine?.bed.kind).toBe('rect');
    expect(out?.metadata?.machine?.source.adapterId).toBe('sliceA');
  });

  it('range writes are clamped to the real segment count', () => {
    const runner = createDialectRunner([
      adapter('sliceA', 'slicer', {
        finalize(_ir, sink) {
          sink.setFeature(5, 1_000_000, FeatureRole.Infill); // hostile over-range
          sink.setFeature(-5, 2, FeatureRole.Skirt); // negative start ignored
        }
      })
    ]);
    const run = runner.createRun({ selection: 'auto', headText: 'sliceA', tailText: '' });
    const ir = makeIR(10);
    run?.finalize(ir);
    expect(ir.segments.feature[4]).toBe(0);
    expect(ir.segments.feature[5]).toBe(FeatureRole.Infill);
    expect(ir.segments.feature[9]).toBe(FeatureRole.Infill);
    expect(ir.segments.feature[0]).toBe(0);
  });

  it('a throwing adapter is contained with an adapter-failed warning; others continue', () => {
    const runner = createDialectRunner([
      adapter('bad', 'slicer', {
        onComment() {
          throw new Error('boom');
        }
      }),
      adapter('fw', 'firmware', {
        finalize(_ir, sink) {
          sink.upgradeCapability('objects', 'known');
        }
      })
    ]);
    const run = runner.createRun({ selection: 'auto', headText: 'bad fw', tailText: '' });
    run?.onComment('anything', 0);
    run?.onComment('again', 1); // stays disabled, no rethrow
    const ir = makeIR(3);
    run?.finalize(ir);
    expect(ir.header.warnings.some((w) => w.code === 'adapter-failed')).toBe(true);
    expect(ir.header.capabilities.objects).toBe('known');
  });
});
