/**
 * Streaming-input tests (DD-003 §4.2, phase 3, issue #46).
 *
 * The load-bearing property: a stream parse must produce an IR IDENTICAL to the
 * in-memory parse of the same bytes — proven by digest equality on the real
 * 3DBenchy fixture chunked at awkward boundaries.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseGcodeToIR, parseGcodeStreamToIR } from '../index';
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function fnv1a(view: ArrayBufferView): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function digests(ir: ToolpathIR): Record<string, string> {
  const s = ir.segments;
  return {
    x0: fnv1a(s.x0),
    y0: fnv1a(s.y0),
    z0: fnv1a(s.z0),
    x1: fnv1a(s.x1),
    y1: fnv1a(s.y1),
    z1: fnv1a(s.z1),
    e: fnv1a(s.e),
    feedrate: fnv1a(s.feedrate),
    kind: fnv1a(s.kind),
    tool: fnv1a(s.tool),
    layer: fnv1a(s.layer),
    srcByte: fnv1a(s.srcByte)
  };
}

/** Chunk bytes at a fixed size that deliberately cuts lines (and numbers) apart. */
function chunkedStream(bytes: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
      offset += chunkSize;
    }
  });
}

describe('streaming inputs (#46)', () => {
  it('ReadableStream parse is byte-identical to the in-memory parse (3DBenchy, awkward 1013 B chunks)', async () => {
    const bytes = new Uint8Array(readFileSync(join(repoRoot, 'demo/gcodes/3DBenchy.gcode')));
    const sync = parseGcodeToIR(bytes);
    const streamed = await parseGcodeStreamToIR(chunkedStream(bytes, 1013), {}, { yieldIntervalMs: 10 });

    expect(streamed.cancelled).toBe(false);
    expect(streamed.ir.header.complete).toBe(true);
    expect(streamed.ir.segments.count).toBe(sync.ir.segments.count);
    expect(digests(streamed.ir)).toEqual(digests(sync.ir));
    expect(streamed.ir.layers.length).toBe(sync.ir.layers.length);
    expect(streamed.stats.bytes).toBe(bytes.byteLength);
  });

  it('Blob parse matches too, and a Blob larger than maxInputBytes is refused upfront', async () => {
    const bytes = new Uint8Array(readFileSync(join(repoRoot, 'demo/gcodes/calicat.gcode')));
    const sync = parseGcodeToIR(bytes);
    const viaBlob = await parseGcodeStreamToIR(new Blob([bytes]), {}, { yieldIntervalMs: 10 });
    expect(digests(viaBlob.ir)).toEqual(digests(sync.ir));

    const refused = await parseGcodeStreamToIR(new Blob([bytes]), { limits: { maxInputBytes: 10 } });
    expect(refused.ir.header.complete).toBe(false);
    expect(refused.stats.stopReason?.code).toBe('E_LIMIT_INPUT_BYTES');
    expect(refused.ir.segments.count).toBe(0);
  });

  it('enforces maxInputBytes INCREMENTALLY on unknown-size streams (bounded partial)', async () => {
    const lines: string[] = ['G0 X0 Y0 Z0.2'];
    for (let i = 1; i <= 5000; i++) lines.push(`G1 X${i % 40} Y${i % 30} E${i}`);
    const bytes = new TextEncoder().encode(lines.join('\n'));
    const result = await parseGcodeStreamToIR(chunkedStream(bytes, 512), { limits: { maxInputBytes: 4096 } });

    expect(result.ir.header.complete).toBe(false);
    expect(result.stats.stopReason?.code).toBe('E_LIMIT_INPUT_BYTES');
    // Everything parsed before the limit is preserved (bounded partial, not a crash).
    expect(result.ir.segments.count).toBeGreaterThan(0);
    expect(result.ir.segments.count).toBeLessThan(5001);
  });

  it('bounds the rolling buffer on a neverending unterminated line', async () => {
    // 1 MB of 'A' with no newline, tiny maxLineLength: memory must stay bounded and
    // the parse must end with a line-too-long warning, not a hang or OOM.
    const bytes = new Uint8Array(1024 * 1024).fill(65);
    const result = await parseGcodeStreamToIR(chunkedStream(bytes, 4096), {
      limits: { maxLineLength: 1024 }
    });
    expect(result.ir.header.complete).toBe(true);
    expect(result.ir.segments.count).toBe(0);
    expect(result.ir.header.warnings.some((w) => w.code === 'line-too-long')).toBe(true);
  });

  it('streams are cancellable mid-flight with a bounded partial', async () => {
    const lines: string[] = ['G0 X0 Y0 Z0.2'];
    for (let i = 1; i <= 200000; i++) lines.push(`G1 X${i % 40} Y${i % 30} E${i}`);
    const bytes = new TextEncoder().encode(lines.join('\n'));
    let cancel = false;
    setTimeout(() => {
      cancel = true;
    }, 20);
    const result = await parseGcodeStreamToIR(
      chunkedStream(bytes, 8192),
      {},
      {
        yieldIntervalMs: 5,
        shouldCancel: () => cancel
      }
    );
    expect(result.cancelled).toBe(true);
    expect(result.ir.header.complete).toBe(false);
    expect(result.ir.segments.count).toBeGreaterThan(0);
  });
});
