/*
 * streamEntry must always settle and always release its DecompressionStream.
 *
 * Regression for the weekly fuzz-containers `stream-entry` timeout: a deflate
 * entry whose headers claim a tiny size but which inflates past the cap made
 * streamEntry await its writer while the writer was parked on backpressure, so
 * the load never settled. Every test here races a 5 s timer: a hang fails with
 * "did not settle" instead of eating the suite timeout.
 */
import { deflateRawSync, crc32 as zcrc32 } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDirectory, streamEntry, ContainerError, type ZipEntry } from '../index.js';

const LIMITS = {
  maxEntries: 9,
  maxEntryNameBytes: 99,
  maxExpandedBytesPerEntry: 1e9,
  maxExpandedBytesTotal: 1e9,
  maxMetadataBytes: 1e6
};

/** One-entry ZIP holding `data` deflated; `claim` overrides both size headers (a lie). */
function deflateZip(data: Uint8Array, claim?: number, compressedOverride?: Uint8Array): Uint8Array {
  const comp = compressedOverride ?? new Uint8Array(deflateRawSync(data));
  const size = claim ?? data.byteLength;
  const crc = zcrc32(data);
  const name = new TextEncoder().encode('a.bin');
  const local = new Uint8Array(30 + name.length + comp.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(8, 8, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, comp.length, true);
  lv.setUint32(22, size, true);
  lv.setUint16(26, name.length, true);
  local.set(name, 30);
  local.set(comp, 30 + name.length);
  const cd = new Uint8Array(46 + name.length);
  const cv = new DataView(cd.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, comp.length, true);
  cv.setUint32(24, size, true);
  cv.setUint16(28, name.length, true);
  cd.set(name, 46);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, local.length, true);
  const zip = new Uint8Array(local.length + cd.length + eocd.length);
  zip.set(local, 0);
  zip.set(cd, local.length);
  zip.set(eocd, local.length + cd.length);
  return zip;
}

function entryOf(zip: Uint8Array): ZipEntry {
  return readDirectory(zip, LIMITS).entries[0]!;
}

function settles<T>(p: Promise<T>, ms = 5000): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`did not settle within ${ms} ms`)), ms);
  });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
}

async function drain(zip: Uint8Array, cap: number): Promise<number> {
  let n = 0;
  for await (const c of streamEntry(zip, entryOf(zip), cap)) n += c.byteLength;
  return n;
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ContainerError) return `${e.code}: ${e.message}`;
    return `untyped: ${String(e)}`;
  }
  return 'resolved';
}

/**
 * Wrap the platform DecompressionStream so a test can see whether the reader
 * was cancelled and whether every writer promise has settled.
 */
function trackDecompression({ cancelMs = 0, writeMs = 0 } = {}): {
  cancels: number;
  cancelsSettled: number;
  writerOps: Array<{ settled: boolean }>;
} {
  const Real = globalThis.DecompressionStream;
  const track = { cancels: 0, cancelsSettled: 0, writerOps: [] as Array<{ settled: boolean }> };
  // Cancel and writer promises can be made to settle late (as they can when a
  // platform tears down its inflater). Whichever is slower is the one a missing
  // await in streamEntry would leave unsettled when it returns.
  const note = (p: Promise<void>): Promise<void> => {
    const op = { settled: false };
    track.writerOps.push(op);
    const late = p.then(
      (v) => new Promise<void>((res) => setTimeout(() => res(v), writeMs)),
      (e: unknown) => new Promise<void>((_, rej) => setTimeout(() => rej(e), writeMs))
    );
    late.then(
      () => (op.settled = true),
      () => (op.settled = true)
    );
    return late;
  };
  class Tracked {
    readonly readable;
    readonly writable;
    constructor(format: 'deflate-raw') {
      const ds = new Real(format);
      this.readable = {
        getReader: () => {
          const r = ds.readable.getReader();
          return {
            read: () => r.read(),
            cancel: (reason?: unknown) => {
              track.cancels++;
              const late = r.cancel(reason).then(
                (v) => new Promise<void>((res) => setTimeout(() => res(v), cancelMs)),
                (e: unknown) => new Promise<void>((_, rej) => setTimeout(() => rej(e), cancelMs))
              );
              const done = () => void track.cancelsSettled++;
              late.then(done, done);
              return late;
            }
          };
        }
      };
      this.writable = {
        getWriter: () => {
          const w = ds.writable.getWriter();
          return {
            write: (c: Uint8Array) => note(w.write(c)),
            close: () => note(w.close())
          };
        }
      };
    }
  }
  vi.stubGlobal('DecompressionStream', Tracked);
  return track;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streamEntry settles when a lying deflate entry trips the cap mid-stream', () => {
  it('64 KiB inflated vs cap 1000 (headers claim 10 B)', async () => {
    const zip = deflateZip(new Uint8Array(64 * 1024).fill(0x41), 10);
    expect(await settles(codeOf(drain(zip, 1000)))).toBe(
      "E_CONTAINER_LIMIT_EXPANDED: entry 'a.bin' expanded past 1000 B — headers lied; extraction stopped"
    );
  });

  it('2 MiB inflated vs cap 1 MiB (headers claim 10 B), and the stream is released', async () => {
    const track = trackDecompression();
    const zip = deflateZip(new Uint8Array(2 * 1024 * 1024).fill(0x41), 10);
    expect(await settles(codeOf(drain(zip, 1024 * 1024)))).toBe(
      "E_CONTAINER_LIMIT_EXPANDED: entry 'a.bin' expanded past 1048576 B — headers lied; extraction stopped"
    );
    expect(track.cancels).toBe(1);
    expect(track.writerOps.length).toBeGreaterThan(0);
    expect(track.writerOps.every((o) => o.settled)).toBe(true);
  });
});

describe('streamEntry releases the stream on every exit', () => {
  it('early consumer exit (break) waits for a slow cancel before returning', async () => {
    const track = trackDecompression({ cancelMs: 60 });
    const zip = deflateZip(new Uint8Array(2 * 1024 * 1024).fill(0x41));
    let chunks = 0;
    await settles(
      (async () => {
        for await (const c of streamEntry(zip, entryOf(zip), 4 * 1024 * 1024)) {
          void c;
          chunks++;
          break;
        }
      })()
    );
    expect(chunks).toBe(1);
    expect(track.cancels).toBe(1);
    expect(track.cancelsSettled).toBe(1);
    expect(track.writerOps.length).toBeGreaterThan(0);
    // Checked with no extra await: streamEntry itself waited for the writer.
    expect(track.writerOps.every((o) => o.settled)).toBe(true);
  });

  it('early exit via return() waits for a slow writer before returning', async () => {
    const track = trackDecompression({ writeMs: 60 });
    const zip = deflateZip(new Uint8Array(2 * 1024 * 1024).fill(0x41));
    const gen = streamEntry(zip, entryOf(zip), 4 * 1024 * 1024);
    const first = await settles(gen.next());
    expect(first.done).toBe(false);
    expect(await settles(gen.return(undefined))).toEqual({ done: true, value: undefined });
    expect(track.cancels).toBe(1);
    expect(track.cancelsSettled).toBe(1);
    expect(track.writerOps.length).toBeGreaterThan(0);
    expect(track.writerOps.every((o) => o.settled)).toBe(true);
  });

  it('a fully drained honest entry does not cancel the reader', async () => {
    const track = trackDecompression();
    const zip = deflateZip(new Uint8Array(300 * 1024).fill(0x41));
    expect(await settles(drain(zip, 1024 * 1024))).toBe(300 * 1024);
    expect(track.cancels).toBe(0);
    expect(track.writerOps.every((o) => o.settled)).toBe(true);
  });

  it('corrupt deflate data still surfaces E_CONTAINER_INFLATE (errored reader cancel is swallowed)', async () => {
    const track = trackDecompression();
    const zip = deflateZip(new Uint8Array(100).fill(0x41), undefined, new Uint8Array(64).fill(0xff));
    const got = await settles(codeOf(drain(zip, 1024 * 1024)));
    expect(got.startsWith("E_CONTAINER_INFLATE: inflate failed for 'a.bin': ")).toBe(true);
    expect(track.cancels).toBe(1);
  });
});
