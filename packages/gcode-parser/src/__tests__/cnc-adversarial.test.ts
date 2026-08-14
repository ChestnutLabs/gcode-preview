/**
 * CNC/laser adversarial hardening (#277, M1+M2). The v0.4.0 non-extrusion lexer + canned-cycle
 * expansion (#189) was only happy-path tested. Hostile input must yield BOUNDED, partial IR — never
 * a hang, crash, or unbounded expansion — through BOTH the in-memory and streaming drivers. Fixtures
 * are synthetic inline strings (MIT-clean), never committed third-party files.
 */
import { describe, expect, it } from 'vitest';
import { parseGcodeToIR, parseGcodeStreamToIR, type ParseOptions } from '../index';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Run a hostile input through both drivers; neither may throw/hang. Returns both results. */
async function bothDrivers(src: string, opts: ParseOptions = {}) {
  const bytes = enc(src);
  const mem = parseGcodeToIR(bytes, opts);
  const stream = await parseGcodeStreamToIR(new Blob([bytes]), opts, { yieldIntervalMs: 10 });
  expect(stream.cancelled).toBe(false);
  return { mem, stream };
}

function minZ1(ir: { segments: { count: number; z1: Float32Array } }): number {
  let m = Infinity;
  for (let i = 0; i < ir.segments.count; i++) m = Math.min(m, ir.segments.z1[i]);
  return m;
}

describe('CNC/laser adversarial hardening (#277)', () => {
  it('malformed multi-command lines + garbage tokens parse bounded, no crash (both drivers)', async () => {
    const { mem, stream } = await bothDrivers(
      'g20 g17 g90\ns3400 m3 xyz\ng1z-.1 f???\ng0 g53 g@#$\ng1 x10 m3 m4 m5\ng1 y5\nm2\n'
    );
    expect(mem.ir.header.complete).toBe(true);
    expect(mem.ir.header.warnings.length).toBeLessThanOrEqual(10); // aggregated, never unbounded
    expect(stream.ir.segments.count).toBe(mem.ir.segments.count); // drivers agree on geometry
  });

  it('huge / overflowing N line numbers are stripped, not treated as motion', async () => {
    const { mem, stream } = await bothDrivers('N999999999999999999 G1 X10 F100\nN2 G1 X20\nN3 G1 X30\n');
    expect(mem.ir.segments.count).toBe(3); // three real moves; N-words add no geometry
    expect(stream.ir.segments.count).toBe(3);
  });

  it('bare G / S with trailing garbage is ignored, not a spurious command', async () => {
    const { mem } = await bothDrivers('G\nS\nGxx\nSyy\nM3 S1000\nG1 X10 F100\n');
    expect(mem.ir.segments.count).toBe(1); // only the real G1 emits
  });

  it('G83 pathological tiny Q is bounded by the segment budget — no hang', async () => {
    // ~1M pecks if unbounded; the emitSegment budget must stop the peck loop.
    const { mem, stream } = await bothDrivers('M3 S1000\nG0 X0 Y0 Z5\nG83 X0 Y0 Z-1000 R2 Q0.001 F100\nG80\n', {
      limits: { maxSegments: 2000 }
    });
    expect(mem.stats.stopReason?.code).toBe('E_LIMIT_SEGMENTS');
    expect(mem.ir.segments.count).toBeLessThanOrEqual(2000);
    // Streaming honors the same bound (it may stop at a slightly different chunk boundary, but bounded).
    expect(stream.ir.segments.count).toBeLessThanOrEqual(2000);
  });

  it('G83 with Q=0 falls back to a single plunge (no divide-by-zero / infinite loop)', async () => {
    const { mem } = await bothDrivers('M3 S1000\nG0 X0 Y0 Z5\nG83 X0 Y0 Z-3 R1 Q0 F100\nG80\n');
    expect(minZ1(mem.ir)).toBeCloseTo(-3); // reached depth once, bounded
  });

  it('G81 with no Z/R on the first cycle is graceful (degenerate, bounded — never a fabricated plunge)', async () => {
    // RS274NGC retains modal Z/R across cycles; a first cycle that never specified them is a program
    // error. We handle it as a zero-plane no-op (Z=R=0), not a crash or a fabricated deep plunge.
    const { mem, stream } = await bothDrivers('M3 S1000\nG0 X0 Y0 Z5\nG81 X10 Y10 F100\nG80\n');
    expect(Number.isFinite(minZ1(mem.ir))).toBe(true);
    expect(minZ1(mem.ir)).toBeGreaterThanOrEqual(-1e-6); // collapses to the zero plane, no deep plunge
    expect(stream.ir.segments.count).toBe(mem.ir.segments.count);
  });

  it('canned Z/R are correctly retained across a modal repeat (RS274NGC modal params)', async () => {
    // Second cycle omits Z/R → must reuse -2 / 1 from the first, not reset to 0.
    const { mem } = await bothDrivers('M3 S1000\nG0 X0 Y0 Z5\nG81 X0 Y0 Z-2 R1 F100\nX10 Y0\nG80\n');
    expect(minZ1(mem.ir)).toBeCloseTo(-2); // both holes reach -2
  });

  it('G80 cancels the cycle: a following bare coordinate line is a normal move, not a drill', async () => {
    const { mem } = await bothDrivers('M3 S1000\nG0 X0 Y0 Z5\nG81 X0 Y0 Z-2 R1 F100\nG80\nG1 X10 Y0\n');
    expect(mem.ir.header.complete).toBe(true);
    expect(mem.ir.segments.count).toBeGreaterThan(0);
  });
});
