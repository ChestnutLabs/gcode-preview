import { describe, expect, it } from 'vitest';
import { BudgetExceededError, SegmentWriter, type SegmentRecord } from '../growable';

/** Sweep G2: direct coverage of the budget-aware SoA writer (growth, compaction, snapshots, layers). */

const INITIAL = 4096; // INITIAL_CAPACITY
const CORE = 48; // bytes per segment, core channels (8 x Float32 + u8 + u16 + u32 + u8 + u32 + u32)

function rec(i: number, modal?: Record<string, number>): SegmentRecord {
  return {
    x0: i,
    y0: i + 0.5,
    z0: 0.2,
    x1: i + 1,
    y1: i + 1.5,
    z1: 0.2,
    e: 0.1,
    feedrate: 1200,
    kind: 1,
    tool: i % 3,
    layer: 7,
    srcByte: i * 10,
    ...(modal === undefined ? {} : { modal })
  };
}

describe('SegmentWriter accounting', () => {
  it('starts holding exactly the initial capacity', () => {
    const w = new SegmentWriter(1e9);
    expect(w.accounted).toBe(INITIAL * CORE);
    w.setExternalBytes(123);
    expect(w.accounted).toBe(INITIAL * CORE + 123);
  });

  it('modal columns add 4 B per segment per channel', () => {
    const w = new SegmentWriter(1e9, ['toolPower', 'spindle']);
    expect(w.accounted).toBe(INITIAL * (CORE + 8));
  });

  it('a budget of exactly the initial allocation is allowed; one byte less throws', () => {
    expect(() => new SegmentWriter(INITIAL * CORE)).not.toThrow();
    expect(() => new SegmentWriter(INITIAL * CORE - 1)).toThrow(BudgetExceededError);
  });

  it('growth doubles, frees the old capacity from the account, and keeps every value', () => {
    const w = new SegmentWriter(1e9, ['toolPower']);
    for (let i = 0; i < INITIAL + 1; i++) w.push(rec(i, { toolPower: i }));
    // After the grow only the new 8192-capacity set is held (old capacity released from the account).
    expect(w.accounted).toBe(2 * INITIAL * (CORE + 4));
    const out = w.finalize();
    expect(out.count).toBe(INITIAL + 1);
    for (const i of [0, 1, INITIAL - 1, INITIAL]) {
      expect(out.x0[i]).toBe(i);
      expect(out.y1[i]).toBe(i + 1.5);
      expect(out.tool[i]).toBe(i % 3);
      expect(out.layer[i]).toBe(7);
      expect(out.srcByte[i]).toBe(i * 10);
      expect(out.modal?.toolPower[i]).toBe(i);
    }
    expect(out.feature[INITIAL]).toBe(0);
    expect(out.object[INITIAL]).toBe(0);
  });

  it('growth that would exceed the budget throws BudgetExceededError before allocating', () => {
    // Initial 4096*48 fits; the grow needs another 8192*48 while the old set is still live.
    const w = new SegmentWriter(INITIAL * CORE + 2 * INITIAL * CORE - 1);
    for (let i = 0; i < INITIAL; i++) w.push(rec(i));
    expect(() => w.push(rec(INITIAL))).toThrow(BudgetExceededError);
    expect(w.count).toBe(INITIAL);
  });

  it('growth fitting the budget exactly succeeds', () => {
    const w = new SegmentWriter(INITIAL * CORE + 2 * INITIAL * CORE);
    for (let i = 0; i <= INITIAL; i++) w.push(rec(i));
    expect(w.count).toBe(INITIAL + 1);
  });

  it('external bytes count against the budget', () => {
    const w = new SegmentWriter(INITIAL * CORE + 2 * INITIAL * CORE);
    w.setExternalBytes(1);
    for (let i = 0; i < INITIAL; i++) w.push(rec(i));
    expect(() => w.push(rec(INITIAL))).toThrow(BudgetExceededError);
  });
});

describe('SegmentWriter finalize', () => {
  it('compacts to the exact count and the account drops to that size', () => {
    const w = new SegmentWriter(1e9);
    for (let i = 0; i < 3; i++) w.push(rec(i));
    const out = w.finalize();
    expect(out.count).toBe(3);
    expect(out.x0.length).toBe(3);
    expect(out.x0.buffer.byteLength).toBe(3 * 4);
    expect(w.accounted).toBe(3 * CORE);
  });

  it('compaction is budget-checked (old and new coexist)', () => {
    const w = new SegmentWriter(INITIAL * CORE + 2 * CORE);
    w.push(rec(0));
    w.push(rec(1));
    w.push(rec(2));
    expect(() => w.finalize()).toThrow(BudgetExceededError);
  });

  it('an empty writer compacts to one slot (not 0, which could never grow: 0 * 2 = 0)', () => {
    const w = new SegmentWriter(1e9);
    const out = w.finalize();
    expect(out.count).toBe(0);
    expect(out.x0.length).toBe(0);
    expect(w.accounted).toBe(CORE);
    // Still writable afterwards: a 0-capacity writer would drop these writes silently.
    w.push(rec(0));
    w.push(rec(1));
    expect([...w.finalize().x0]).toEqual([0, 1]);
  });

  it('missing modal values are NaN, never a fabricated 0', () => {
    const w = new SegmentWriter(1e9, ['toolPower']);
    w.push(rec(0));
    w.push(rec(1, {}));
    w.push(rec(2, { toolPower: 0 }));
    const p = w.finalize().modal?.toolPower as Float32Array;
    expect(Number.isNaN(p[0])).toBe(true);
    expect(Number.isNaN(p[1])).toBe(true);
    expect(p[2]).toBe(0);
  });
});

describe('SegmentWriter snapshots and layer rewrites', () => {
  it('snapshotRange copies [start, end) and is budget-checked', () => {
    const w = new SegmentWriter(INITIAL * CORE + 2 * CORE);
    for (let i = 0; i < 5; i++) w.push(rec(i));
    const snap = w.snapshotRange(1, 3);
    expect(snap.count).toBe(2);
    expect([...snap.x0]).toEqual([1, 2]);
    expect([...snap.srcByte]).toEqual([10, 20]);
    expect(() => w.snapshotRange(0, 3)).toThrow(BudgetExceededError);
  });

  it('an inverted snapshot range is empty with count 0', () => {
    const w = new SegmentWriter(1e9);
    for (let i = 0; i < 5; i++) w.push(rec(i));
    const snap = w.snapshotRange(4, 1);
    expect(snap.count).toBe(0);
    expect(snap.x0.length).toBe(0);
  });

  it('setLayerRange is inclusive of end; clearLayers zeroes every segment', () => {
    const w = new SegmentWriter(1e9);
    for (let i = 0; i < 5; i++) w.push(rec(i));
    w.setLayerRange(1, 3, 2);
    expect([...w.snapshotRange(0, 5).layer]).toEqual([7, 2, 2, 2, 7]);
    w.clearLayers();
    expect([...w.finalize().layer]).toEqual([0, 0, 0, 0, 0]);
  });
});
