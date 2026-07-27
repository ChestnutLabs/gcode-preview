/**
 * Source-line ↔ segment mapping (#184): resolve a segment to the G-code line that produced it and
 * back. Built on `segments.srcByte` + `sourceIndex` (byte↔segment) plus a line index over the source.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind } from '../ir.js';
import { ToolpathIRBuilder } from '../builder.js';
import {
  buildSourceLineIndex,
  lineAtByte,
  byteRangeOfLine,
  sourceLineOfSegment,
  segmentAtSourceLine
} from '../source-map.js';

// A tiny source; line 1 is a comment (no segment), lines 2 & 3 each emit one segment.
const source = '; comment\nG1 X10 F1200\nG1 X20\n';
//               ^byte 0     ^byte 10       ^byte 23
const SEG0_BYTE = source.indexOf('G1 X10'); // 10 → line 2
const SEG1_BYTE = source.indexOf('G1 X20'); // 23 → line 3

function ir2() {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  b.addSegment({
    x0: 0,
    y0: 0,
    z0: 0.2,
    x1: 10,
    y1: 0,
    z1: 0.2,
    e: 1,
    kind: MoveKind.Extrude,
    layer: 0,
    srcByte: SEG0_BYTE
  });
  b.addSegment({
    x0: 10,
    y0: 0,
    z0: 0.2,
    x1: 20,
    y1: 0,
    z1: 0.2,
    e: 1,
    kind: MoveKind.Extrude,
    layer: 0,
    srcByte: SEG1_BYTE
  });
  return b.finalize();
}

describe('source line index', () => {
  const li = buildSourceLineIndex(source);

  it('lineAtByte is 1-based and covers each line', () => {
    expect(Array.from(li.lineStarts)).toEqual([0, 10, 23]);
    expect(lineAtByte(li, 0)).toBe(1); // start of the comment line
    expect(lineAtByte(li, 15)).toBe(2); // mid line 2
    expect(lineAtByte(li, 23)).toBe(3); // start of line 3
  });

  it('byteRangeOfLine bounds a line; out-of-range → null', () => {
    expect(byteRangeOfLine(li, 2)).toEqual([10, 23]);
    expect(byteRangeOfLine(li, 99)).toBeNull();
  });

  it('accepts raw bytes too', () => {
    const fromBytes = buildSourceLineIndex(new TextEncoder().encode(source));
    expect(Array.from(fromBytes.lineStarts)).toEqual([0, 10, 23]);
  });
});

describe('segment ↔ source line', () => {
  const ir = ir2();
  const li = buildSourceLineIndex(source);

  it('segment → its 1-based source line', () => {
    expect(sourceLineOfSegment(ir.segments.srcByte, li, 0)).toBe(2);
    expect(sourceLineOfSegment(ir.segments.srcByte, li, 1)).toBe(3);
    expect(sourceLineOfSegment(ir.segments.srcByte, li, 99)).toBeNull();
  });

  it('source line → segment; a no-segment line → -1', () => {
    expect(segmentAtSourceLine(ir.sourceIndex, li, 2)).toBe(0); // G1 X10
    expect(segmentAtSourceLine(ir.sourceIndex, li, 3)).toBe(1); // G1 X20
    expect(segmentAtSourceLine(ir.sourceIndex, li, 1)).toBe(-1); // comment line — honestly no segment
  });
});
