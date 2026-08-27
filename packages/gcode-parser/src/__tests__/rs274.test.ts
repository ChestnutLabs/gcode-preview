/*
 * DD-017 Phase 1 — RS274NGC parameters + expressions. Unit tests drive the interpreter through its
 * public `Rs274Context.lexLine` surface (resolving a word value proves the whole tokenize→eval→store
 * path); integration tests run real parametric G-code through `parseGcodeToIR`.
 */
import { describe, expect, it } from 'vitest';
import { Rs274Context, lineUsesParametric, RS274_WARN } from '../rs274';
import { parseGcodeToIR } from '../parse';

/** Evaluate a single word value `X<value>` and return the resolved number (or undefined if dropped). */
function evalX(src: string, warn = () => {}, pos = () => ({ x: 0, y: 0, z: 0 })): number | undefined {
  const ctx = new Rs274Context(warn, pos);
  const r = ctx.lexLine(`X${src}`);
  return r.kind === 'cmd' ? r.params.x : undefined;
}

/** A context with a warning collector, for assign→read sequences. */
function ctxWith(): { ctx: Rs274Context; warns: string[] } {
  const warns: string[] = [];
  const ctx = new Rs274Context(
    (code) => warns.push(code),
    () => ({ x: 11, y: 22, z: 33 })
  );
  return { ctx, warns };
}

describe('rs274 detection gate', () => {
  it('flags only lines that use `#` or `[`', () => {
    expect(lineUsesParametric('G1 X10 Y20')).toBe(false);
    expect(lineUsesParametric('G1 X#100')).toBe(true);
    expect(lineUsesParametric('G1 X[1+2]')).toBe(true);
  });
});

describe('rs274 expressions', () => {
  it('basic arithmetic + grouping', () => {
    expect(evalX('[2+3]')).toBe(5);
    expect(evalX('[10-4]')).toBe(6);
    expect(evalX('[3*4]')).toBe(12);
    expect(evalX('[10/4]')).toBe(2.5);
    expect(evalX('[[2+3]*4]')).toBe(20);
  });

  it('RS274NGC precedence: ** > * / MOD > + - > compare > logical', () => {
    expect(evalX('[2+3*4]')).toBe(14); // * before +
    expect(evalX('[2*3+4]')).toBe(10);
    expect(evalX('[2**3]')).toBe(8);
    expect(evalX('[2**3**2]')).toBe(512); // ** right-associative: 2**(3**2)
    expect(evalX('[1+1 GT 1]')).toBe(1); // (1+1) GT 1
    expect(evalX('[1 AND 1 EQ 1]')).toBe(1); // 1 AND (1 EQ 1)
  });

  it('unary minus/plus', () => {
    expect(evalX('[-5]')).toBe(-5);
    expect(evalX('[-[2+3]]')).toBe(-5);
    expect(evalX('[3 - -2]')).toBe(5);
    expect(evalX('[2 ** -1]')).toBe(0.5);
  });

  it('MOD is floored (LinuxCNC, sign of divisor)', () => {
    expect(evalX('[7 MOD 3]')).toBe(1);
    expect(evalX('[-7 MOD 3]')).toBe(2);
    expect(evalX('[7 MOD -3]')).toBe(-2);
  });

  it('comparisons + logical return 1/0; EQ/NE use a tolerance', () => {
    expect(evalX('[2 GT 1]')).toBe(1);
    expect(evalX('[1 GE 1]')).toBe(1);
    expect(evalX('[1 LT 1]')).toBe(0);
    expect(evalX('[1 AND 0]')).toBe(0);
    expect(evalX('[1 OR 0]')).toBe(1);
    expect(evalX('[1 XOR 1]')).toBe(0);
    expect(evalX('[2 EQ 2.000001]')).toBe(1); // within tolerance
    expect(evalX('[2 NE 3]')).toBe(1);
  });

  it('functions — trig in DEGREES', () => {
    expect(evalX('[SIN[30]]')).toBeCloseTo(0.5, 9);
    expect(evalX('[COS[60]]')).toBeCloseTo(0.5, 9);
    expect(evalX('[TAN[45]]')).toBeCloseTo(1, 9);
    expect(evalX('[ASIN[0.5]]')).toBeCloseTo(30, 9);
    expect(evalX('[ACOS[0.5]]')).toBeCloseTo(60, 9);
    expect(evalX('[ATAN[1]/[1]]')).toBeCloseTo(45, 9);
  });

  it('functions — ABS/SQRT/FIX/FUP/ROUND/LN/EXP', () => {
    expect(evalX('[ABS[0-7]]')).toBe(7);
    expect(evalX('[SQRT[16]]')).toBe(4);
    expect(evalX('[FIX[2.7]]')).toBe(2);
    expect(evalX('[FIX[-2.7]]')).toBe(-3); // toward -inf
    expect(evalX('[FUP[2.1]]')).toBe(3);
    expect(evalX('[FUP[-2.1]]')).toBe(-2); // toward +inf
    expect(evalX('[ROUND[2.5]]')).toBe(3);
    expect(evalX('[EXP[0]]')).toBe(1);
    expect(evalX('[LN[1]]')).toBe(0);
  });
});

describe('rs274 parameters', () => {
  it('numbered assign + read, and in expressions', () => {
    const { ctx } = ctxWith();
    expect(ctx.lexLine('#100 = [2+3]').kind).toBe('assign');
    const a = ctx.lexLine('X#100');
    expect(a.kind === 'cmd' && a.params.x).toBe(5);
    const b = ctx.lexLine('X[#100 + 1]');
    expect(b.kind === 'cmd' && b.params.x).toBe(6);
  });

  it('named (local) + global params', () => {
    const { ctx } = ctxWith();
    ctx.lexLine('#<width> = 10');
    ctx.lexLine('#<_depth> = [2*3]');
    const a = ctx.lexLine('X#<width> Y#<_depth>');
    expect(a.kind === 'cmd' && a.params.x).toBe(10);
    expect(a.kind === 'cmd' && a.params.y).toBe(6);
  });

  it('indirect reference ##n', () => {
    const { ctx } = ctxWith();
    ctx.lexLine('#1 = 5');
    ctx.lexLine('#5 = 42');
    const a = ctx.lexLine('X##1'); // #1 → 5, #5 → 42
    expect(a.kind === 'cmd' && a.params.x).toBe(42);
  });

  it('computed parameter number #[expr]', () => {
    const { ctx } = ctxWith();
    ctx.lexLine('#7 = 99');
    const a = ctx.lexLine('X#[3+4]');
    expect(a.kind === 'cmd' && a.params.x).toBe(99);
  });

  it('read-before-write returns 0 and discloses once', () => {
    const { ctx, warns } = ctxWith();
    const a = ctx.lexLine('X#42');
    expect(a.kind === 'cmd' && a.params.x).toBe(0);
    ctx.lexLine('Y#43'); // second uninitialized read
    expect(warns.filter((w) => w === RS274_WARN.uninitializedParam).length).toBe(1); // once only
  });

  it('EXISTS tests a named param without triggering an uninitialized read', () => {
    const { ctx, warns } = ctxWith();
    expect(evalXctx(ctx, '[EXISTS[#<nope>]]')).toBe(0);
    ctx.lexLine('#<yes> = 1');
    expect(evalXctx(ctx, '[EXISTS[#<yes>]]')).toBe(1);
    expect(warns).not.toContain(RS274_WARN.uninitializedParam);
  });

  it('system parameters #5420–#5422 read live position; others disclose', () => {
    const { ctx, warns } = ctxWith(); // position = (11,22,33)
    expect(evalXctx(ctx, '#5420')).toBe(11);
    expect(evalXctx(ctx, '#5421')).toBe(22);
    expect(evalXctx(ctx, '#5422')).toBe(33);
    expect(evalXctx(ctx, '#5999')).toBe(0);
    expect(warns).toContain(RS274_WARN.unsupportedSysParam);
  });
});

describe('rs274 robustness', () => {
  it('a malformed expression drops that word + discloses, parse continues', () => {
    const { ctx, warns } = ctxWith();
    const a = ctx.lexLine('X[2+] Y5'); // X malformed, Y fine
    expect(a.kind === 'cmd' && a.params.x).toBeUndefined();
    expect(a.kind === 'cmd' && a.params.y).toBe(5);
    expect(warns).toContain(RS274_WARN.badExpression);
  });

  it('a `#` inside a ( ) comment is not parametric — routed to the plain lexer', () => {
    const { ctx } = ctxWith();
    expect(ctx.lexLine('G1 X10 (move to #home)').kind).toBe('plain');
  });

  it('deeply nested brackets are bounded (no stack blow-up)', () => {
    const { ctx, warns } = ctxWith();
    const deep = '['.repeat(200) + '1' + ']'.repeat(200);
    const a = ctx.lexLine(`X${deep}`);
    // dropped + disclosed, never a crash
    expect(a.kind === 'cmd' && a.params.x).toBeUndefined();
    expect(warns).toContain(RS274_WARN.badExpression);
  });

  it('bounds adversarial UNARY chains and INDIRECT ref chains (security — must not overflow the stack)', () => {
    const { ctx } = ctxWith();
    const unary = ctx.lexLine('X[' + '-'.repeat(50000) + '1]'); // ---…1
    expect(unary.kind === 'cmd' && unary.params.x).toBeUndefined();
    const indirect = ctx.lexLine('X' + '#'.repeat(50000) + '1'); // ##…#1
    expect(indirect.kind === 'cmd' && indirect.params.x).toBeUndefined();
    // The point is simply that neither threw a RangeError out of lexLine.
  });
});

describe('rs274 review fixes', () => {
  it('a computed NaN stored in a param is NOT confused with uninitialized (BUG 2)', () => {
    const { ctx, warns } = ctxWith();
    ctx.lexLine('#1 = SQRT[0-1]'); // NaN, but written
    const a = ctx.lexLine('X#1');
    expect(a.kind === 'cmd' && a.params.x).toBeUndefined(); // non-finite → dropped
    expect(warns).toContain(RS274_WARN.nonFiniteValue);
    expect(warns).not.toContain(RS274_WARN.uninitializedParam); // it WAS written — no false uninit
  });

  it('a well-formed expression that evaluates to non-finite is dropped WITH a disclosure (BUG 3)', () => {
    const { ctx, warns } = ctxWith();
    const a = ctx.lexLine('X[1/0] Y5');
    expect(a.kind === 'cmd' && a.params.x).toBeUndefined();
    expect(a.kind === 'cmd' && a.params.y).toBe(5);
    expect(warns).toContain(RS274_WARN.nonFiniteValue);
  });

  it('a `;` inside a ( ) comment does not truncate the line (NIT 4)', () => {
    const { ctx } = ctxWith();
    ctx.lexLine('#1 = 3');
    ctx.lexLine('#2 = 7');
    const a = ctx.lexLine('X[#1] (a;b) Y[#2]'); // the `;` is inside the comment
    expect(a.kind === 'cmd' && a.params.x).toBe(3);
    expect(a.kind === 'cmd' && a.params.y).toBe(7);
  });

  it('EXISTS of a non-named argument returns 0 without an uninitialized read (NIT 5)', () => {
    const { ctx, warns } = ctxWith();
    const a = ctx.lexLine('X[EXISTS[#100]]'); // numbered, not named
    expect(a.kind === 'cmd' && a.params.x).toBe(0);
    expect(warns).not.toContain(RS274_WARN.uninitializedParam);
  });

  it('a leading N line-number before an assignment is honored (NIT 6)', () => {
    const { ctx } = ctxWith();
    expect(ctx.lexLine('N10 #1 = 5').kind).toBe('assign');
    const a = ctx.lexLine('X#1');
    expect(a.kind === 'cmd' && a.params.x).toBe(5);
  });
});

/** Evaluate an expression via a shared context (for stateful EXISTS/system-param tests). */
function evalXctx(ctx: Rs274Context, expr: string): number | undefined {
  const r = ctx.lexLine(`X${expr}`);
  return r.kind === 'cmd' ? r.params.x : undefined;
}

describe('rs274 integration — parseGcodeToIR', () => {
  it('resolves a parametric program to real geometry; capability known', () => {
    const gcode = [
      'G21',
      'G90',
      '#<side> = 10',
      'G1 X0 Y0',
      'G1 X#<side> Y0', // → X10
      'G1 X#<side> Y[#<side>/2]', // → X10 Y5
      'G1 X[#<side>*2] Y#<side>' // → X20 Y10
    ].join('\n');
    const { ir } = parseGcodeToIR(gcode);
    expect(ir.header.capabilities.parametricProgram).toBe('known');
    // Travel-inclusive bounds cover the resolved extremes (X 0..20, Y 0..10) — these G1s carry no E.
    expect(ir.boundsWithTravel.max.x).toBeCloseTo(20);
    expect(ir.boundsWithTravel.max.y).toBeCloseTo(10);
    expect(ir.segments.count).toBeGreaterThan(0);
  });

  it('a bolt-hole angle computed with degree trig lands where expected', () => {
    // One point on a radius-10 circle at 30° → (cos30*10, sin30*10) ≈ (8.66, 5).
    const gcode = ['G90', 'G1 X0 Y0', 'G1 X[10*COS[30]] Y[10*SIN[30]]'].join('\n');
    const { ir } = parseGcodeToIR(gcode);
    const n = ir.segments.count;
    const o = ir.header.originOffset;
    expect(o.x + ir.segments.x1[n - 1]).toBeCloseTo(8.6602, 3);
    expect(o.y + ir.segments.y1[n - 1]).toBeCloseTo(5, 3);
  });

  it('a non-parametric FDM line still reports parametricProgram unavailable', () => {
    const { ir } = parseGcodeToIR(['G1 X10 Y10 E1', 'G1 X20 Y10 E2'].join('\n'));
    expect(ir.header.capabilities.parametricProgram).toBe('unavailable');
  });

  it('resolves a realistic LinuxCNC/CAM-idiom parametric drill pattern (params + trig + canned cycle)', () => {
    // A bolt-circle drilling pattern the way a CAM post emits it (Phase-1 constructs only — no O-word
    // loop yet; each hole written out). center (50,40), radius 20, holes at 0° and 90°.
    const gcode = [
      'G21 G90 G17',
      '#<cx> = 50 (pattern center X)',
      '#<cy> = 40 (pattern center Y)',
      '#<r> = 20 (bolt-circle radius)',
      '#<zsafe> = 5',
      '#<zdepth> = -3',
      'G0 Z#<zsafe>',
      'G0 X[#<cx> + #<r> * COS[0]] Y[#<cy> + #<r> * SIN[0]]', // hole 1 → (70, 40)
      'G81 X[#<cx> + #<r> * COS[0]] Y[#<cy> + #<r> * SIN[0]] Z#<zdepth> R#<zsafe>',
      'G0 X[#<cx> + #<r> * COS[90]] Y[#<cy> + #<r> * SIN[90]]', // hole 2 → (50, 60)
      'G81 X[#<cx> + #<r> * COS[90]] Y[#<cy> + #<r> * SIN[90]] Z#<zdepth> R#<zsafe>'
    ].join('\n');
    const { ir } = parseGcodeToIR(gcode);
    expect(ir.header.capabilities.parametricProgram).toBe('known');
    // The computed hole positions land at their trig-derived extremes (hole 1 X=70, hole 2 Y=60), and
    // the canned cycle drills to the parametric depth Z=-3. (min X/Y are the origin start at 0,0.)
    expect(ir.boundsWithTravel.max.x).toBeCloseTo(70, 3);
    expect(ir.boundsWithTravel.max.y).toBeCloseTo(60, 3);
    expect(ir.boundsWithTravel.min.z).toBeCloseTo(-3, 3);
    // The canned cycles expanded to real geometry (DD-012) using the resolved coordinates.
    expect(ir.header.capabilities.cannedCycles).toBe('known');
  });
});
