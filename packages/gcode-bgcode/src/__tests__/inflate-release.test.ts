/**
 * inflate() must SETTLE and release the platform inflater on every exit (same bug class as #452 in
 * gcode-containers' zip.ts). Before the fix, the BOMB guard threw and then awaited the writer task
 * without cancelling the reader; with nobody reading, the writer stayed parked on backpressure and a
 * hostile DEFLATE block that inflates past the cap froze the load instead of throwing. The #451 bomb
 * tests used ~100-byte outputs, which fit in the stream buffers and never parked the writer, so these
 * use MiB-scale blocks and a timeout. Literal codes throughout.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deflateSync } from 'node:zlib';
import { ContainerError } from '@chestnutlabs/gcode-containers';
import { openBgcode } from '../index.js';
import { assembleBgcode, type AssembleBlock } from './assemble.js';

const MiB = 1048576;
const GCODE = 1;
const THUMB = 5;
const DEFLATE = 1;

/** A block whose stored bytes are zlib(`actual` × 'A') but which DECLARES `declared` bytes. */
function deflated(type: number, actual: number, declared: number): AssembleBlock {
  const stored = new Uint8Array(deflateSync(Buffer.alloc(actual, 0x41)));
  return {
    type,
    compression: DEFLATE,
    encoding: 0,
    thumbnail: type === THUMB ? { format: 0, width: 1, height: 1 } : undefined,
    data: new Uint8Array(0),
    preCompressed: { stored, uncompressedSize: declared }
  };
}

/** Await `p`, but give up after `ms`: returns the ContainerError, or the string 'HANG'. */
async function settleWithin(p: Promise<unknown>, ms = 10000): Promise<ContainerError | 'HANG'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hang = new Promise<'HANG'>((resolve) => (timer = setTimeout(() => resolve('HANG'), ms)));
  try {
    return await Promise.race([
      p.then(
        () => {
          throw new Error('expected a ContainerError, but the call resolved');
        },
        (e: unknown) => {
          expect(e).toBeInstanceOf(ContainerError);
          return e as ContainerError;
        }
      ),
      hang
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe('inflate settles on every exit (no hang on a hostile DEFLATE block)', () => {
  it('a 2 MiB G-code block vs a 1 MiB cap throws E_BGCODE_BOMB (does not hang)', async () => {
    const f = await assembleBgcode([deflated(GCODE, 2 * MiB, 2 * MiB)], { checksum: 'none' });
    const e = await settleWithin(openBgcode(f, { maxOutputBytes: MiB }));
    expect(e === 'HANG' ? 'HANG' : e.code).toBe('E_BGCODE_BOMB');
    if (e !== 'HANG') expect(e.message.startsWith('deflate output exceeds the declared/limit size (')).toBe(true);
  }, 20000);

  it('a 64 MiB G-code block vs a 1 MiB cap throws E_BGCODE_BOMB (does not hang)', async () => {
    const f = await assembleBgcode([deflated(GCODE, 64 * MiB, 64 * MiB)], { checksum: 'none' });
    const e = await settleWithin(openBgcode(f, { maxOutputBytes: MiB }));
    expect(e === 'HANG' ? 'HANG' : e.code).toBe('E_BGCODE_BOMB');
  }, 20000);

  it('a G-code block that declares 1 KiB but inflates to 4 MiB throws E_BGCODE_BOMB (default cap)', async () => {
    const f = await assembleBgcode([deflated(GCODE, 4 * MiB, 1024)], { checksum: 'none' });
    const e = await settleWithin(openBgcode(f));
    expect(e === 'HANG' ? 'HANG' : e.code).toBe('E_BGCODE_BOMB');
  }, 20000);

  it('a thumbnail that declares 1 KiB but inflates to 4 MiB throws E_BGCODE_BOMB (metadata path)', async () => {
    const f = await assembleBgcode([deflated(THUMB, 4 * MiB, 1024)], { checksum: 'none' });
    const e = await settleWithin(openBgcode(f, { metadata: true }));
    expect(e === 'HANG' ? 'HANG' : e.code).toBe('E_BGCODE_BOMB');
  }, 20000);

  it('a truncated 4 MiB stream throws E_BGCODE_INFLATE (cancelling an errored reader is swallowed)', async () => {
    const block = deflated(GCODE, 4 * MiB, 4 * MiB);
    const stored = block.preCompressed!.stored;
    block.preCompressed = { stored: stored.subarray(0, stored.length - 8), uncompressedSize: 4 * MiB };
    const f = await assembleBgcode([block], { checksum: 'none' });
    const e = await settleWithin(openBgcode(f));
    expect(e === 'HANG' ? 'HANG' : e.code).toBe('E_BGCODE_INFLATE');
  }, 20000);
});

describe('inflate releases the writer before returning', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('on a BOMB exit the reader is cancelled and the writer task has settled before openBgcode rejects', async () => {
    // A platform stream whose writer stays parked until the reader is cancelled, and is released a
    // macrotask later — so the writer only counts as settled if inflate actually awaited it.
    const log: string[] = [];
    let release: (() => void) | undefined;
    class FakeDecompressionStream {
      writable = {
        getWriter: () => ({
          write: () =>
            new Promise<void>((_, reject) => {
              release = () => reject(new Error('cancelled'));
            }).finally(() => log.push('writer settled')),
          close: () => Promise.resolve()
        })
      };
      readable = {
        getReader: () => ({
          read: () => Promise.resolve({ done: false, value: new Uint8Array(8).fill(0x41) }),
          cancel: () => {
            log.push('cancel');
            setTimeout(() => release?.(), 0);
            return Promise.resolve();
          }
        })
      };
    }
    vi.stubGlobal('DecompressionStream', FakeDecompressionStream);
    const f = await assembleBgcode([deflated(GCODE, 4, 4)], { checksum: 'none' });
    const e = await settleWithin(openBgcode(f), 5000);
    log.push('rejected');
    expect(e === 'HANG' ? 'HANG' : e.code).toBe('E_BGCODE_BOMB');
    expect(log).toEqual(['cancel', 'writer settled', 'rejected']);
  }, 20000);
});
