/**
 * The object-channel value an adapter passes to `defineObject` is bounded (sweep 4, D2). `apply` pads
 * `ir.objects` up to that value, so an unbounded one (50,000,000) ran the worker out of memory. Kept in
 * its own file: with the bound reverted this run allocates gigabytes, and it must not take the main
 * sweep file down with it.
 */
import { describe, expect, it } from 'vitest';
import { parseGcodeToIR } from '../../../gcode-parser/src/parse';
import { createDialectRunner } from '../registry';
import type { DialectAdapter } from '../contracts';

const adapter = (finalize: DialectAdapter['finalize']): DialectAdapter => ({
  id: 'custom',
  displayName: 'Custom',
  kind: 'slicer',
  detect: () => ({ dialectId: 'custom', kind: 'slicer', confidence: 'known', evidence: 'test' }),
  finalize
});

describe('defineObject value bound (P2: worker out of memory)', () => {
  it('a 50,000,000 object value is dropped with one warning, not padded', () => {
    const text = 'G1 X0 Y0\nG1 X10 Y0 E1';
    const run = createDialectRunner([adapter((_ir, sink) => sink.defineObject(50_000_000, 'huge'))]).createRun({
      selection: 'auto',
      headText: text,
      tailText: text
    });
    const { ir } = parseGcodeToIR(text, { onComment: run!.onComment, onCommand: run!.onCommand });
    run!.finalize(ir);
    expect(ir.objects.length).toBe(0);
    const w = ir.header.warnings.filter((x) => x.code === 'dialect-metadata-invalid');
    expect(w.length).toBe(1);
    expect(w[0].message).toBe("adapter 'custom' defined an object with an unusable value or name; dropped");
  }, 10_000);
});
