/**
 * Sweep slice 1: the parser now ignores `( … )` comments when it extracts motion/modal words, but
 * annotators read the RAW line. A Klipper object name that contains parentheses must keep its identity.
 */
import { describe, expect, it } from 'vitest';
import { parseGcodeToIR } from '../../../gcode-parser/src/parse';
import { createDialectRunner } from '../registry';
import { klipper } from '../firmware';

function objects(text: string) {
  const run = createDialectRunner([klipper()]).createRun({
    selection: 'auto',
    headText: text,
    tailText: text
  });
  expect(run).not.toBeNull();
  const result = parseGcodeToIR(text, { onComment: run!.onComment, onCommand: run!.onCommand });
  run!.finalize(result.ir);
  return result.ir;
}

describe('object names containing parentheses', () => {
  it('EXCLUDE_OBJECT NAME=cube_(1) keeps its name and its segments', () => {
    const ir = objects(
      [
        'EXCLUDE_OBJECT_DEFINE NAME=cube_(1)',
        'EXCLUDE_OBJECT_START NAME=cube_(1)',
        'G1 X0 Y0 Z0.2 F1200',
        'G1 X10 Y0 E1',
        'G1 X10 Y10 E2',
        'EXCLUDE_OBJECT_END NAME=cube_(1)',
        ''
      ].join('\n')
    );
    expect(ir.header.capabilities.objects).toBe('known');
    expect(ir.objects).toEqual([{ id: '1', name: 'cube_(1)' }]);
    expect(Array.from(ir.segments.object)).toEqual([1, 1, 1]);
  });

  it('parentheses on a motion line next to a name-less object marker do not move the toolhead', () => {
    const ir = objects(
      [
        'EXCLUDE_OBJECT_DEFINE NAME=a',
        'EXCLUDE_OBJECT_START NAME=a',
        'G1 X1 Y1 E1 (G1 X99)',
        'EXCLUDE_OBJECT_END',
        ''
      ].join('\n')
    );
    expect(ir.segments.count).toBe(1);
    expect(ir.segments.x1[0]).toBe(1);
  });
});
