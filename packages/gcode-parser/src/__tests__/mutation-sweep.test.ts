/**
 * Mutation sweep over EXISTING parser code (2026-11 lane). Each test pins a behaviour that a hand-made
 * mutant showed no test guarded, or a defect the sweep found. Expected values are literals, never the
 * module's own constants.
 */
import { describe, expect, it } from 'vitest';
import { createDialectRunner, orcaBambu } from '@chestnutlabs/gcode-dialects';
import { parseGcodeToIR, type ParseOptions } from '../parse';
import { Rs274Context } from '../rs274';
import { parseGcodeStreamToIR, type ReadableStreamLike } from '../streaming';
import { createWorkerHandler, type ContainerAdapterLike, type WorkerHandlerOptions } from '../worker-core';
import { GcodeParseSession, type WorkerLike } from '../session';
import { PROTOCOL_VERSION, type WireParseOptions, type WorkerRequest, type WorkerResponse } from '../protocol';

/** Absolute end point, kind and E of every segment, plus the warning codes. */
function ends(gcode: string, opts?: ParseOptions) {
  const { ir, stats } = parseGcodeToIR(gcode, opts);
  const s = ir.segments;
  const o = ir.header.originOffset;
  const pts: { x: number; y: number; z: number; kind: number; e: number; tool: number }[] = [];
  for (let i = 0; i < s.count; i++) {
    pts.push({ x: o.x + s.x1[i], y: o.y + s.y1[i], z: o.z + s.z1[i], kind: s.kind[i], e: s.e[i], tool: s.tool[i] });
  }
  return { ir, stats, pts, codes: ir.header.warnings.map((w) => w.code) };
}

describe('helical arcs: the through axis ramps toward the target (defect: ramped away)', () => {
  it('G2 XY arc with a Z change rises monotonically from 0 to 5', () => {
    const arc = ends('G1 X0 Y0 Z0\nG2 X10 Y0 Z5 I5 J0\n').pts.slice(1); // seg 0 is the zero-length G1
    expect(arc.length).toBe(32); // half circle r=5: 15.708 mm / 0.5 mm = 31.4 → 32 segments
    expect(arc[0].z).toBeCloseTo(0.159, 3); // 5 / 31.4159
    for (let i = 1; i < arc.length; i++) expect(arc[i].z).toBeGreaterThanOrEqual(arc[i - 1].z);
    for (const p of arc) {
      expect(p.z).toBeGreaterThanOrEqual(0);
      expect(p.z).toBeLessThanOrEqual(5);
    }
    expect(arc[arc.length - 1].z).toBe(5);
  });

  it('a descending helix (CNC ramp entry) goes down, never up', () => {
    const arc = ends('G1 X0 Y0 Z0\nG3 X10 Y0 Z-2 I5 J0\n').pts.slice(1);
    for (const p of arc) {
      expect(p.z).toBeLessThanOrEqual(0);
      expect(p.z).toBeGreaterThanOrEqual(-2);
    }
    expect(arc[arc.length - 1].z).toBe(-2);
  });

  it('a G18 (XZ plane) arc ramps its through axis Y toward the target', () => {
    const arc = ends('G18\nG1 X0 Y0 Z0\nG2 X10 Z0 Y4 I5 K0\n').pts.slice(1);
    for (const p of arc) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(4);
    }
    expect(arc[arc.length - 1].y).toBe(4);
  });
});

describe('R-form arcs honour a negative radius (defect: always the short arc)', () => {
  const ys = (g: string) => ends(g).pts.map((p) => p.y);
  // Chord (0,0)→(10,0), |R| = 8: the centre sits h = sqrt(64 - 25) = 6.245 off the chord.
  it('G2 R8 takes the short arc; G2 R-8 the long arc', () => {
    expect(Math.max(...ys('G1 X0 Y0 Z0\nG2 X10 Y0 R8\n'))).toBeCloseTo(1.755, 2);
    expect(Math.max(...ys('G1 X0 Y0 Z0\nG2 X10 Y0 R-8\n'))).toBeCloseTo(14.245, 2);
  });

  it('G3 R8 takes the short arc below the chord; G3 R-8 the long arc', () => {
    expect(Math.min(...ys('G1 X0 Y0 Z0\nG3 X10 Y0 R8\n'))).toBeCloseTo(-1.755, 2);
    expect(Math.min(...ys('G1 X0 Y0 Z0\nG3 X10 Y0 R-8\n'))).toBeCloseTo(-14.245, 2);
  });

  it('an |R| shorter than half the chord still clamps to a half circle, either sign', () => {
    expect(Math.max(...ys('G1 X0 Y0 Z0\nG2 X10 Y0 R2\n'))).toBeCloseTo(5, 2);
    expect(Math.max(...ys('G1 X0 Y0 Z0\nG2 X10 Y0 R-2\n'))).toBeCloseTo(5, 2);
  });
});

describe('limits: an explicit `undefined` keeps the default bound (defect: disabled the bound)', () => {
  it('maxLineLength: undefined still skips a line over 64 KiB', () => {
    const { pts, codes } = ends('G1 X5 ;' + 'x'.repeat(70_000), { limits: { maxLineLength: undefined } });
    expect(pts.length).toBe(0);
    expect(codes).toContain('line-too-long');
  });

  it('maxProgramIterations: undefined still stops `o1 while [1]` (was an endless loop)', () => {
    const { codes } = ends('o1 while [1]\no1 endwhile\n', { limits: { maxProgramIterations: undefined } });
    expect(codes).toContain('rs274-iteration-limit');
  });

  it('maxCallDepth: undefined still stops runaway recursion at the default depth', () => {
    const prog = ['o100 sub', 'o100 call', 'o100 endsub', 'o100 call'].join('\n');
    const { codes } = ends(prog, { limits: { maxCallDepth: undefined } });
    expect(codes).toContain('rs274-call-depth');
    expect(codes).not.toContain('rs274-control-nesting');
  });

  it('maxWarnings: undefined still records warnings', () => {
    expect(ends('G1 X1\nM999\n', { limits: { maxWarnings: undefined } }).codes).toContain('unsupported-command');
  });

  it('a defined limit next to an undefined one still applies', () => {
    const { pts, ir } = ends('G1 X1\nG1 X2\nG1 X3\n', { limits: { maxSegments: 2, maxWarnings: undefined } });
    expect(pts.length).toBe(2);
    expect(ir.header.complete).toBe(false);
  });
});

describe('O-word flow bounds are exact', () => {
  const prog = ['G91', 'o1 repeat [2]', 'G1 X1', 'o1 endrepeat'].join('\n');

  it('maxProgramIterations counts each pass and each body statement: 4 units fit in 4, not in 3', () => {
    const fit = ends(prog, { limits: { maxProgramIterations: 4 } });
    expect(fit.pts.length).toBe(2);
    expect(fit.codes).not.toContain('rs274-iteration-limit');
    const over = ends(prog, { limits: { maxProgramIterations: 3 } });
    expect(over.pts.length).toBe(1);
    expect(over.codes).toContain('rs274-iteration-limit');
  });

  it('maxCallDepth 2 allows exactly two nested calls', () => {
    const rec = ['G91', 'o100 sub', 'G1 X1', 'o100 call', 'o100 endsub', 'o100 call'].join('\n');
    const { pts, codes } = ends(rec, { limits: { maxCallDepth: 2 } });
    expect(pts.length).toBe(2);
    expect(codes).toContain('rs274-call-depth');
  });

  it('a break inside a loop-less sub does not break the caller’s loop', () => {
    const p = ['o1 sub', 'o9 break', 'o1 endsub', 'G91', 'o2 repeat [3]', 'o1 call', 'G1 X1', 'o2 endrepeat'];
    const { pts, codes } = ends(p.join('\n'));
    expect(pts.length).toBe(3);
    expect(codes).toContain('rs274-misplaced-control');
  });

  it('repeat [2.5] runs twice (floor)', () => {
    expect(ends(['G91', 'o1 repeat [2.5]', 'G1 X1', 'o1 endrepeat'].join('\n')).pts.length).toBe(2);
  });

  it('control nesting of 256 runs; 257 is refused', () => {
    const nest = (n: number) => {
      const open = Array.from({ length: n }, (_, i) => `o${i} if [1]`);
      const close = Array.from({ length: n }, (_, i) => `o${n - 1 - i} endif`);
      return [...open, 'G1 X1', ...close].join('\n');
    };
    expect(ends(nest(256)).pts.length).toBe(1);
    const deep = ends(nest(257));
    expect(deep.pts.length).toBe(0);
    expect(deep.codes).toContain('rs274-control-nesting');
  });

  it('deep recursion stops at the execution-depth backstop, not the stack', () => {
    const rec = ['o100 sub', 'o100 call', 'o100 endsub', 'o100 call'].join('\n');
    const { codes } = ends(rec, { limits: { maxCallDepth: 5000 } });
    expect(codes).toContain('rs274-control-nesting');
    expect(codes).not.toContain('rs274-call-depth');
  });
});

describe('extruder datum', () => {
  it('relative E accumulates the datum, so a later switch to M82 measures from the true total', () => {
    const { pts } = ends('M83\nG1 X1 E1\nG1 X2 E1\nM82\nG1 X3 E3\n');
    expect(pts.map((p) => p.e)).toEqual([1, 1, 1]);
  });
});

describe('expression evaluator', () => {
  it('70 malformed bracket words on one line do not poison a later valid X[2] (depth leak)', () => {
    const { pts, codes } = ends('G1 ' + 'A[1+] '.repeat(70) + 'X[2]');
    expect(codes).toContain('rs274-bad-expression');
    expect(pts.length).toBe(1);
    expect(pts[0].x).toBe(2);
  });

  it('#5400 and up are system parameters: unsupported ones read 0 with a disclosure', () => {
    const { pts, codes } = ends('G1 X[#5400 + 3]');
    expect(codes).toContain('rs274-unsupported-sysparam');
    expect(pts[0].x).toBe(3);
  });

  it('#30 is the last call-local parameter: it is written and read in the same scope', () => {
    const { pts, codes } = ends('#30 = 7\nG1 X#30');
    expect(pts[0].x).toBe(7);
    expect(codes).not.toContain('rs274-uninitialized-param');
  });

  it('popScope never removes the main program scope', () => {
    const ctx = new Rs274Context(() => undefined, () => ({ x: 0, y: 0, z: 0 }));
    ctx.popScope();
    expect(ctx.lexLine('#1 = 4')).toEqual({ kind: 'assign' });
    expect(ctx.lexLine('G1 X#1')).toEqual({ kind: 'cmd', codes: ['g1'], params: { x: 4 } });
  });

  it('an existing named parameter can still be updated once the name store is full', () => {
    const lines = ['#<p0> = 1'];
    for (let i = 1; i < 5000; i++) lines.push(`#<p${i}> = 1`);
    lines.push('#<p0> = 9', 'G1 X#<p0>');
    const { pts, codes } = ends(lines.join('\n'));
    expect(pts[0].x).toBe(9);
    expect(codes).not.toContain('rs274-param-limit');
  });

  it('word operators must be word-bounded: `2 MODEXP[0]` is malformed, not `2 MOD EXP[0]`', () => {
    const { pts, codes } = ends('G1 X5\nG1 X[2 MODEXP[0]]');
    expect(codes).toContain('rs274-bad-expression');
    expect(pts.length).toBe(1);
  });

  it('a T word after an M code on a parametric line is a parameter, not a tool change', () => {
    const { pts } = ends('M104 T[1] S[200]\nG1 X10 E1');
    expect(pts[0].tool).toBe(0);
  });

  it('ATAN[y]/[x] takes y first (degrees)', () => {
    expect(ends('G1 X[ATAN[1]/[0]]').pts[0].x).toBe(90);
    expect(ends('G1 X[ATAN[0]/[1]] Y1').pts[0].x).toBe(0);
  });
});

// ---- worker handler / session / streaming --------------------------------------------------------

const enc = new TextEncoder();

/** A one-chunk-per-entry byte stream. */
function streamOf(...chunks: string[]): ReadableStreamLike<Uint8Array> {
  return {
    getReader() {
      let i = 0;
      return {
        read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true })
      };
    }
  };
}

/** A fake container whose single plate streams `gcode`; sniffs a `FAKE` prefix. */
function fakeContainer(gcode: string, filaments: { slot: number; type?: string; color?: string }[] = []) {
  const adapter: ContainerAdapterLike = {
    id: 'fake',
    sniff: (prefix) => new TextDecoder().decode(prefix.subarray(0, 4)) === 'FAKE',
    open: async () => ({
      id: 'fake',
      plates: [{ index: 0, name: 'p0', estimatedBytes: gcode.length }],
      metadata: { filaments, raw: { printer_model: 'Fake X1' }, warnings: [] },
      openPlate: () => streamOf(gcode)
    })
  };
  return adapter;
}

/** Drive the real worker handler until a terminal message; returns every posted message. */
function drive(
  input: WorkerRequest & { type: 'parse' },
  handlerOpts: WorkerHandlerOptions = {},
  after?: (handler: (m: WorkerRequest) => void) => void
): Promise<WorkerResponse[]> {
  return new Promise((resolve) => {
    const posted: WorkerResponse[] = [];
    const handler = createWorkerHandler((msg) => {
      posted.push(msg);
      if (msg.type === 'done' || msg.type === 'error' || msg.type === 'cancelled') resolve(posted);
    }, handlerOpts);
    handler(input);
    after?.(handler);
  });
}

const parseMsg = (input: WorkerRequest & { type: 'parse' }['input'], opts: WireParseOptions = {}) =>
  ({ v: PROTOCOL_VERSION, type: 'parse', id: 1, input, opts }) as WorkerRequest & { type: 'parse' };

describe('worker handler', () => {
  it('a cancel for a different id does not cancel the running parse', async () => {
    const lines = ['G0 X0 Y0'];
    for (let i = 1; i <= 2000; i++) lines.push(`G1 X${i % 50} Y${i % 7}`);
    const posted = await drive(parseMsg(lines.join('\n'), { yieldIntervalMs: 0 }), {}, (h) =>
      h({ v: PROTOCOL_VERSION, type: 'cancel', id: 99 })
    );
    expect(posted[posted.length - 1].type).toBe('done');
  });

  it('a negative plate index is refused before the container is read', async () => {
    const posted = await drive(parseMsg(enc.encode('FAKE container'), { plate: -1 }), {
      containers: [fakeContainer('G1 X1')]
    });
    const last = posted[posted.length - 1];
    expect(last.type).toBe('error');
    expect(last.type === 'error' && last.error).toEqual({
      code: 'E_CONTAINER_NO_PAYLOAD',
      message: 'plate -1 does not exist (container has 1)'
    });
  });

  it('container filament config wins per field over the G-code comments for the same slot', async () => {
    const gcode = '; generated by OrcaSlicer 2.1.1\n; filament_type = PLA\n; filament_colour = #00FF00\nG1 X1 Y1';
    const posted = await drive(parseMsg(enc.encode('FAKE container')), {
      containers: [fakeContainer(gcode, [{ slot: 0, type: 'PETG' }])],
      dialects: createDialectRunner([orcaBambu()])
    });
    const done = posted[posted.length - 1];
    expect(done.type).toBe('done');
    expect(done.type === 'done' && done.metadata?.filaments).toEqual([
      { slot: 0, type: 'PETG', color: '#00FF00', name: undefined }
    ]);
  });

  it('an explicit partialPreview threshold also wins when it is LOWER than the container default', async () => {
    const lines: string[] = ['M83'];
    for (let i = 0; i < 200; i++) lines.push(i % 2 === 0 ? `G0 X${i} Y0` : `G1 X${i} Y1 E1`);
    const posted = await drive(
      parseMsg(enc.encode('FAKE container'), { yieldIntervalMs: 0, partialPreview: { minInputBytes: 0, intervalMs: 0 } }),
      { containers: [fakeContainer(lines.join('\n'))] }
    );
    expect(posted.some((m) => m.type === 'partial')).toBe(true);
  });
});

describe('session', () => {
  it('ignores a terminal message carrying another parse id', async () => {
    const w: WorkerLike = { onmessage: null, onerror: null, postMessage: () => undefined, terminate: () => undefined };
    const session = new GcodeParseSession({ worker: w });
    const p = session.parse('G1 X1');
    const { ir, stats } = parseGcodeToIR('G1 X1');
    w.onmessage?.({ data: { v: PROTOCOL_VERSION, type: 'error', id: 42, error: { code: 'E_STALE', message: 'old' } } });
    w.onmessage?.({ data: { v: PROTOCOL_VERSION, type: 'done', id: 1, ir, stats } });
    await expect(p).resolves.toMatchObject({ ir: { segments: { count: 1 } } });
    session.dispose();
  });
});

describe('streaming limits and overlong lines', () => {
  it('a stream of exactly maxInputBytes is accepted', async () => {
    const r = await parseGcodeStreamToIR(streamOf('G1 X1\n'), { limits: { maxInputBytes: 6 } });
    expect(r.ir.header.complete).toBe(true);
    expect(r.ir.segments.count).toBe(1);
  });

  it('the unterminated tail of an overlong final line is discarded, not parsed', async () => {
    const r = await parseGcodeStreamToIR(streamOf('x'.repeat(40), 'yy G1 X9'), { limits: { maxLineLength: 16 } });
    expect(r.ir.segments.count).toBe(0);
    expect(r.ir.header.warnings.map((w) => w.code)).toContain('line-too-long');
  });

  it('the rest of an overlong line is discarded; the next line parses at its true offset', async () => {
    const r = await parseGcodeStreamToIR(streamOf('x'.repeat(40), 'zz G1 X9\nG1 X2\n'), {
      limits: { maxLineLength: 16 }
    });
    expect(r.ir.segments.count).toBe(1);
    expect(r.ir.header.originOffset.x + r.ir.segments.x1[0]).toBe(2);
    expect(r.ir.segments.srcByte[0]).toBe(49); // 40 + 'zz G1 X9\n'.length
  });
});

describe('engine details', () => {
  it('G83 with R at or below the final depth still drills one plunge', () => {
    const { pts } = ends('M3\nG0 X0 Y0 Z5\nG83 X1 Y1 Z1 R0 Q0.5\n');
    expect(pts.filter((p) => p.kind === 128).length).toBe(1); // Cut (1 << 7)
  });

  it('G92 inside a work offset sets the datum relative to that offset', () => {
    const { pts } = ends('G10 L2 P1 X5\nG54\nG1 X0\nG92 X0\nG1 X1\n');
    expect(pts[pts.length - 1].x).toBe(6);
  });

  it('G10 L20 sets the offset so the current position reads the given value', () => {
    const { pts } = ends('G1 X3\nG10 L20 P1 X0\nG1 X1\n');
    expect(pts[pts.length - 1].x).toBe(4);
  });
});
