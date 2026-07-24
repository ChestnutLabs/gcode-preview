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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { readDirectory, streamEntry, ContainerError } from '../index.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const corpusDir = join(repoRoot, 'test-data', 'fixtures', 'fuzz-regressions');

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

const inputs = readdirSync(corpusDir).filter((f) => !f.startsWith('.') && f !== 'README.md');

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
