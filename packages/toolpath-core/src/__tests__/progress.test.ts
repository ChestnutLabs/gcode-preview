import { describe, expect, it } from 'vitest';
import {
  createProgressMapper,
  MAX_PROGRESS_NOTES,
  MoveKind,
  PROGRESS_OBSERVATION_VERSION,
  ToolpathIRBuilder,
  type ProgressObservation,
  type ToolpathIR
} from '../index';

/**
 * 3 layers × 4 segments (12 total). srcByte = segIndex * 100 + 10, so segment i covers
 * source bytes [i*100+10, (i+1)*100+10). Layer L spans segments [L*4, L*4+3].
 */
function makeIR(): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  for (let i = 0; i < 12; i++) {
    const layer = Math.floor(i / 4);
    b.addSegment({
      x0: i,
      y0: 0,
      z0: 0.2 * (layer + 1),
      x1: i + 1,
      y1: 0,
      z1: 0.2 * (layer + 1),
      e: 1,
      kind: MoveKind.Extrude,
      layer,
      srcByte: i * 100 + 10
    });
  }
  return b.finalize();
}

function obs(position: ProgressObservation['position'], extra?: Partial<ProgressObservation>): ProgressObservation {
  return { v: 1, timestampMs: 1_000, position, ...extra };
}

describe('progress mapper — tier selection (DD-006 §4.3)', () => {
  const mapper = createProgressMapper(makeIR());

  it('byte wins over layer and percent', () => {
    const m = mapper.observe(obs({ byte: 510, layer: 0, percent: 0.1 }));
    expect(m.basis).toBe('byte');
    expect(m.segIndex).toBe(5);
    expect(m.confidence).toBe('known');
    expect(m.band).toEqual([5, 5]);
    expect(m.layerIndex).toBe(1);
  });

  it('layer wins over percent when byte is absent', () => {
    const m = mapper.observe(obs({ layer: 1, percent: 0.9 }));
    expect(m.basis).toBe('layer');
    expect(m.confidence).toBe('inferred');
    expect(m.segIndex).toBe(7); // last segment of layer 1
    expect(m.band).toEqual([4, 7]); // whole-layer band
    expect(m.layerIndex).toBe(1);
  });

  it('percent maps alone as approximated with a band', () => {
    const m = mapper.observe(obs({ percent: 0.5 }));
    expect(m.basis).toBe('percent');
    expect(m.confidence).toBe('approximated');
    expect(m.segIndex).toBe(Math.round(0.5 * 11));
    expect(m.band).not.toBeNull();
    const [lo, hi] = m.band!;
    expect(lo).toBeLessThan(m.segIndex!);
    expect(hi).toBeGreaterThan(m.segIndex!);
  });

  it('no usable facts → unavailable, never a fabricated position', () => {
    const m = mapper.observe(obs({}));
    expect(m).toMatchObject({ segIndex: null, basis: 'none', confidence: 'unavailable', band: null });
    expect(m.notes.map((n) => n.code)).toContain('no-position-facts');
  });
});

describe('progress mapper — byte tier edges', () => {
  const mapper = createProgressMapper(makeIR());

  it('exact segment starts and mid-segment bytes resolve to the segment in progress', () => {
    expect(mapper.observe(obs({ byte: 10 })).segIndex).toBe(0);
    expect(mapper.observe(obs({ byte: 109 })).segIndex).toBe(0);
    expect(mapper.observe(obs({ byte: 1_110 })).segIndex).toBe(11);
  });

  it('a byte before the first segment is honestly "nothing completed", not segment 0', () => {
    const m = mapper.observe(obs({ byte: 5 }));
    expect(m.segIndex).toBeNull();
    expect(m.basis).toBe('byte');
    expect(m.band).toBeNull();
    expect(m.notes.map((n) => n.code)).toContain('before-first-segment');
  });
});

describe('progress mapper — percent interpretation (D4)', () => {
  it('percentBasis "bytes" + known file size promotes through the byte machinery, still approximated', () => {
    const mapper = createProgressMapper(makeIR(), { fileSizeBytes: 1_210 });
    const m = mapper.observe(obs({ percent: 0.5, percentBasis: 'bytes' }));
    expect(m.basis).toBe('percent');
    expect(m.confidence).toBe('approximated');
    expect(m.segIndex).toBe(5); // 605 → segment 5
    expect(m.band).not.toBeNull();
  });

  it('file size can come from the observation identity when mapper opts omit it', () => {
    const mapper = createProgressMapper(makeIR());
    const m = mapper.observe(obs({ percent: 0.5, percentBasis: 'bytes' }, { file: { sizeBytes: 1_210 } }));
    expect(m.segIndex).toBe(5);
    expect(m.confidence).toBe('approximated');
  });

  it('job-basis percent never promotes — ordinal interpolation with a wide band', () => {
    const mapper = createProgressMapper(makeIR(), { fileSizeBytes: 1_210 });
    const m = mapper.observe(obs({ percent: 0.5, percentBasis: 'job' }));
    expect(m.basis).toBe('percent');
    expect(m.confidence).toBe('approximated');
    const [lo, hi] = m.band!;
    // Band at least covers the containing layer (§4.3 tier 5).
    expect(lo).toBeLessThanOrEqual(4);
    expect(hi).toBeGreaterThanOrEqual(7);
  });
});

describe('progress mapper — layer caveats', () => {
  const mapper = createProgressMapper(makeIR());

  it('an out-of-range layer clamps with a note', () => {
    const m = mapper.observe(obs({ layer: 99 }));
    expect(m.layerIndex).toBe(2);
    expect(m.segIndex).toBe(11);
    expect(m.notes.map((n) => n.code)).toContain('layer-out-of-range');
  });
});

describe('progress mapper — reserved fields & forward compatibility (D3 clarification)', () => {
  const mapper = createProgressMapper(makeIR());

  it('line is carried but unmapped in v1: visible fall-through, never a throw', () => {
    const m = mapper.observe(obs({ line: 42, layer: 1 }));
    expect(m.basis).toBe('layer');
    expect(m.notes.map((n) => n.code)).toContain('line-unmapped');
  });

  it('observations round-trip JSON serialization unchanged, including reserved and unknown fields', () => {
    const original = {
      v: 1,
      timestampMs: 1_000,
      position: { line: 42, percent: 0.25, percentBasis: 'job', futureField: 'kept' },
      file: { name: 'a.gcode' },
      someFutureTopLevel: { nested: true }
    };
    const roundTripped = JSON.parse(JSON.stringify(original));
    expect(roundTripped).toEqual(original);
    // And the mapper accepts the round-tripped object without error.
    const m = mapper.observe(roundTripped as ProgressObservation);
    expect(m.basis).toBe('percent');
    expect(m.confidence).toBe('approximated');
  });

  it('unknown percentBasis values degrade to ordinal interpolation, not an error', () => {
    const raw = obs({ percent: 0.5 });
    (raw.position as Record<string, unknown>).percentBasis = 'brand-new-basis';
    const m = mapper.observe(raw);
    expect(m.basis).toBe('percent');
    expect(m.confidence).toBe('approximated');
  });

  it('an unsupported contract version maps to unavailable with a note, not a throw', () => {
    const m = mapper.observe({ ...obs({ byte: 510 }), v: 2 as unknown as 1 });
    expect(m.confidence).toBe('unavailable');
    expect(m.notes.map((n) => n.code)).toContain('version-unsupported');
    expect(PROGRESS_OBSERVATION_VERSION).toBe(1);
  });
});

describe('progress mapper — malformed content never throws (DD-006 §6)', () => {
  const mapper = createProgressMapper(makeIR());

  it('NaN/negative/non-numeric fields are ignored field-by-field with notes', () => {
    const m = mapper.observe(
      obs({ byte: Number.NaN, layer: -1, percent: 'half' as unknown as number } as ProgressObservation['position'])
    );
    expect(m.confidence).toBe('unavailable');
    const codes = m.notes.map((n) => n.code);
    expect(codes.filter((c) => c === 'invalid-field').length).toBe(3);
    expect(m.notes.length).toBeLessThanOrEqual(MAX_PROGRESS_NOTES);
  });

  it('percent above 1 is rejected as invalid, not clamped into a fake position', () => {
    const m = mapper.observe(obs({ percent: 42 }));
    expect(m.segIndex).toBeNull();
    expect(m.notes.map((n) => n.code)).toContain('invalid-field');
  });
});

describe('progress mapper — state, staleness, reset', () => {
  it('state "complete" maps to the final segment with known confidence regardless of facts', () => {
    const mapper = createProgressMapper(makeIR());
    const m = mapper.observe(obs({ percent: 0.1 }, { state: 'complete' }));
    expect(m.segIndex).toBe(11);
    expect(m.confidence).toBe('known');
    expect(m.band).toEqual([11, 11]);
  });

  it('tick() flips stale after staleAfterMs and back on a fresh observation', () => {
    const mapper = createProgressMapper(makeIR(), { staleAfterMs: 1_000 });
    expect(mapper.observe(obs({ byte: 510 })).stale).toBe(false);
    expect(mapper.tick(1_500).stale).toBe(false);
    expect(mapper.tick(2_500).stale).toBe(true);
    // Stale result keeps the last mapped position — presentation degrades, position holds.
    expect(mapper.tick(2_500).segIndex).toBe(5);
    expect(mapper.observe({ ...obs({ byte: 510 }), timestampMs: 3_000 }).stale).toBe(false);
  });

  it('reset() returns to unavailable and tick() stays inert', () => {
    const mapper = createProgressMapper(makeIR());
    mapper.observe(obs({ byte: 510 }));
    mapper.reset();
    expect(mapper.tick(99_999)).toMatchObject({ segIndex: null, confidence: 'unavailable' });
  });
});
