/**
 * Progressive-preview partial pipeline tests (DD-004 §5.4, issue #60).
 *
 * Covers all three layers: the drivers' snapshot emission (async + streaming),
 * the delta contract (path-aligned cuts, byte-identical prefixes vs the sync
 * parse, resolved layers), and the worker protocol / session plumbing with the
 * configurable threshold.
 */
import { describe, expect, it } from 'vitest';
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';
import { parseGcodeToIR, parseGcodeToIRAsync } from '../parse';
import { parseGcodeStreamToIR, type ReadableStreamLike } from '../streaming';
import { createWorkerHandler } from '../worker-core';
import { GcodeParseSession, type WorkerLike } from '../session';
import type { WorkerRequest } from '../protocol';

const UNRESOLVED_LAYER = 0xffffffff;

/** Realistic shape: per-layer Z lift + travel between extrusion runs → paths close often. */
function layeredGcode(layers: number, perLayer: number): string {
  const out: string[] = ['G0 X10 Y10 Z0.2'];
  for (let l = 0; l < layers; l++) {
    out.push(`G0 X10 Y10 Z${(0.2 * (l + 1)).toFixed(2)}`); // travel: closes the previous path
    for (let s = 1; s <= perLayer; s++) {
      out.push(`G1 X${10 + (s % 60)} Y${10 + ((s * 3) % 40)} E${s} F1500`);
    }
  }
  return out.join('\n');
}

/** One giant unbroken extrusion path (vase-mode shape). */
function continuousGcode(lines: number): string {
  const out: string[] = ['G0 X0 Y0 Z0.2'];
  for (let i = 1; i <= lines; i++) {
    out.push(`G1 X${i % 50} Y${(i * 7) % 50} Z${(0.2 + i * 0.0001).toFixed(4)} E${i}`);
  }
  return out.join('\n');
}

function streamOf(text: string, chunkBytes: number): ReadableStreamLike<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return {
    getReader: () => ({
      read: () => {
        if (offset >= bytes.length) return Promise.resolve({ done: true as const });
        const value = bytes.subarray(offset, offset + chunkBytes);
        offset += chunkBytes;
        return Promise.resolve({ done: false as const, value });
      }
    })
  };
}

interface LoopbackWorker extends WorkerLike {
  terminateCalls: number;
}

function loopbackWorker(): LoopbackWorker {
  const w: LoopbackWorker = {
    onmessage: null,
    onerror: null,
    terminateCalls: 0,
    postMessage: () => undefined,
    terminate: () => undefined
  };
  const handler = createWorkerHandler((msg) => {
    void Promise.resolve().then(() => w.onmessage?.({ data: msg }));
  });
  w.postMessage = (m: unknown) => handler(m as WorkerRequest);
  w.terminate = () => {
    w.terminateCalls++;
  };
  return w;
}

describe('progressive preview partials (#60)', () => {
  it('async driver: path-aligned deltas, byte-identical to the sync parse prefix', async () => {
    const gcode = layeredGcode(60, 800); // ~48k segments
    const partials: { slice: ToolpathIR; cum: number }[] = [];
    const result = await parseGcodeToIRAsync(
      gcode,
      {},
      {
        yieldIntervalMs: 2,
        onPartial: (slice, cum) => partials.push({ slice, cum }),
        partialMinBytes: 0,
        partialIntervalMs: 0
      }
    );
    expect(result.ir.header.complete).toBe(true);
    expect(partials.length).toBeGreaterThanOrEqual(2);

    const sync = parseGcodeToIR(gcode).ir;
    let offset = 0;
    for (const { slice, cum } of partials) {
      expect(slice.header.complete).toBe(false);
      expect(slice.header.capabilities.layers).toBe('approximated');
      expect(slice.header.originOffset).toEqual(sync.header.originOffset);
      const n = slice.segments.count;
      expect(cum).toBe(offset + n); // consecutive, non-overlapping deltas
      // Byte-identical prefix: every channel matches the final sync parse.
      for (const ch of ['x0', 'y0', 'z0', 'x1', 'y1', 'z1', 'e', 'kind', 'srcByte'] as const) {
        expect(Array.from(slice.segments[ch])).toEqual(Array.from(sync.segments[ch].subarray(offset, offset + n)));
      }
      // Path-aligned cut: every included segment has a RESOLVED layer.
      for (let i = 0; i < n; i++) {
        expect(slice.segments.layer[i]).not.toBe(UNRESOLVED_LAYER);
        expect(slice.segments.layer[i]).toBe(sync.segments.layer[offset + i]);
      }
      offset += n;
    }
    expect(offset).toBeLessThanOrEqual(sync.segments.count);
  });

  it('partialMinBytes gates emission', async () => {
    const partials: ToolpathIR[] = [];
    await parseGcodeToIRAsync(
      layeredGcode(20, 500),
      {},
      { yieldIntervalMs: 2, onPartial: (s) => partials.push(s), partialMinBytes: Number.MAX_SAFE_INTEGER }
    );
    expect(partials.length).toBe(0);
  });

  it('streaming driver emits partials with the same delta contract', async () => {
    const gcode = layeredGcode(40, 600);
    const partials: ToolpathIR[] = [];
    const result = await parseGcodeStreamToIR(
      streamOf(gcode, 8 * 1024),
      {},
      { yieldIntervalMs: 2, onPartial: (s) => partials.push(s), partialMinBytes: 0, partialIntervalMs: 0 }
    );
    expect(result.ir.header.complete).toBe(true);
    expect(partials.length).toBeGreaterThanOrEqual(1);
    const sync = parseGcodeToIR(gcode).ir;
    const total = partials.reduce((a, s) => a + s.segments.count, 0);
    expect(total).toBeLessThanOrEqual(sync.segments.count);
    expect(Array.from(partials[0].segments.x0)).toEqual(
      Array.from(sync.segments.x0.subarray(0, partials[0].segments.count))
    );
  });

  it('a single unbroken extrusion path still emits (forced mid-path cut)', async () => {
    const partials: ToolpathIR[] = [];
    await parseGcodeToIRAsync(
      continuousGcode(80_000), // one path > FORCE_CUT_SEGMENTS
      {},
      { yieldIntervalMs: 2, onPartial: (s) => partials.push(s), partialMinBytes: 0, partialIntervalMs: 0 }
    );
    expect(partials.length).toBeGreaterThanOrEqual(1);
  });

  it('worker/session: partials stream when enabled; threshold respected by default', async () => {
    // Enabled with a zero threshold: partials arrive before done.
    const worker = loopbackWorker();
    const session = new GcodeParseSession({ worker });
    const partials: { count: number; cum: number }[] = [];
    session.onPartial((slice, cum) => partials.push({ count: slice.segments.count, cum }));
    const gcode = layeredGcode(60, 800);
    const result = await session.parse(gcode, {
      yieldIntervalMs: 2,
      partialPreview: { minInputBytes: 0, intervalMs: 0 }
    });
    expect(result.ir.header.complete).toBe(true);
    expect(partials.length).toBeGreaterThanOrEqual(1);
    const last = partials[partials.length - 1];
    expect(last.cum).toBe(partials.reduce((a, p) => a + p.count, 0));
    expect(last.cum).toBeLessThanOrEqual(result.ir.segments.count);
    session.dispose();

    // Default ('auto'): a small input never crosses the 25 MiB threshold — no partials.
    const worker2 = loopbackWorker();
    const session2 = new GcodeParseSession({ worker: worker2 });
    let defaultPartials = 0;
    session2.onPartial(() => defaultPartials++);
    await session2.parse(gcode, { yieldIntervalMs: 2 });
    expect(defaultPartials).toBe(0);
    session2.dispose();

    // Explicitly disabled: none either.
    const worker3 = loopbackWorker();
    const session3 = new GcodeParseSession({ worker: worker3 });
    let disabledPartials = 0;
    session3.onPartial(() => disabledPartials++);
    await session3.parse(gcode, { yieldIntervalMs: 2, partialPreview: false });
    expect(disabledPartials).toBe(0);
    session3.dispose();
  });
});
