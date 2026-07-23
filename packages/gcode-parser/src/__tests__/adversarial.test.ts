/**
 * Adversarial corpus (DD-003 §7/§11, phase 3, issue #46).
 *
 * Every fixture in test-data/fixtures/adversarial must yield bounded warnings /
 * partial IR — never a hang, crash, or unhandled exception — through BOTH the
 * in-memory and streaming drivers.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseGcodeToIR, parseGcodeStreamToIR } from '../index';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const advDir = join(repoRoot, 'test-data', 'fixtures', 'adversarial');

const read = (name: string): Uint8Array => new Uint8Array(readFileSync(join(advDir, name)));

describe('adversarial corpus (#46)', () => {
  it('printable garbage: parses to an empty-ish IR with bounded warnings, no crash', () => {
    const { ir, stats } = parseGcodeToIR(read('garbage-printable.gcode'));
    expect(ir.header.complete).toBe(true);
    expect(stats.stopReason).toBeUndefined();
    // Warnings are aggregated per code, never unbounded.
    expect(ir.header.warnings.length).toBeLessThanOrEqual(10);
  });

  it('overlong line: skipped with a line-too-long warning; surrounding moves survive', () => {
    const { ir } = parseGcodeToIR(read('overlong-line.gcode'));
    expect(ir.header.complete).toBe(true);
    expect(ir.header.warnings.some((w) => w.code === 'line-too-long')).toBe(true);
    // The two valid moves around the monster line still parse.
    expect(ir.segments.count).toBe(2);
  });

  it('extreme/NaN coordinates: no crash, complete IR, NaNs never fabricated into bounds', () => {
    const { ir } = parseGcodeToIR(read('extreme-coords.gcode'));
    expect(ir.header.complete).toBe(true);
    expect(ir.segments.count).toBeGreaterThan(0);
    // Bounds must be numbers or infinities from real comparisons — never NaN.
    expect(Number.isNaN(ir.bounds.min.x)).toBe(false);
    expect(Number.isNaN(ir.boundsWithTravel.max.y)).toBe(false);
  });

  it('truncated file: the final unterminated line still parses', () => {
    const { ir } = parseGcodeToIR(read('truncated.gcode'));
    expect(ir.header.complete).toBe(true);
    // G0 + two full G1 moves + the truncated 'G1 X3.14' (a legal move) = 4 segments.
    expect(ir.segments.count).toBe(4);
  });

  it('zero-byte input: empty, complete IR', () => {
    const { ir, stats } = parseGcodeToIR(read('zero-byte.gcode'));
    expect(ir.header.complete).toBe(true);
    expect(ir.segments.count).toBe(0);
    expect(ir.layers.length).toBe(0);
    expect(stats.bytes).toBe(0);
  });

  it('the whole corpus also survives the STREAMING driver with tiny chunks', async () => {
    for (const name of [
      'garbage-printable.gcode',
      'overlong-line.gcode',
      'extreme-coords.gcode',
      'truncated.gcode',
      'zero-byte.gcode'
    ]) {
      const bytes = read(name);
      const result = await parseGcodeStreamToIR(new Blob([bytes]), {}, { yieldIntervalMs: 10 });
      expect(result.cancelled, name).toBe(false);
      expect(result.stats.stopReason, name).toBeUndefined();
      // Streaming must agree with in-memory on segment count for each fixture.
      const sync = parseGcodeToIR(bytes);
      expect(result.ir.segments.count, name).toBe(sync.ir.segments.count);
    }
  });
});
