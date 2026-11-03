/*
 * DD-008 D7 (#131): per-PR replay of the fuzzing regression corpus. Fast and
 * deterministic — the corpus is just more adversarial fixtures. Every input in
 * test-data/fixtures/fuzz-regressions/ must be handled by readDirectory +
 * exhaustive streamEntry with only typed ContainerErrors escaping, and the
 * process must never crash (the reason these inputs exist).
 *
 * Findings from the scheduled deep fuzz run are minimized into small, legal,
 * redistributable fixtures and committed here (manifest-tracked) — this test is
 * what turns a one-time finding into a permanent regression.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { crc32 as referenceCrc32 } from 'node:zlib';
import { readDirectory, streamEntry, extractEntry, ContainerError } from '../index.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const corpusDir = join(repoRoot, 'test-data', 'fixtures', 'fuzz-regressions');
const containersDir = join(repoRoot, 'test-data', 'fixtures', 'containers');
const adversarialDir = join(containersDir, 'adversarial');

const FUZZ_LIMITS = {
  maxEntries: 64,
  maxEntryNameBytes: 256,
  maxExpandedBytesPerEntry: 1 * 1024 * 1024,
  maxExpandedBytesTotal: 4 * 1024 * 1024,
  maxMetadataBytes: 256 * 1024
};
const CAP = 1 * 1024 * 1024;

async function exercise(bytes: Uint8Array): Promise<void> {
  let dir;
  try {
    dir = readDirectory(bytes, FUZZ_LIMITS);
  } catch (e) {
    if (e instanceof ContainerError) return;
    throw e;
  }
  for (const entry of dir.entries) {
    try {
      for await (const _chunk of streamEntry(bytes, entry, CAP)) void _chunk;
    } catch (e) {
      if (e instanceof ContainerError) continue;
      throw e;
    }
  }
}

/** Mirror of fuzz/fuzz-extract-entry.mjs: typed errors from the extract stage only; success = exact bytes. */
const EXTRACT_CODES = new Set([
  'E_CONTAINER_FORMAT',
  'E_CONTAINER_ENCRYPTED',
  'E_CONTAINER_HEADER_MISMATCH',
  'E_CONTAINER_LIMIT_EXPANDED',
  'E_CONTAINER_METHOD',
  'E_CONTAINER_INFLATE',
  'E_CONTAINER_CRC'
]);

async function exerciseExtract(bytes: Uint8Array): Promise<void> {
  let dir;
  try {
    dir = readDirectory(bytes, FUZZ_LIMITS);
  } catch (e) {
    if (e instanceof ContainerError) return;
    throw e;
  }
  for (const entry of dir.entries) {
    let out: Uint8Array;
    try {
      out = await extractEntry(bytes, entry, CAP);
    } catch (e) {
      if (e instanceof ContainerError && EXTRACT_CODES.has(e.code)) continue;
      throw e;
    }
    expect(out.byteLength).toBeLessThanOrEqual(CAP);
    expect(out.byteLength).toBe(entry.uncompressedSize);
    expect(referenceCrc32(out)).toBe(entry.crc32);
  }
}

const inputs = readdirSync(corpusDir).filter((f) => !f.startsWith('.') && f !== 'README.md');

const adversarial = readdirSync(adversarialDir).filter((f) => f.endsWith('.gcode.3mf'));

describe('fuzzing regression corpus (#131)', () => {
  it('has at least one committed regression input', () => {
    expect(inputs.length).toBeGreaterThan(0);
  });

  for (const name of inputs) {
    it(`only typed ContainerErrors escape for ${name}`, async () => {
      const bytes = new Uint8Array(readFileSync(join(corpusDir, name)));
      await expect(exercise(bytes)).resolves.toBeUndefined();
    });
  }
});

describe('scheduled stream-entry fuzz timeout seed', () => {
  // adv-size-lie made the weekly fuzz-containers stream-entry job time out every
  // week from 2026-07-27: streamEntry never settled once the cap tripped mid-stream.
  it('adv-size-lie settles at the fuzz cap with E_CONTAINER_LIMIT_EXPANDED', async () => {
    const bytes = new Uint8Array(readFileSync(join(containersDir, 'adv-size-lie.gcode.3mf')));
    const codes: string[] = [];
    const run = (async () => {
      for (const entry of readDirectory(bytes, FUZZ_LIMITS).entries) {
        try {
          for await (const _chunk of streamEntry(bytes, entry, CAP)) void _chunk;
        } catch (e) {
          codes.push(e instanceof ContainerError ? e.code : `untyped: ${String(e)}`);
        }
      }
    })();
    let t: ReturnType<typeof setTimeout> | undefined;
    const timer = new Promise<never>((_, reject) => {
      t = setTimeout(() => reject(new Error('adv-size-lie did not settle within 5000 ms')), 5000);
    });
    await Promise.race([run, timer]).finally(() => clearTimeout(t));
    expect(codes).toEqual(['E_CONTAINER_LIMIT_EXPANDED']);
  });
});

describe('extractEntry fuzz property replay (fuzz-extract-entry.mjs seeds)', () => {
  it('seeds the six committed adversarial inputs', () => {
    expect(adversarial.length).toBe(6);
  });

  const seeds = [
    ...inputs.map((n) => join(corpusDir, n)),
    ...adversarial.map((n) => join(adversarialDir, n))
  ];
  for (const file of seeds) {
    it(`typed extract-stage errors or exact bytes for ${basename(file)}`, async () => {
      await expect(exerciseExtract(new Uint8Array(readFileSync(file)))).resolves.toBeUndefined();
    });
  }
});
