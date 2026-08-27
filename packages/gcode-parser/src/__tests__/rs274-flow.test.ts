/*
 * DD-017 Phase 2 — RS274NGC O-word control flow. Detection + classification are unit-tested directly;
 * conditionals, loops, break/continue, bounded execution, and the honesty tiers run real programs
 * through `parseGcodeToIR` and assert on the resolved geometry / capability / disclosures.
 */
import { describe, expect, it } from 'vitest';
import { parseGcodeToIR, parseGcodeToIRAsync } from '../parse';
import { parseGcodeStreamToIR } from '../streaming';
import { classifyOWord, isOWordControlLine, programUsesOWords, RS274_FLOW_WARN } from '../rs274-flow';

/** Parse a program (array of lines) and return the IR. */
function run(lines: string[], limits?: Record<string, number>) {
  return parseGcodeToIR(lines.join('\n'), limits ? { limits } : {}).ir;
}

/** Last emitted segment's absolute end position. */
function lastEnd(ir: ReturnType<typeof run>): { x: number; y: number; z: number } {
  const n = ir.segments.count;
  const o = ir.header.originOffset;
  return { x: o.x + ir.segments.x1[n - 1], y: o.y + ir.segments.y1[n - 1], z: o.z + ir.segments.z1[n - 1] };
}

describe('rs274-flow detection', () => {
  it('programUsesOWords: true only for a recognized O-word control line', () => {
    expect(programUsesOWords('G1 X10 Y20\nG1 X20')).toBe(false);
    expect(programUsesOWords('#<i> = 0\nG1 X#<i>')).toBe(false); // params ≠ flow
    expect(programUsesOWords('o100 while [#1 LT 5]\nG1 X1\no100 endwhile')).toBe(true);
    expect(programUsesOWords('o1 if [1]\nG1 X1\no1 endif')).toBe(true);
    expect(programUsesOWords('o<loop> repeat [3]\nG1 X1\no<loop> endrepeat')).toBe(true);
  });

  it('detection tolerates a leading N-number, a leading comment, and mixed case', () => {
    expect(programUsesOWords('N40 o100 while [1]\no100 endwhile')).toBe(true);
    expect(programUsesOWords('(setup) O100 REPEAT [2]\nG1 X1\nO100 ENDREPEAT')).toBe(true);
  });

  it('detection matches the classifier even with a comment BETWEEN the N-word and the o-word', () => {
    // Regression: the cheap pre-filter must not be stricter than classifyOWord, or a real O-word program
    // is silently run linearly (wrong geometry reported as a confident `known`).
    const line = 'N10 (loop) o1 while [#1 LT 5]';
    expect(classifyOWord(line)).not.toBeNull();
    expect(isOWordControlLine(line)).toBe(true);
    expect(programUsesOWords(line)).toBe(true);
  });

  it('an `o<id>` with an unrecognized trailing word is NOT flow (never hijacks plain code)', () => {
    expect(programUsesOWords('o5 G1 X10')).toBe(false); // 'g1' is not an O-word keyword
    expect(isOWordControlLine('o5 G1 X10')).toBe(false);
    expect(isOWordControlLine('G1 X10 Y20')).toBe(false);
    expect(isOWordControlLine('o100 while [1]')).toBe(true);
  });

  it('classifyOWord parses keyword, id (numeric/named/computed), and the trailing expression', () => {
    expect(classifyOWord('o100 while [#1 LT 5]')).toEqual({ keyword: 'while', id: '100', expr: '[#1 LT 5]' });
    expect(classifyOWord('o<mill> if [#<d> GT 0]')).toEqual({ keyword: 'if', id: '<mill>', expr: '[#<d> GT 0]' });
    expect(classifyOWord('o[#2] repeat [3]')).toEqual({ keyword: 'repeat', id: '[#2]', expr: '[3]' });
    expect(classifyOWord('o100 endwhile')).toEqual({ keyword: 'endwhile', id: '100', expr: '' });
    expect(classifyOWord('G1 X10')).toBeNull();
    expect(classifyOWord('o5 g1 x10')).toBeNull(); // unrecognized keyword → plain line
  });
});

describe('rs274-flow conditionals', () => {
  it('if [true] runs the body; if [false] skips it', () => {
    const t = run(['G90', 'o1 if [1]', 'G1 X5 Y0', 'o1 endif']);
    expect(t.segments.count).toBe(1);
    expect(lastEnd(t).x).toBeCloseTo(5);
    const f = run(['G90', 'o1 if [0]', 'G1 X5 Y0', 'o1 endif']);
    expect(f.segments.count).toBe(0);
  });

  it('if / else takes the correct arm', () => {
    const ir = run(['G90', 'o1 if [2 GT 3]', 'G1 X5 Y0', 'o1 else', 'G1 X9 Y0', 'o1 endif']);
    expect(ir.segments.count).toBe(1);
    expect(lastEnd(ir).x).toBeCloseTo(9);
  });

  it('if / elseif / else — first true branch wins, later ones are skipped', () => {
    const ir = run([
      'G90',
      '#<k> = 2',
      'o1 if [#<k> EQ 1]',
      'G1 X10 Y0',
      'o1 elseif [#<k> EQ 2]',
      'G1 X20 Y0',
      'o1 elseif [#<k> EQ 2]', // also true, but must NOT run (earlier arm already taken)
      'G1 X30 Y0',
      'o1 else',
      'G1 X40 Y0',
      'o1 endif'
    ]);
    expect(ir.segments.count).toBe(1);
    expect(lastEnd(ir).x).toBeCloseTo(20);
  });
});

describe('rs274-flow loops', () => {
  it('while: iterates while the condition holds (a counted move sweep)', () => {
    const ir = run(['G90', '#<i> = 0', 'o1 while [#<i> LT 5]', 'G1 X#<i> Y0', '#<i> = [#<i> + 1]', 'o1 endwhile']);
    expect(ir.segments.count).toBe(5); // X = 0,1,2,3,4
    expect(ir.boundsWithTravel.max.x).toBeCloseTo(4);
    expect(ir.header.capabilities.parametricProgram).toBe('known');
  });

  it('do / while: the body runs at least once even when the condition is false up front', () => {
    const ir = run(['G90', '#<i> = 10', 'o1 do', 'G1 X#<i> Y0', '#<i> = [#<i> + 1]', 'o1 while [#<i> LT 10]']);
    expect(ir.segments.count).toBe(1);
    expect(lastEnd(ir).x).toBeCloseTo(10);
  });

  it('repeat [n]: runs exactly n times', () => {
    const ir = run(['G90', '#<i> = 0', 'o1 repeat [3]', 'G1 X#<i> Y0', '#<i> = [#<i> + 1]', 'o1 endrepeat']);
    expect(ir.segments.count).toBe(3);
    expect(ir.boundsWithTravel.max.x).toBeCloseTo(2);
  });

  it('repeat with a non-positive count runs zero times', () => {
    const ir = run(['G90', 'o1 repeat [0]', 'G1 X5 Y0', 'o1 endrepeat']);
    expect(ir.segments.count).toBe(0);
  });

  it('nested loops multiply (a 2×3 grid)', () => {
    const ir = run([
      'G90',
      '#<r> = 0',
      'o1 repeat [2]',
      '#<c> = 0',
      'o2 repeat [3]',
      'G1 X#<c> Y#<r>',
      '#<c> = [#<c> + 1]',
      'o2 endrepeat',
      '#<r> = [#<r> + 1]',
      'o1 endrepeat'
    ]);
    expect(ir.segments.count).toBe(6);
    expect(ir.boundsWithTravel.max.x).toBeCloseTo(2);
    expect(ir.boundsWithTravel.max.y).toBeCloseTo(1);
  });
});

describe('rs274-flow break / continue', () => {
  it('break exits the innermost loop', () => {
    const ir = run([
      'G90',
      '#<i> = 0',
      'o1 while [1]',
      'G1 X#<i> Y0',
      '#<i> = [#<i> + 1]',
      'o2 if [#<i> GE 3]',
      'o1 break',
      'o2 endif',
      'o1 endwhile'
    ]);
    expect(ir.segments.count).toBe(3); // X = 0,1,2 then break
    expect(ir.boundsWithTravel.max.x).toBeCloseTo(2);
    expect(ir.header.capabilities.parametricProgram).toBe('known'); // a clean break is not degraded
  });

  it('continue skips the rest of the body for that iteration', () => {
    const ir = run([
      'G90',
      '#<i> = 0',
      'o1 while [#<i> LT 5]',
      '#<i> = [#<i> + 1]',
      'o2 if [#<i> EQ 3]',
      'o1 continue',
      'o2 endif',
      'G1 X#<i> Y0',
      'o1 endwhile'
    ]);
    expect(ir.segments.count).toBe(4); // X = 1,2,4,5 (3 skipped)
    expect(ir.boundsWithTravel.max.x).toBeCloseTo(5);
  });
});

describe('rs274-flow bounded execution (DD-017 §4.5 — must never hang)', () => {
  it('an infinite loop with no geometry stops at maxProgramIterations and discloses', () => {
    const ir = run(['#<i> = 0', 'o1 while [1]', '#<i> = [#<i> + 1]', 'o1 endwhile'], { maxProgramIterations: 500 });
    expect(ir.header.warnings.some((w) => w.code === RS274_FLOW_WARN.iterationLimit)).toBe(true);
    expect(ir.header.capabilities.parametricProgram).toBe('approximated'); // degraded → honest
  });

  it('an infinite loop that emits geometry is still bounded (by segments or iterations)', () => {
    const ir = run(['G90', '#<i> = 0', 'o1 while [1]', 'G1 X#<i> Y0', '#<i> = [#<i> + 1]', 'o1 endwhile'], {
      maxProgramIterations: 200
    });
    // It terminated (the test itself completing proves no hang); geometry is bounded and disclosed.
    expect(ir.segments.count).toBeLessThanOrEqual(200);
    expect(ir.header.warnings.some((w) => w.code === RS274_FLOW_WARN.iterationLimit)).toBe(true);
  });

  it('a huge repeat count is capped by maxProgramIterations', () => {
    const ir = run(['G90', 'o1 repeat [100000000]', 'G1 X1 Y0', 'o1 endrepeat'], { maxProgramIterations: 300 });
    expect(ir.segments.count).toBeLessThanOrEqual(300);
    expect(ir.header.warnings.some((w) => w.code === RS274_FLOW_WARN.iterationLimit)).toBe(true);
  });

  it('the budget bounds TOTAL loop work, not just passes (a large body cannot multiply past the cap)', () => {
    // 4 geometry statements per pass. A per-PASS-only charge would allow maxProgramIterations × 4 segments
    // (160); charging every executed body statement bounds total body executions to the cap itself.
    const ir = run(['G90', 'o1 while [1]', 'G1 X1 Y0', 'G1 X2 Y0', 'G1 X3 Y0', 'G1 X4 Y0', 'o1 endwhile'], {
      maxProgramIterations: 40
    });
    expect(ir.segments.count).toBeLessThanOrEqual(40);
    expect(ir.header.warnings.some((w) => w.code === RS274_FLOW_WARN.iterationLimit)).toBe(true);
  });

  it('a malformed loop condition is disclosed and treated as false (no execution, no crash)', () => {
    const ir = run(['G90', 'o1 while [#1 LT]', 'G1 X5 Y0', 'o1 endwhile']);
    expect(ir.segments.count).toBe(0);
    expect(ir.header.capabilities.parametricProgram).toBe('approximated');
  });
});

describe('rs274-flow honesty & robustness', () => {
  it('an unbalanced loop (no endwhile) is disclosed; the dangling body is not executed', () => {
    const ir = run(['G90', '#<i> = 0', 'o1 while [#<i> LT 3]', 'G1 X#<i> Y0', '#<i> = [#<i> + 1]']);
    expect(ir.segments.count).toBe(0);
    expect(ir.header.warnings.some((w) => w.code === RS274_FLOW_WARN.unbalancedOword)).toBe(true);
    expect(ir.header.capabilities.parametricProgram).toBe('approximated');
  });

  it('subroutines are disclosed unsupported and NOT executed inline (Phase 3)', () => {
    const ir = run(['G90', 'o100 sub', 'G1 X5 Y0', 'o100 endsub', 'G1 X1 Y0', 'o100 call']);
    expect(ir.segments.count).toBe(1); // only the top-level G1 X1 — the sub body did not run
    expect(lastEnd(ir).x).toBeCloseTo(1);
    expect(ir.header.warnings.some((w) => w.code === RS274_FLOW_WARN.unsupportedOword)).toBe(true);
    expect(ir.header.capabilities.parametricProgram).toBe('approximated');
  });

  it('a misplaced else (no enclosing if) is disclosed; following code still runs', () => {
    const ir = run(['G90', 'o1 else', 'G1 X1 Y0']);
    expect(ir.segments.count).toBe(1);
    expect(ir.header.warnings.some((w) => w.code === RS274_FLOW_WARN.misplacedControl)).toBe(true);
  });

  it('an elseif/else after an else is unreachable — disclosed and dropped', () => {
    const ir = run([
      'G90',
      'o1 if [0]',
      'G1 X1 Y0',
      'o1 else',
      'G1 X2 Y0',
      'o1 elseif [1]', // after else — can never run
      'G1 X3 Y0',
      'o1 endif'
    ]);
    expect(ir.segments.count).toBe(1); // the else arm ran
    expect(lastEnd(ir).x).toBeCloseTo(2);
    expect(ir.header.warnings.some((w) => w.code === RS274_FLOW_WARN.misplacedControl)).toBe(true);
  });

  it('a geometry limit that truncates flow marks the capability approximated (not a clean known)', () => {
    const ir = run(['G90', 'o1 repeat [100]', 'G1 X1 Y0', 'o1 endrepeat'], { maxSegments: 5 });
    expect(ir.header.complete).toBe(false);
    expect(ir.header.capabilities.parametricProgram).toBe('approximated');
  });

  it('detection catches a fully N-numbered, comment-annotated loop and executes it (not linear)', () => {
    const ir = run([
      'G90',
      'N5 (init) #<i> = 0',
      'N10 (loop) o1 while [#<i> LT 3]',
      'N20 G1 X#<i> Y0',
      'N25 #<i> = [#<i> + 1]',
      'N30 (done) o1 endwhile'
    ]);
    expect(ir.segments.count).toBe(3); // ran the loop, did NOT fall to the linear one-pass path
    expect(ir.boundsWithTravel.max.x).toBeCloseTo(2);
    expect(ir.header.capabilities.parametricProgram).toBe('known');
  });

  it('clean control flow reports parametricProgram known; a non-parametric file reports unavailable', () => {
    const clean = run(['G90', 'o1 repeat [2]', 'G1 X1 Y0', 'o1 endrepeat']);
    expect(clean.header.capabilities.parametricProgram).toBe('known');
    const fdm = run(['G1 X10 Y10 E1', 'G1 X20 Y10 E2']);
    expect(fdm.header.capabilities.parametricProgram).toBe('unavailable');
  });

  it('a computed segment maps its srcByte to the executing body line, not the loop header (D7)', () => {
    const src = ['G90', '#<i> = 0', 'o1 repeat [1]', 'G1 X7 Y0', 'o1 endrepeat'].join('\n');
    const ir = parseGcodeToIR(src).ir;
    const bodyOffset = src.indexOf('G1 X7');
    expect(ir.segments.srcByte[0]).toBe(bodyOffset);
  });
});

describe('rs274-flow across drivers', () => {
  const loop = ['G90', '#<i> = 0', 'o1 while [#<i> LT 5]', 'G1 X#<i> Y0', '#<i> = [#<i> + 1]', 'o1 endwhile'];

  it('the async driver interprets control flow identically to the sync driver', async () => {
    const { ir } = await parseGcodeToIRAsync(loop.join('\n'));
    expect(ir.segments.count).toBe(5);
    expect(ir.boundsWithTravel.max.x).toBeCloseTo(4);
    expect(ir.header.capabilities.parametricProgram).toBe('known');
  });

  it('the streaming driver discloses (control flow needs a buffered program) and runs linearly', async () => {
    const { ir } = await parseGcodeStreamToIR(new Blob([loop.join('\n')]));
    // Linear pass: the loop header/endwhile are inert, so the body executes exactly once (X = 0).
    expect(ir.segments.count).toBe(1);
    expect(ir.header.warnings.some((w) => w.code === RS274_FLOW_WARN.streamingUnsupported)).toBe(true);
    expect(ir.header.capabilities.parametricProgram).toBe('approximated');
  });
});

describe('rs274-flow real LinuxCNC-idiom validation', () => {
  it('a while-loop bolt circle drills the computed hole positions (params + degree trig + flow)', () => {
    // 4 holes evenly on a radius-20 circle about (50,40): angles 0/90/180/270 → (70,40),(50,60),(30,40),(50,20).
    const ir = run([
      'G21 G90 G17',
      '#<cx> = 50',
      '#<cy> = 40',
      '#<r> = 20',
      '#<n> = 4',
      '#<i> = 0',
      'o100 while [#<i> LT #<n>]',
      '#<ang> = [#<i> * 360 / #<n>]',
      'G0 X[#<cx> + #<r> * COS[#<ang>]] Y[#<cy> + #<r> * SIN[#<ang>]]',
      '#<i> = [#<i> + 1]',
      'o100 endwhile'
    ]);
    expect(ir.header.capabilities.parametricProgram).toBe('known');
    expect(ir.segments.count).toBe(4); // one rapid per hole
    const o = ir.header.originOffset;
    const hole = (i: number) => ({ x: o.x + ir.segments.x1[i], y: o.y + ir.segments.y1[i] });
    // Each iteration's rapid lands on the trig-derived hole position.
    expect(hole(0)).toMatchObject({ x: expect.closeTo(70, 3), y: expect.closeTo(40, 3) }); // 0°
    expect(hole(1)).toMatchObject({ x: expect.closeTo(50, 3), y: expect.closeTo(60, 3) }); // 90°
    expect(hole(2)).toMatchObject({ x: expect.closeTo(30, 3), y: expect.closeTo(40, 3) }); // 180°
    expect(hole(3)).toMatchObject({ x: expect.closeTo(50, 3), y: expect.closeTo(20, 3) }); // 270°
  });
});
