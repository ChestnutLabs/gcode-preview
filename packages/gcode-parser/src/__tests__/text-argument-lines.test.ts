/**
 * #592: a text-argument line carries only its leading command word; everything after it is text.
 *
 * A text line is one that starts (after an optional `N` line number) with a multi-letter word (a Klipper /
 * RRF extended command or macro: `RESPOND MSG=…`, `EXCLUDE_OBJECT_START NAME=…`), with Marlin's message
 * codes M117 / M118, with the SD-file codes M23 / M28 / M32 / M33 / M928 (a file name), or with M486, which
 * keeps its numeric S / T / P / U / C words before the first `A` (the object name). Letters followed by
 * digits inside that text are never read as G / M / T words or parameters, and a `[` or `#` in it never makes
 * the file a parametric program. Expected values are literal.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';
import { parseGcodeToIR, type CommandEvent } from '../index';

function fnv1a(view: ArrayBufferView): string {
  const b = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193);
  return (h >>> 0).toString(16);
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const parse = (src: string) => parseGcodeToIR(src + '\n', {});
const ax = (ir: ToolpathIR, i: number, k: 'x0' | 'y0' | 'z0' | 'x1' | 'y1' | 'z1'): number => {
  const o = ir.header.originOffset;
  const base = k[0] === 'x' ? o.x : k[0] === 'y' ? o.y : o.z;
  return base + ir.segments[k][i];
};
/** Every segment as `(x0,y0)->(x1,y1)`, origin-relative, 1 decimal. */
const moves = (ir: ToolpathIR): string[] =>
  Array.from(
    { length: ir.segments.count },
    (_, i) =>
      `(${ax(ir, i, 'x0').toFixed(1)},${ax(ir, i, 'y0').toFixed(1)})->(${ax(ir, i, 'x1').toFixed(1)},${ax(ir, i, 'y1').toFixed(1)})`
  );
/** The onCommand events of the lines that contain `marker`, as `gcode params`. */
const eventsOn = (src: string, marker: string): string[] => {
  const ev: CommandEvent[] = [];
  parseGcodeToIR(src + '\n', { onCommand: (e) => ev.push(e) });
  return ev.filter((e) => e.rawLine.includes(marker)).map((e) => `${e.gcode} ${JSON.stringify(e.params)}`);
};

describe('#592: G / M / T words inside message text are text', () => {
  it('M117 Homing G28 does not home', () => {
    const { ir } = parse('G1 X10 Y10 F600\nM117 Homing G28\nG1 X20 E1');
    expect(moves(ir)).toEqual(['(0.0,0.0)->(10.0,10.0)', '(10.0,10.0)->(20.0,10.0)']);
  });

  it('M117 … G91 does not switch to relative moves', () => {
    const { ir } = parse('G90\nG1 X10 Y10\nM117 now G91\nG1 X20 Y10 E1');
    expect(moves(ir)).toEqual(['(0.0,0.0)->(10.0,10.0)', '(10.0,10.0)->(20.0,10.0)']);
  });

  it('M117 F9000 does not set the modal feedrate', () => {
    const { ir } = parse('G1 X10 Y10 F600\nM117 F9000 fast\nG1 X20 E1');
    expect(Array.from(ir.segments.feedrate!)).toEqual([600, 600]);
  });

  it('M118 echo text does not home', () => {
    const { ir } = parse('G1 X10 Y10\nM118 E1 G28 echo\nG1 X20 E1');
    expect(moves(ir)).toEqual(['(0.0,0.0)->(10.0,10.0)', '(10.0,10.0)->(20.0,10.0)']);
  });

  it('RESPOND MSG="G28 done" does not home', () => {
    const { ir } = parse('G1 X10 Y10\nRESPOND MSG="G28 done"\nG1 X20 E1');
    expect(moves(ir)).toEqual(['(0.0,0.0)->(10.0,10.0)', '(10.0,10.0)->(20.0,10.0)']);
  });

  it('EXCLUDE_OBJECT_START NAME=part2 is not a tool change to T2', () => {
    const { ir } = parse('T0\nG1 X10 Y10\nEXCLUDE_OBJECT_START NAME=part2\nG1 X20 E1');
    expect(Array.from(ir.segments.tool)).toEqual([0, 0]);
  });

  it('RESPOND MSG=at X50 is not a modal move to X50', () => {
    const { ir } = parse('G1 X10 Y10\nRESPOND MSG=at X50\nG1 X20 E1');
    expect(moves(ir)).toEqual(['(0.0,0.0)->(10.0,10.0)', '(10.0,10.0)->(20.0,10.0)']);
  });

  it('a [ or # in text does not make the file a parametric program', () => {
    for (const line of [
      'EXCLUDE_OBJECT_DEFINE NAME=cube CENTER=110,110 POLYGON=[[90,90],[130,90],[130,130]]',
      'M117 50% [##   ] G28',
      'M118 #1 done'
    ]) {
      const { ir } = parse(`G1 X10 Y10\n${line}\nG1 X20 E1`);
      expect(ir.header.capabilities.parametricProgram, line).toBe('unavailable');
      expect(moves(ir), line).toEqual(['(0.0,0.0)->(10.0,10.0)', '(10.0,10.0)->(20.0,10.0)']);
    }
  });

  it('a line number, lower case and a comment do not change the rule', () => {
    for (const line of ['N10 M117 Homing G28', 'm117 homing g28', 'M117 G28 ; G28', 'n7 respond msg=g28']) {
      const { ir } = parse(`G1 X10 Y10\n${line}\nG1 X20 E1`);
      expect(moves(ir), line).toEqual(['(0.0,0.0)->(10.0,10.0)', '(10.0,10.0)->(20.0,10.0)']);
    }
  });

  it('SD file names (M23 / M28 / M32 / M33 / M928) are text', () => {
    for (const line of [
      'M23 g28part.gco',
      'M28 g91test.gco',
      'M32 !/x5/g28.gco#',
      'M33 /g28/a.gco',
      'M928 g28log.txt'
    ]) {
      const { ir } = parse(`G1 X10 Y10\n${line}\nG1 X20 E1`);
      expect(moves(ir), line).toEqual(['(0.0,0.0)->(10.0,10.0)', '(10.0,10.0)->(20.0,10.0)']);
    }
  });

  it('M117 G81 L5 is message text: no canned cycle, no L repeat, no cycle warning', () => {
    for (const line of ['M117 G81 L5', 'M117 G81 X5 Y5 Z-1 R1 L0', 'M117 G81 Z-1 R1 L2000000']) {
      const { ir } = parse(line);
      expect(ir.segments.count, line).toBe(0);
      // M117 itself is not drawn (unsupported-command) and a file with no moves has no layers; nothing canned.
      expect(
        ir.header.warnings.map((w) => w.code),
        line
      ).toEqual(['unsupported-command', 'layers-unavailable']);
    }
  });
});

describe('#592: what a text line still carries', () => {
  it('M486 keeps its numeric words before A; the name after A is text', () => {
    const src = 'G1 X10 Y10\nM486 S2 A"part G28"\nG1 X20 E1';
    expect(eventsOn(src, 'M486')).toEqual(['m486 {"s":2}']);
    expect(moves(parse(src).ir)).toEqual(['(0.0,0.0)->(10.0,10.0)', '(10.0,10.0)->(20.0,10.0)']);
  });

  it('M486 T<count> and S-1 keep their values and never yield a second code', () => {
    expect(eventsOn('M486 T3', 'M486')).toEqual(['m486 {"t":3}']);
    expect(eventsOn('M486 S-1', 'M486')).toEqual(['m486 {"s":-1}']);
    expect(eventsOn('M486 S0 G28 X5', 'M486')).toEqual(['m486 {"s":0}']);
  });

  it('M486 reads its words up to the first A, and a ; comment never counts', () => {
    expect(eventsOn('M486 S1 ; Aname S9', 'M486')).toEqual(['m486 {"s":1}']);
    expect(eventsOn('M486 S1 ; S9', 'M486')).toEqual(['m486 {"s":1}']);
    expect(eventsOn('M486 P4 U5 C6 Aname S9', 'M486')).toEqual(['m486 {"p":4,"u":5,"c":6}']);
  });

  it('an M486 number too big for float32 is dropped and reported', () => {
    const { ir } = parse(`M486 S1${'0'.repeat(40)}`);
    expect(ir.header.warnings.map((w) => w.code)).toContain('number-out-of-range');
  });

  it('M486 S0 G20 does not switch to inches', () => {
    const { ir } = parse('M486 S0 G20\nG0 X1 Y2');
    expect(moves(ir)).toEqual(['(0.0,0.0)->(1.0,2.0)']);
    expect(ir.header.units).not.toBe('in');
  });

  it('M117 / M118 keep only their code', () => {
    expect(eventsOn('M117 Layer 2 of 9 X5', 'M117')).toEqual(['m117 {}']);
    expect(eventsOn('M118 A1 E1 P0 G28', 'M118')).toEqual(['m118 {}']);
  });

  it('a multi-letter command reaches onCommand with no code and no words, raw line intact', () => {
    const ev: CommandEvent[] = [];
    parseGcodeToIR('EXCLUDE_OBJECT_START NAME=part2 X=5\n', { onCommand: (e) => ev.push(e) });
    expect(ev.map((e) => [e.gcode, e.params, e.rawLine])).toEqual([['', {}, 'EXCLUDE_OBJECT_START NAME=part2 X=5']]);
  });

  it('a code that only starts like a text code is not one (M1170, M11, M4860)', () => {
    expect(eventsOn('M1170 X5', 'M1170')).toEqual(['m1170 {"x":5}']);
    expect(eventsOn('M4860 S1 G28', 'M4860')).toEqual(['m4860 {"s":1}', 'g28 {"s":1}']);
  });
});

/**
 * Property over the FDM corpus: appending G-code-looking words to the TEXT of every text line never changes
 * the IR (every segment buffer, the capabilities, the warning codes) nor the command events. Non-text lines
 * are pinned byte-identical by the native goldens (golden-equivalence.test.ts).
 */
describe('#592 property: text in text lines never changes the parse', () => {
  const PAYLOAD = 'G28 G91 G20 F1 T2 X5 E9 R1 [#1]';
  const TEXT = /^\s*(?:n\d+\s*)?([A-Za-z_][A-Za-z_]|m(?:117|118|486|23|28|32|33|928)(?!\d))/i;
  /** Insert the payload where the line's text lives, before any `;` comment. */
  const inject = (line: string): string => {
    const m = TEXT.exec(line);
    if (m === null) return line;
    const semi = line.indexOf(';');
    const code = semi === -1 ? line.replace(/\r$/, '') : line.slice(0, semi);
    const tail = semi === -1 ? (line.endsWith('\r') ? '\r' : '') : ' ' + line.slice(semi);
    const lead = m[1].toLowerCase();
    let text: string;
    if (lead === 'm486') text = /a/i.test(code.slice(m[0].length)) ? ` ${PAYLOAD}` : ` A"${PAYLOAD}"`;
    else if (/^[a-z_]{2}$/.test(lead)) text = ` MSG="${PAYLOAD}"`;
    else text = ` ${PAYLOAD}`;
    return code.trimEnd() + text + tail;
  };
  const summary = (src: string) => {
    const ev: string[] = [];
    const { ir } = parseGcodeToIR(src, {
      onCommand: (e) => ev.push(`${e.gcode} ${JSON.stringify(e.params)} ${e.segIndex}`)
    });
    const s = ir.segments as unknown as Record<string, unknown>;
    // A digest per buffer: a failing deep diff of 3DBenchy-sized arrays takes minutes to print. srcByte is
    // left out: the injected text moves every later line's byte offset.
    const buffers: Record<string, string> = {};
    for (const [k, v] of Object.entries(s)) if (ArrayBuffer.isView(v) && k !== 'srcByte') buffers[k] = fnv1a(v);
    return {
      ir: {
        count: ir.segments.count,
        buffers,
        capabilities: ir.header.capabilities,
        units: ir.header.units,
        warnings: [...new Set(ir.header.warnings.map((w) => w.code))].sort(),
        events: ev.length
      },
      events: ev
    };
  };

  for (const rel of [
    'test-data/gcodes/3DBenchy.gcode',
    'test-data/gcodes/calicat.gcode',
    'test-data/fixtures/bgcode/prim-cube.gcode',
    'test-data/fixtures/dialects/marlin-m486-sample.gcode',
    'test-data/fixtures/dialects/klipper-prusa-sample.gcode'
  ]) {
    it(`payload in every text line of ${rel.split('/').pop()} is ignored`, () => {
      const src = readFileSync(join(repoRoot, rel), 'utf8');
      const lines = src.split('\n');
      const injected = lines.map(inject);
      const touched = injected.filter((l, i) => l !== lines[i]).length;
      expect(touched).toBeGreaterThan(0);
      const got = summary(injected.join('\n'));
      const want = summary(src);
      expect(got.ir).toEqual(want.ir);
      // Report only the first differing command event, never the whole list.
      const i = got.events.findIndex((e, k) => e !== want.events[k]);
      expect(i === -1 ? null : [i, got.events[i], want.events[i]]).toBeNull();
    });
  }

  it('a payload-only file of text lines draws nothing and is not parametric', () => {
    const src = ['M117 a', 'M118 b', 'M486 S1', 'RESPOND MSG=c', 'EXCLUDE_OBJECT_START NAME=d', 'M23 e.gco']
      .map(inject)
      .join('\n');
    const { ir } = parseGcodeToIR(src + '\n', {});
    expect(ir.segments.count).toBe(0);
    expect(ir.header.capabilities.parametricProgram).toBe('unavailable');
    expect(ir.header.units).not.toBe('in');
  });
});
