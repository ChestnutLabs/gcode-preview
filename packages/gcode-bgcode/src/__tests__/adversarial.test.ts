/**
 * Adversarial / fuzz corpus for the `.bgcode` decoder (DD-011 §7 + phase 5, #188). Untrusted binary
 * input is the whole threat model: every path must fail as a **bounded, structured `ContainerError`** —
 * never a crash, an unbounded read/allocation, or a hang. Deterministic (seeded PRNG) so it's a
 * fast, reproducible per-PR gate, complementing the codec vectors and the real-file golden test.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContainerError } from '@chestnutlabs/gcode-containers';
import { openBgcode, openBgcodeContainer, BgcodeCompression, BgcodeEncoding, BgcodeBlockType } from '../index.js';
import { assembleBgcode } from './assemble.js';

const cube = new Uint8Array(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../test-data/fixtures/bgcode/prim-cube.bgcode'))
);

/** Deterministic PRNG (mulberry32) — reproducible fuzz. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The whole decode surface must only ever throw ContainerError, terminate, and stay bounded. */
async function exercise(bytes: Uint8Array): Promise<void> {
  const CAP = 1 * 1024 * 1024;
  for (const call of [
    () => openBgcode(bytes, { maxOutputBytes: CAP }),
    () => openBgcode(bytes, { maxOutputBytes: CAP, metadata: true }),
    () => openBgcodeContainer(bytes)
  ]) {
    try {
      await call();
    } catch (e) {
      if (e instanceof ContainerError) continue;
      throw e; // any other error type is a real defect
    }
  }
}

describe('adversarial: only bounded ContainerErrors escape (#188 §7)', () => {
  it('pure random bytes (500 seeds) never crash', async () => {
    const rand = rng(0x9e3779b9);
    for (let i = 0; i < 500; i++) {
      const n = Math.floor(rand() * 256);
      const b = new Uint8Array(n);
      for (let j = 0; j < n; j++) b[j] = Math.floor(rand() * 256);
      await exercise(b);
    }
  });

  it('random bytes behind a valid "GCDE" v1 header (500 seeds) never crash', async () => {
    const rand = rng(0x1234567);
    for (let i = 0; i < 500; i++) {
      const n = 10 + Math.floor(rand() * 200);
      const b = new Uint8Array(n);
      b.set([0x47, 0x43, 0x44, 0x45, 1, 0, 0, 0, 1, 0]); // GCDE, version 1, checksum CRC32
      for (let j = 10; j < n; j++) b[j] = Math.floor(rand() * 256);
      await exercise(b);
    }
  });

  it('bit-flipped mutations of a real .bgcode (400 seeds) never crash', async () => {
    const rand = rng(0xabcdef);
    for (let i = 0; i < 400; i++) {
      const b = cube.slice(0, 4096); // a prefix keeps it fast; the header + first blocks are the fragile part
      const flips = 1 + Math.floor(rand() * 8);
      for (let f = 0; f < flips; f++) b[Math.floor(rand() * b.length)] ^= 1 << Math.floor(rand() * 8);
      await exercise(b);
    }
  });

  it('garbage compressed payloads reach every decoder and stay bounded (checksum off)', async () => {
    const rand = rng(0x5eed);
    const codecs = [
      BgcodeCompression.None,
      BgcodeCompression.Deflate,
      BgcodeCompression.Heatshrink11,
      BgcodeCompression.Heatshrink12
    ];
    const encs = [BgcodeEncoding.None, BgcodeEncoding.MeatPack, BgcodeEncoding.MeatPackComments];
    for (let i = 0; i < 200; i++) {
      const stored = new Uint8Array(1 + Math.floor(rand() * 64));
      for (let j = 0; j < stored.length; j++) stored[j] = Math.floor(rand() * 256);
      const buf = await assembleBgcode(
        [
          {
            type: BgcodeBlockType.GCode,
            compression: codecs[Math.floor(rand() * codecs.length)],
            encoding: encs[Math.floor(rand() * encs.length)],
            data: new Uint8Array(),
            preCompressed: { stored, uncompressedSize: Math.floor(rand() * 1024) }
          }
        ],
        { checksum: 'none' }
      );
      await exercise(buf);
    }
  });

  it('an oversized declared uncompressed size cannot balloon memory', async () => {
    const buf = await assembleBgcode(
      [
        {
          type: BgcodeBlockType.GCode,
          compression: BgcodeCompression.None,
          encoding: BgcodeEncoding.None,
          data: new Uint8Array(),
          preCompressed: { stored: new Uint8Array(4), uncompressedSize: 0x7fffffff } // 2 GiB claim, 4 bytes of data
        }
      ],
      { checksum: 'none' }
    );
    await expect(openBgcode(buf)).rejects.toBeInstanceOf(ContainerError);
  });

  it('an unknown block type is walked past without a crash', async () => {
    const buf = await assembleBgcode([
      { type: 42, compression: BgcodeCompression.None, encoding: 0, data: new TextEncoder().encode('whatever') },
      {
        type: BgcodeBlockType.GCode,
        compression: BgcodeCompression.None,
        encoding: 0,
        data: new TextEncoder().encode('G1 X1\n')
      }
    ]);
    const { gcode } = await openBgcode(buf);
    expect(new TextDecoder().decode(gcode)).toBe('G1 X1\n'); // the unknown block ignored, the GCode block decoded
  });
});
