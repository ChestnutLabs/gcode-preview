/**
 * #449: the archive-wide `maxExpandedBytesTotal` budget and ContainerLimits validation. The budget
 * charges DISTINCT expanded bytes per archive: re-streaming an entry charges once, distinct entries
 * sum, a mid-stream trip counts the bytes produced so far, and every archive open gets a fresh budget.
 * Codes and messages are literal.
 */
import { describe, expect, it } from 'vitest';
import {
  ContainerError,
  DEFAULT_CONTAINER_LIMITS,
  ExpansionBudget,
  extractEntry,
  openGcode3mf,
  readDirectory,
  streamEntry,
  type ContainerLimits,
  type ZipEntry
} from '../index';
import { buildZip, type BuildEntry } from './zip-builder';

const L = DEFAULT_CONTAINER_LIMITS;

function syncErr(fn: () => unknown): ContainerError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ContainerError);
    return e as ContainerError;
  }
  throw new Error('expected a ContainerError, nothing was thrown');
}

async function asyncErr(fn: () => Promise<unknown>): Promise<ContainerError> {
  try {
    await fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ContainerError);
    return e as ContainerError;
  }
  throw new Error('expected a ContainerError, nothing was thrown');
}

async function drain(bytes: Uint8Array, entry: ZipEntry, cap: number, budget?: ExpansionBudget): Promise<number> {
  let n = 0;
  for await (const c of streamEntry(bytes, entry, cap, budget)) n += c.byteLength;
  return n;
}

/** a.txt = 60 stored bytes, b.txt = 40 stored bytes. */
const pair = (): { bytes: Uint8Array; a: ZipEntry; b: ZipEntry } => {
  const bytes = buildZip([
    { name: 'a.txt', data: 'a'.repeat(60) },
    { name: 'b.txt', data: 'b'.repeat(40) }
  ]).bytes;
  const [a, b] = readDirectory(bytes, L).entries;
  return { bytes, a, b };
};

describe('ExpansionBudget', () => {
  it.each([
    [NaN, 'NaN'],
    [Infinity, 'Infinity'],
    [-1, '-1'],
    [1.5, '1.5'],
    ['10', '10']
  ])('rejects a total of %s → E_CONTAINER_OPTION', (total, shown) => {
    const e = syncErr(() => new ExpansionBudget(total as number));
    expect(e.code).toBe('E_CONTAINER_OPTION');
    expect(e.message).toBe(`maxExpandedBytesTotal must be a non-negative integer (got ${shown})`);
  });

  it('accepts 0 and a positive integer total', () => {
    expect(new ExpansionBudget(0).total).toBe(0);
    expect(new ExpansionBudget(10).remainingFor('x')).toBe(10);
  });

  it('distinct entries sum: at the total passes, one over → E_CONTAINER_LIMIT_TOTAL', () => {
    const at = new ExpansionBudget(10);
    at.charge('a', 6);
    at.charge('b', 4);
    expect(at.remainingFor('c')).toBe(0);
    const over = new ExpansionBudget(10);
    over.charge('a', 6);
    const e = syncErr(() => over.charge('b', 5));
    expect(e.code).toBe('E_CONTAINER_LIMIT_TOTAL');
    expect(e.message).toBe("entry 'b' takes the archive past its 10 B expanded total; extraction stopped");
  });

  it('the same name charges its high-water mark once, never twice', () => {
    const b = new ExpansionBudget(10);
    b.charge('a', 6);
    b.charge('a', 6);
    b.charge('a', 3); // a re-stream that has produced less so far
    expect(b.remainingFor('b')).toBe(4);
    expect(b.remainingFor('a')).toBe(10);
    b.charge('a', 8); // grows past its old mark: only the delta is charged
    expect(b.remainingFor('b')).toBe(2);
    const e = syncErr(() => b.charge('b', 3));
    expect(e.code).toBe('E_CONTAINER_LIMIT_TOTAL');
  });

  it('a tripped charge records nothing', () => {
    const b = new ExpansionBudget(10);
    syncErr(() => b.charge('a', 11));
    expect(b.remainingFor('b')).toBe(10);
  });
});

describe('streamEntry/extractEntry with a budget', () => {
  it('claimed size vs the total: at the remaining budget passes, one over → E_CONTAINER_LIMIT_TOTAL (before output)', async () => {
    const { bytes, a } = pair();
    expect(await drain(bytes, a, 1024, new ExpansionBudget(60))).toBe(60);
    let yielded = 0;
    const e = await asyncErr(async () => {
      for await (const c of streamEntry(bytes, a, 1024, new ExpansionBudget(59))) yielded += c.byteLength;
    });
    expect(e.code).toBe('E_CONTAINER_LIMIT_TOTAL');
    expect(e.message).toBe("entry 'a.txt' claims 60 B, past the archive's 59 B expanded total");
    expect(yielded).toBe(0);
  });

  it('two distinct entries sum toward the total', async () => {
    const { bytes, a, b } = pair();
    const ok = new ExpansionBudget(100);
    expect((await extractEntry(bytes, a, 1024, ok)).byteLength).toBe(60);
    expect((await extractEntry(bytes, b, 1024, ok)).byteLength).toBe(40);
    const tight = new ExpansionBudget(99);
    await extractEntry(bytes, a, 1024, tight);
    const e = await asyncErr(() => extractEntry(bytes, b, 1024, tight));
    expect(e.code).toBe('E_CONTAINER_LIMIT_TOTAL');
    expect(e.message).toBe("entry 'b.txt' claims 40 B, past the archive's 99 B expanded total");
  });

  it('re-extracting the SAME entry charges once', async () => {
    const { bytes, a, b } = pair();
    const budget = new ExpansionBudget(100);
    await extractEntry(bytes, a, 1024, budget);
    await extractEntry(bytes, a, 1024, budget);
    await extractEntry(bytes, a, 1024, budget);
    expect((await extractEntry(bytes, b, 1024, budget)).byteLength).toBe(40);
  });

  it('a lying header trips the total mid-stream on the bytes produced so far', async () => {
    const lie = { uncompressedSize: 10 }; // real output is 200 bytes
    const bytes = buildZip([{ name: 'a.txt', data: 'A'.repeat(200), deflate: true, local: lie, central: lie }]).bytes;
    const entry = readDirectory(bytes, L).entries[0];
    expect(await drain(bytes, entry, 1024, new ExpansionBudget(200))).toBe(200);
    const e = await asyncErr(() => drain(bytes, entry, 1024, new ExpansionBudget(199)));
    expect(e.code).toBe('E_CONTAINER_LIMIT_TOTAL');
    expect(e.message).toBe("entry 'a.txt' takes the archive past its 199 B expanded total; extraction stopped");
  });

  it('a large lying entry yields bytes up to the total before the trip', async () => {
    const big = 'A'.repeat(4 * 1024 * 1024);
    const lie = { uncompressedSize: 10 };
    const bytes = buildZip([{ name: 'a.txt', data: big, deflate: true, local: lie, central: lie }]).bytes;
    const entry = readDirectory(bytes, L).entries[0];
    const total = 1024 * 1024;
    let yielded = 0;
    const e = await asyncErr(async () => {
      for await (const c of streamEntry(bytes, entry, 8 * 1024 * 1024, new ExpansionBudget(total))) {
        yielded += c.byteLength;
      }
    });
    expect(e.code).toBe('E_CONTAINER_LIMIT_TOTAL');
    expect(yielded).toBeGreaterThan(0);
    expect(yielded).toBeLessThanOrEqual(total);
  });

  it.each([
    [NaN, 'NaN'],
    [Infinity, 'Infinity'],
    [-1, '-1']
  ])('a cap of %s → E_CONTAINER_OPTION before any output', async (cap, shown) => {
    const { bytes, a } = pair();
    const e = await asyncErr(() => drain(bytes, a, cap));
    expect(e.code).toBe('E_CONTAINER_OPTION');
    expect(e.message).toBe(`cap must be a non-negative integer (got ${shown})`);
  });
});

describe('ContainerLimits validation (readDirectory)', () => {
  it.each(Object.keys(L) as (keyof ContainerLimits)[])('%s: NaN → E_CONTAINER_OPTION', (key) => {
    const { bytes } = pair();
    const e = syncErr(() => readDirectory(bytes, { ...L, [key]: NaN }));
    expect(e.code).toBe('E_CONTAINER_OPTION');
    expect(e.message).toBe(`${key} must be a non-negative integer (got NaN)`);
  });

  it('an absent field falls back to its default; a present one is used', () => {
    const { bytes } = pair();
    const partial = { maxEntries: undefined } as unknown as ContainerLimits;
    expect(readDirectory(bytes, partial).entries).toHaveLength(2);
    const e = syncErr(() => readDirectory(bytes, { maxEntries: 1 } as unknown as ContainerLimits));
    expect(e.code).toBe('E_CONTAINER_LIMIT_ENTRIES');
    expect(e.message).toBe('archive has 2 entries (> 1)');
  });
});

describe('openGcode3mf budget', () => {
  const PLATE_DATA = 'G1 X1 Y1\n'.repeat(10); // 90 B
  const SETTINGS_DATA = JSON.stringify({ printer_model: 'X' }); // 21 B
  const archive = (): Uint8Array =>
    buildZip([
      { name: 'Metadata/plate_1.gcode', data: PLATE_DATA },
      { name: 'Metadata/project_settings.config', data: SETTINGS_DATA }
    ] satisfies BuildEntry[]).bytes;
  const sum = PLATE_DATA.length + SETTINGS_DATA.length;

  async function readPlate(opened: Awaited<ReturnType<typeof openGcode3mf>>): Promise<number> {
    const r = opened.openPlate(0).getReader();
    let n = 0;
    for (;;) {
      const { done, value } = await r.read();
      if (done) return n;
      n += value!.byteLength;
    }
  }

  it('metadata + plate share one budget: at the total passes, one under → E_CONTAINER_LIMIT_TOTAL', async () => {
    expect(sum).toBe(111);
    const ok = await openGcode3mf(archive(), { ...L, maxExpandedBytesTotal: 111 });
    expect(ok.metadata.raw.printer_model).toBe('X');
    expect(await readPlate(ok)).toBe(90);
    const tight = await openGcode3mf(archive(), { ...L, maxExpandedBytesTotal: 110 });
    expect(tight.metadata.raw.printer_model).toBe('X');
    const e = await asyncErr(() => readPlate(tight));
    expect(e.code).toBe('E_CONTAINER_LIMIT_TOTAL');
    expect(e.message).toBe("entry 'metadata/plate_1.gcode' claims 90 B, past the archive's 110 B expanded total");
  });

  it('re-opening the same plate charges once; each archive open gets a fresh budget', async () => {
    const limits = { ...L, maxExpandedBytesTotal: 111 };
    const first = await openGcode3mf(archive(), limits);
    expect(await readPlate(first)).toBe(90);
    expect(await readPlate(first)).toBe(90);
    expect(await readPlate(first)).toBe(90);
    const second = await openGcode3mf(archive(), limits);
    expect(await readPlate(second)).toBe(90);
  });

  it('an invalid limit throws E_CONTAINER_OPTION before any extraction', async () => {
    const e = await asyncErr(() => openGcode3mf(archive(), { ...L, maxMetadataBytes: Infinity }));
    expect(e.code).toBe('E_CONTAINER_OPTION');
    expect(e.message).toBe('maxMetadataBytes must be a non-negative integer (got Infinity)');
  });

  it('absent limits use the defaults', async () => {
    const opened = await openGcode3mf(archive(), {} as ContainerLimits);
    expect(await readPlate(opened)).toBe(90);
  });
});
