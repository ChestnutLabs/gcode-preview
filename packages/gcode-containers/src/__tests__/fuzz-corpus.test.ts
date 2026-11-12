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
import { readDirectory, streamEntry, ContainerError } from '../index.js';
import { buildZip } from './zip-builder';
// The REAL fuzz target and limits, not copies. fuzz-extract-entry.mjs imports ../dist, so this file needs the
// dist build (`npm run gate` and CI build every package dist before the tests run).
// @ts-expect-error -- plain .mjs, no declaration file
import { extractAll } from '../../fuzz/fuzz-extract-entry.mjs';
// @ts-expect-error -- plain .mjs, no declaration file
import { FUZZ_LIMITS, FUZZ_STREAM_CAP as CAP } from '../../fuzz/limits.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const corpusDir = join(repoRoot, 'test-data', 'fixtures', 'fuzz-regressions');
const containersDir = join(repoRoot, 'test-data', 'fixtures', 'containers');
const adversarialDir = join(containersDir, 'adversarial');

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

  it('a multi-entry input trips the archive total: 800 KiB + 800 KiB + 100 KiB → E_CONTAINER_LIMIT_TOTAL on the second only', async () => {
    const bytes = buildZip([
      { name: 'a.txt', data: 'a'.repeat(800 * 1024) },
      { name: 'b.txt', data: 'b'.repeat(800 * 1024) },
      { name: 'c.txt', data: 'c'.repeat(100 * 1024) }
    ]).bytes;
    // a (800 KiB) fits the 1536 KiB total; b would reach 1600 KiB and trips; c (900 KiB cumulative) fits.
    expect(await extractAll(bytes)).toEqual(['E_CONTAINER_LIMIT_TOTAL']);
  });

  it('the archive total is 1536 KiB, not the 1 MiB per-entry cap: 600 KiB + 600 KiB (1200 KiB) extracts cleanly', async () => {
    const bytes = buildZip([
      { name: 'a.txt', data: 'a'.repeat(600 * 1024) },
      { name: 'b.txt', data: 'b'.repeat(600 * 1024) }
    ]).bytes;
    expect(await extractAll(bytes)).toEqual([]);
  });

  it('multi-entry-total.zip (1802 B, 2 × 800 KiB deflate — within the fuzzer max_len of 4096) reaches the archive total', async () => {
    const bytes = new Uint8Array(readFileSync(join(corpusDir, 'multi-entry-total.zip')));
    expect(bytes.byteLength).toBe(1802);
    expect(await extractAll(bytes)).toEqual(['E_CONTAINER_LIMIT_TOTAL']);
  });

  const seeds = [...inputs.map((n) => join(corpusDir, n)), ...adversarial.map((n) => join(adversarialDir, n))];
  for (const file of seeds) {
    it(`typed extract-stage errors or exact bytes for ${basename(file)}`, async () => {
      await expect(extractAll(new Uint8Array(readFileSync(file)))).resolves.toBeInstanceOf(Array);
    });
  }
});
