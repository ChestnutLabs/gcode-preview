/**
 * Sweep slice 1: `( … )` comments on the PLAIN lexer path. They used to be executed (`G1 X1 (then G1 X99)`
 * moved to X99); only the parametric path stripped them. Literal expected values throughout.
 */
import { describe, expect, it } from 'vitest';
import { parseGcodeToIR } from '../index';

function ends(src: string): string[] {
  const s = parseGcodeToIR(src, {}).ir.segments;
  return Array.from({ length: s.count }, (_, i) => `${s.x1[i]},${s.y1[i]}`);
}

describe('plain-path paren comments', () => {
  it('a G word inside parens is not executed', () => {
    expect(ends('G1 X1 Y1 (then G1 X99)\nG1 X2 Y2\n')).toEqual(['1,1', '2,2']);
  });

  it('a param word inside parens is not read', () => {
    expect(ends('G1 X1 (Y50) Y2\n')).toEqual(['1,2']);
  });

  it('a `;` inside parens does not truncate the line', () => {
    expect(ends('G1 X1 (a ; b) Y2\n')).toEqual(['1,2']);
  });

  it('an unclosed paren comments out the rest of the line', () => {
    expect(ends('G1 X1 (Y9 Y8\nG1 Y3\n')).toEqual(['1,0', '1,3']);
  });

  it('an unmatched `)` is ignored', () => {
    expect(ends('G1 X1 ) Y2\n')).toEqual(['1,2']);
  });

  it('a `(` inside a `;` comment changes nothing', () => {
    expect(ends('G1 X1 Y2 ; note (G1 X9\nG1 X3\n')).toEqual(['1,2', '3,2']);
  });

  it('a line without parens is unchanged', () => {
    expect(ends('G1 X1 Y2\n')).toEqual(['1,2']);
  });
});
