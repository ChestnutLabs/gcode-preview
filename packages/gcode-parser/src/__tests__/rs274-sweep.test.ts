/**
 * Mutation sweep, slice 3: RS274 parameters + expressions (rs274.ts) and O-word flow (rs274-flow.ts).
 * Every expected value is a literal. Runaway-guard inputs are sized just over their cap and use bounded
 * loops: the interpreter is synchronous, so a test timeout cannot stop a hang — the input itself must
 * make a broken guard fail fast.
 */
import { describe, expect, it } from 'vitest';
import { parseGcodeToIR, type ParseOptions } from '../parse';
import { interpretOWordProgram, type FlowHost } from '../rs274-flow';

/** Absolute x/y/z of every segment end plus the warning codes. */
function run(gcode: string, opts?: ParseOptions) {
  const { ir } = parseGcodeToIR(gcode, opts);
  const s = ir.segments;
  const o = ir.header.originOffset;
  const pts: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < s.count; i++) pts.push({ x: o.x + s.x1[i], y: o.y + s.y1[i], z: o.z + s.z1[i] });
  const codes = ir.header.warnings.map((w) => w.code);
  const counts = Object.fromEntries(ir.header.warnings.map((w) => [w.code, w.count ?? 1]));
  return { ir, pts, xs: pts.map((p) => p.x), codes, counts };
}
const lines = (...l: string[]) => l.join('\n');

describe('expression parser: a `**` chain is depth-guarded like brackets and unary signs', () => {
  const chain = (n: number) => '1' + '**1'.repeat(n); // n exponent operators, value 1

  it('64 chained `**` evaluate; 65 are refused (assignment, no enclosing bracket)', () => {
    const ok = run(lines(`#1=${chain(64)}`, 'G1 X#1'));
    expect(ok.xs).toEqual([1]);
    expect(ok.codes).not.toContain('rs274-bad-expression');
    const over = run(lines(`#1=${chain(65)}`, 'G1 X#1'));
    expect(over.codes).toContain('rs274-bad-expression');
    expect(over.xs).toEqual([0]); // #1 never assigned → reads 0
  });

  it('an enclosing bracket spends one level of the same budget', () => {
    expect(run(`G1 X[${chain(63)}]`).xs).toEqual([1]);
    const over = run(`G1 X[${chain(64)}]`);
    expect(over.xs).toEqual([]);
    expect(over.codes).toContain('rs274-bad-expression');
  });

  it('the depth is released after each `**`: 200 sequential short powers still evaluate', () => {
    const sum = Array.from({ length: 200 }, () => '2**2').join('+'); // 200 × 4
    expect(run(`G1 X[${sum}]`).xs).toEqual([800]);
  });

  it('a 40 000-term chain (< 64 KiB line) is disclosed, not a stack overflow, in every expression path', () => {
    const big = chain(20_000); // 60 001 chars: under the 65 536-char line cap
    const asg = run(lines(`#1=${big}`, 'G1 X5'));
    expect(asg.codes).toContain('rs274-bad-expression');
    expect(asg.xs).toEqual([5]);
    const word = run(`G1 X${5} Y[${big}] Z2`);
    expect(word.codes).toContain('rs274-bad-expression');
    expect(word.pts).toEqual([{ x: 5, y: 0, z: 2 }]); // the bad Y word is dropped, Z2 still applies
    const ctl = run(lines(`o1 if [${big}]`, 'G1 X7', 'o1 endif'));
    expect(ctl.codes).toContain('rs274-bad-expression');
    expect(ctl.xs).toEqual([]);
  });

  it('`**` is right-associative and binds tighter than unary minus', () => {
    expect(run('G1 X[2**3**2]').xs).toEqual([512]);
    expect(run('G1 X[-2**2]').xs).toEqual([-4]);
    expect(run('G1 X[2**-1]').xs).toEqual([0.5]);
  });
});

describe('expression evaluation: non-finite and out-of-range results never reach the IR', () => {
  it('division and MOD by zero are dropped with a disclosure; the rest of the line survives', () => {
    for (const bad of ['1/0', '-1/0', '0/0', '5 MOD 0']) {
      const r = run(`G1 X[${bad}] Y5`);
      expect(r.codes).toContain('rs274-non-finite-value');
      expect(r.pts).toEqual([{ x: 0, y: 5, z: 0 }]);
    }
  });

  it('a huge exponent overflows to Infinity and is dropped', () => {
    const r = run('G1 X[10**400] Y1');
    expect(r.codes).toContain('rs274-non-finite-value');
    expect(r.pts).toEqual([{ x: 0, y: 1, z: 0 }]);
    expect(run('G1 X[10**-400]').xs).toEqual([0]); // underflow to 0 is a legal value
  });

  it('finite values beyond float32 are dropped with number-out-of-range, either sign', () => {
    expect(run('G1 X[2**127]').xs).toEqual([2 ** 127]);
    const pos = run('G1 X[2**128] Y1');
    expect(pos.codes).toContain('number-out-of-range');
    expect(pos.pts).toEqual([{ x: 0, y: 1, z: 0 }]);
    const neg = run('G1 X[-2**128] Y1');
    expect(neg.codes).toContain('number-out-of-range');
    expect(neg.pts).toEqual([{ x: 0, y: 1, z: 0 }]);
  });

  it('a stored non-finite parameter is dropped when it reaches a word, and does not poison others', () => {
    const r = run(lines('#31=SQRT[-1]', '#32=4', 'G1 X#31 Y#32'));
    expect(r.codes).toContain('rs274-non-finite-value');
    expect(r.pts).toEqual([{ x: 0, y: 4, z: 0 }]);
  });

  it('a non-finite G/M word is dropped, never emitted as a command', () => {
    const r = run('G1 X1\nG[1/0] X9');
    expect(r.codes).toContain('rs274-non-finite-value');
    expect(r.xs).toEqual([1, 9]); // modal G1 stays; the broken G word was dropped
  });

  it('relative moves that would sum past float32 are bounded by the stored-position guard', () => {
    const r = run('G91\nG1 X[3e38]\nG1 X[3e38]');
    for (const x of r.xs) expect(Number.isFinite(x)).toBe(true);
  });
});

describe('expression syntax errors: dropped and disclosed, parsing continues', () => {
  it('unbalanced brackets in a word, an assignment and a control line', () => {
    const w = run('G1 X[1+2 Y3');
    expect(w.codes).toContain('rs274-bad-expression');
    const a = run(lines('#1=[1+2', 'G1 X#1'));
    expect(a.codes).toContain('rs274-bad-expression');
    expect(a.xs).toEqual([0]);
    const extra = run(lines('#1=[1+2]]', 'G1 X#1'));
    expect(extra.codes).toContain('rs274-bad-expression');
    expect(extra.xs).toEqual([0]);
  });

  it('a stray `]` after a good word does not eat the next word', () => {
    const r = run('G1 X[1+2]] Y4');
    expect(r.pts).toEqual([{ x: 3, y: 4, z: 0 }]);
  });

  it('an unknown function name and an empty bracket are malformed', () => {
    expect(run('G1 X[FOO[1]] Y1').codes).toContain('rs274-bad-expression');
    expect(run('G1 X[] Y1').codes).toContain('rs274-bad-expression');
  });

  it('140 nested brackets are refused without overflowing; 60 evaluate', () => {
    const nest = (n: number) => '['.repeat(n) + '1' + ']'.repeat(n);
    expect(run(`G1 X${nest(60)}`).xs).toEqual([1]);
    const deep = run(`G1 X${nest(140)} Y2`);
    expect(deep.codes).toContain('rs274-bad-expression');
    expect(deep.pts).toEqual([{ x: 0, y: 2, z: 0 }]);
  });

  it('a long `##…#1` reference chain and a long unary chain are bounded', () => {
    const refs = run(`G1 X${'#'.repeat(100)}1 Y1`);
    expect(refs.codes).toContain('rs274-bad-expression');
    expect(refs.pts).toEqual([{ x: 0, y: 1, z: 0 }]);
    const signs = run(`G1 X[${'-'.repeat(100)}1] Y1`);
    expect(signs.codes).toContain('rs274-bad-expression');
    expect(signs.pts).toEqual([{ x: 0, y: 1, z: 0 }]);
    expect(run(`G1 X[${'-'.repeat(50)}1]`).xs).toEqual([1]);
  });
});

describe('parameter numbering and names', () => {
  it('#5399 is the last assignable numbered parameter; #5400+ are read-only system parameters', () => {
    expect(run('#5399=6\nG1 X#5399').xs).toEqual([6]);
    const sys = run('G1 X[#5400+2]');
    expect(sys.xs).toEqual([2]);
    expect(sys.codes).toContain('rs274-unsupported-sysparam');
  });

  it('#5420/#5421/#5422 read the current X/Y/Z', () => {
    const r = run('G1 X3 Y4 Z5\nG1 X[#5420+1] Y[#5421+1] Z[#5422+1]');
    expect(r.pts[1]).toEqual({ x: 4, y: 5, z: 6 });
    expect(r.codes).not.toContain('rs274-unsupported-sysparam');
  });

  it('#0 and negative numbers read 0 with the uninitialized-parameter disclosure', () => {
    for (const ref of ['#0', '#-1', '#[0-7]']) {
      const r = run(`G1 X[5+${ref}]`);
      expect(r.xs).toEqual([5]);
      expect(r.codes).toContain('rs274-uninitialized-param');
    }
  });

  it('#<name> is case-insensitive and whitespace-trimmed', () => {
    expect(run('#<Foo>=3\nG1 X#<fOO> Y#< foo >').pts).toEqual([{ x: 3, y: 3, z: 0 }]);
  });

  it('indirect references: #[expr] and ##1', () => {
    expect(run(lines('#10=77', '#1=10', 'G1 X#[5+5] Y##1')).pts).toEqual([{ x: 77, y: 77, z: 0 }]);
  });

  it('EXISTS tests a named parameter without reading it', () => {
    const r = run(lines('G1 X[EXISTS[#<a>]]', '#<a>=0', 'G1 X[EXISTS[#<a>]+2]', 'G1 X[EXISTS[#5]+4]'));
    expect(r.xs).toEqual([0, 3, 4]);
    expect(r.codes).not.toContain('rs274-uninitialized-param');
  });

  it('the named-parameter store holds 5000 names; the 5001st is ignored with ONE disclosure', () => {
    const l: string[] = [];
    for (let i = 0; i < 5000; i++) l.push(`#<p${i}>=1`);
    l.push('#<extra>=9', '#<extra2>=9', 'G1 X#<extra> Y#<p4999>');
    const r = run(l.join('\n'));
    expect(r.pts).toEqual([{ x: 0, y: 1, z: 0 }]);
    expect(r.counts['rs274-param-limit']).toBe(1);
    expect(r.counts['rs274-uninitialized-param']).toBe(1);
  });

  it('call arguments beyond 30 are ignored and never land in global #31', () => {
    const args = Array.from({ length: 31 }, (_, i) => `[${i + 1}]`).join('');
    const r = run(lines('o1 sub', 'G1 X#1 Y#30 Z#31', 'o1 endsub', `o1 call ${args}`));
    expect(r.pts).toEqual([{ x: 1, y: 30, z: 0 }]);
    expect(r.codes).toContain('rs274-uninitialized-param');
  });
});

describe('runaway guards sized just over the cap (bounded loops, fail fast)', () => {
  const G91 = 'G91';

  it('while: the budget is passes + body statements, exact at the boundary', () => {
    // 3 passes of one statement = 6 units.
    const prog = lines(G91, '#1=0', 'o1 while [#1 lt 3]', '#1=[#1+1]', 'o1 endwhile');
    const fit = run(prog, { limits: { maxProgramIterations: 6 } });
    expect(fit.codes).not.toContain('rs274-iteration-limit');
    const over = run(prog, { limits: { maxProgramIterations: 5 } });
    expect(over.counts['rs274-iteration-limit']).toBe(1);
  });

  it('do/while and repeat stop at the same boundary and run no further statement', () => {
    const dw = lines(G91, 'o1 do', 'G1 X1', 'o1 while [1]'); // infinite; 2 units per pass
    const a = run(dw, { limits: { maxProgramIterations: 6 } });
    expect(a.xs.length).toBe(3);
    expect(a.counts['rs274-iteration-limit']).toBe(1);
    const rp = lines(G91, 'o1 repeat [1000000000]', 'G1 X1', 'o1 endrepeat');
    const b = run(rp, { limits: { maxProgramIterations: 6 } });
    expect(b.xs.length).toBe(3);
    expect(b.counts['rs274-iteration-limit']).toBe(1);
  });

  it('a cap of 0 stops the first charged unit; straight-line code outside loops is never charged', () => {
    const r = run(lines(G91, 'G1 X1', 'o1 repeat [5]', 'G1 X1', 'o1 endrepeat', 'G1 X1'), {
      limits: { maxProgramIterations: 0 }
    });
    expect(r.xs.length).toBe(1); // halted inside the loop; the trailing line is never reached
    expect(r.counts['rs274-iteration-limit']).toBe(1);
  });

  it('the cap degrades the capability to approximated; a run within it stays known', () => {
    const p = lines('o1 repeat [100]', 'G1 X1', 'o1 endrepeat');
    expect(run(p, { limits: { maxProgramIterations: 10 } }).ir.header.capabilities.parametricProgram).toBe(
      'approximated'
    );
    expect(run(p, { limits: { maxProgramIterations: 200 } }).ir.header.capabilities.parametricProgram).toBe('known');
  });

  it('default maxCallDepth is 50: 50 nested calls run, the 51st is skipped and disclosed', () => {
    const rec = lines(G91, 'o100 sub', 'G1 X1', 'o100 call', 'o100 endsub', 'o100 call');
    const r = run(rec);
    expect(r.xs.length).toBe(50);
    expect(r.counts['rs274-call-depth']).toBe(1);
  });

  it('maxCallDepth 0 refuses every call; 1 allows exactly one level', () => {
    const rec = lines(G91, 'o100 sub', 'G1 X1', 'o100 call', 'o100 endsub', 'o100 call');
    expect(run(rec, { limits: { maxCallDepth: 0 } }).xs.length).toBe(0);
    expect(run(rec, { limits: { maxCallDepth: 1 } }).xs.length).toBe(1);
  });

  it('a call-depth refusal does not leak a scope: the caller still sees its own #1', () => {
    const p = lines(
      'o100 sub',
      '#1=[#1+1]',
      'o100 call [#1]',
      'o100 endsub',
      'o100 call [10]',
      'G1 X#1' // main scope never assigned #1
    );
    const r = run(p, { limits: { maxCallDepth: 3 } });
    expect(r.xs).toEqual([0]);
    expect(r.codes).toContain('rs274-call-depth');
  });

  it('a binary fan-out of depth 20 (2^20 calls) is stopped by the iteration cap, not by running it', () => {
    const p = lines(
      'o100 sub',
      'o1 if [#1 gt 0]',
      'o100 call [#1-1]',
      'o100 call [#1-1]',
      'o1 endif',
      'o100 endsub',
      'o100 call [20]'
    );
    const r = run(p, { limits: { maxProgramIterations: 2000 } });
    expect(r.counts['rs274-iteration-limit']).toBe(1);
  });

  it('the execution-depth backstop holds with structural nesting AND calls combined', () => {
    // 200 nested ifs inside a recursive sub: neither maxCallDepth (50) nor MAX_CONTROL_NESTING (256)
    // alone is exceeded by one frame, but 3 frames × 200 ifs is > 512 live execBlocks.
    const n = 200;
    const open = Array.from({ length: n }, (_, i) => `o${i + 1} if [1]`);
    const close = Array.from({ length: n }, (_, i) => `o${n - i} endif`);
    const p = lines('o999 sub', ...open, 'o999 call', ...close, 'o999 endsub', 'o999 call');
    const r = run(p);
    expect(r.codes).toContain('rs274-control-nesting');
  });
});

describe('O-word flow: labels, mismatches, scope unwinding', () => {
  it('an endif whose label differs still closes its if, with a disclosure', () => {
    const r = run(lines('o1 if [1]', 'G1 X1', 'o2 endif', 'G1 X2'));
    expect(r.xs).toEqual([1, 2]);
    expect(r.codes).toContain('rs274-unbalanced-oword');
  });

  it('a closer of the wrong kind does not close the open frame: both are unterminated and nothing runs', () => {
    const r = run(lines('G1 X9', 'o1 while [1]', 'G1 X1', 'o1 endrepeat'));
    expect(r.xs).toEqual([9]);
    expect(r.counts['rs274-unbalanced-oword']).toBe(2); // the stray closer + the open while at EOF
  });

  it('a stray endwhile/endif/endrepeat/endsub at the top level is disclosed and ignored', () => {
    for (const w of ['endwhile', 'endif', 'endrepeat', 'endsub']) {
      const r = run(lines('G1 X1', `o1 ${w}`, 'G1 X2'));
      expect(r.xs).toEqual([1, 2]);
      expect(r.codes).toContain('rs274-unbalanced-oword');
    }
  });

  it('`o2 while` inside `o1 do` opens a nested while (labels differ): nothing in the do runs', () => {
    const r = run(lines('o1 do', 'G1 X1', 'o2 while [0]', 'o1 enddo-ish'));
    expect(r.xs).toEqual([]);
  });

  it('`o1 do … o1 while [c]` with a matching label closes the do-loop', () => {
    const r = run(lines('G91', '#1=0', 'o1 do', '#1=[#1+1]', 'G1 X1', 'o1 while [#1 lt 3]'));
    expect(r.xs.length).toBe(3);
    expect(r.codes).not.toContain('rs274-unbalanced-oword');
  });

  it('an else with no if, an else after else, and a stray elseif are disclosed; later code runs', () => {
    expect(run(lines('o1 else', 'G1 X1')).xs).toEqual([1]);
    expect(run(lines('o1 elseif [1]', 'G1 X1')).codes).toContain('rs274-misplaced-control');
    const r = run(lines('o1 if [0]', 'G1 X1', 'o1 else', 'G1 X2', 'o1 else', 'G1 X3', 'o1 endif'));
    expect(r.xs).toEqual([2]);
    expect(r.codes).toContain('rs274-misplaced-control');
  });

  it('an unterminated sub is dropped and its call is "unknown"', () => {
    const r = run(lines('o1 sub', 'G1 X1', 'o1 call', 'G1 X2'));
    expect(r.xs).toEqual([]);
    expect(r.codes).toContain('rs274-unbalanced-oword');
  });

  it('break/continue/return at the top level are disclosed no-ops and the program continues', () => {
    const r = run(lines('G1 X1', 'o1 break', 'o2 continue', 'o3 return', 'G1 X2'));
    expect(r.xs).toEqual([1, 2]);
    expect(r.counts['rs274-misplaced-control']).toBe(3);
  });

  it('a return inside a loop inside a sub unwinds the loop AND the scope: the caller is unaffected', () => {
    const p = lines(
      'G91',
      'o1 sub',
      'o2 repeat [3]',
      'G1 X1',
      'o3 return',
      'o2 endrepeat',
      'o1 endsub',
      'o1 call',
      'o9 break', // a leaked loop depth would turn this no-op into an abort of everything below
      'G1 Y1'
    );
    const r = run(p);
    expect(r.pts).toEqual([
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 }
    ]);
    expect(r.counts['rs274-misplaced-control']).toBe(1);
  });

  it('a break in a loop-less sub called from inside a loop leaves the caller’s loop running', () => {
    const p = lines('G91', 'o1 sub', 'o9 break', 'o1 endsub', 'o2 repeat [3]', 'o1 call', 'G1 X1', 'o2 endrepeat');
    expect(run(p).xs.length).toBe(3);
  });

  it('continue in a while re-tests the condition; break leaves the loop', () => {
    const p = lines(
      'G91',
      '#1=0',
      'o1 while [#1 lt 10]',
      '#1=[#1+1]',
      'o2 if [#1 eq 2]',
      'o1 continue',
      'o2 endif',
      'o3 if [#1 eq 5]',
      'o1 break',
      'o3 endif',
      'G1 X1',
      'o1 endwhile'
    );
    expect(run(p).xs.length).toBe(3); // passes 1, 3, 4 emit; 2 continues; 5 breaks
  });

  it('a condition that cannot be evaluated is false and degrades the capability', () => {
    const r = run(lines('o1 if [1/0]', 'G1 X1', 'o1 else', 'G1 X2', 'o1 endif'));
    expect(r.codes).toContain('rs274-non-finite-value');
    expect(r.xs).toEqual([2]);
    expect(r.ir.header.capabilities.parametricProgram).toBe('approximated');
  });

  it('an unknown call and a malformed call argument are disclosed; a bad arg passes 0', () => {
    expect(run('o7 call').codes).toContain('rs274-unknown-sub');
    const r = run(lines('o1 sub', 'G1 X[#1+5]', 'o1 endsub', 'o1 call [1/0]'));
    expect(r.xs).toEqual([5]);
    expect(r.codes).toContain('rs274-non-finite-value');
  });

  it('structural nesting stops the BUILD at 257 and executes nothing (not even lines before it)', () => {
    const open = Array.from({ length: 257 }, (_, i) => `o${i} if [1]`);
    const r = run(lines('G1 X1', ...open));
    expect(r.xs).toEqual([]);
    expect(r.counts['rs274-control-nesting']).toBe(1);
  });
});

describe('survivors of the first RED pass: scope, loop-depth and label bookkeeping', () => {
  it('a full name store still updates an existing name (the cap is for NEW names only)', () => {
    const l: string[] = [];
    for (let i = 0; i < 5000; i++) l.push(`#<p${i}>=1`);
    l.push('#<p0>=9', '#<p5000>=7', 'G1 X#<p0> Y#<p5000>');
    const r = run(l.join('\n'));
    expect(r.pts).toEqual([{ x: 9, y: 0, z: 0 }]);
    expect(r.counts['rs274-param-limit']).toBe(1);
  });

  it('`#<_name>` is global across call frames; `#<name>` is local to its frame', () => {
    const p = lines(
      'o1 sub',
      '#<_g>=5',
      '#<l>=6',
      'o1 endsub',
      'o1 call',
      'G1 X#<_g> Y#<l>' // the callee’s local is gone: reads 0 with a disclosure
    );
    const r = run(p);
    expect(r.pts).toEqual([{ x: 5, y: 0, z: 0 }]);
    expect(r.counts['rs274-uninitialized-param']).toBe(1);
  });

  it('after a call returns inside a loop, a break in the CALLER still exits that loop', () => {
    const p = lines(
      'G91',
      'o1 sub',
      'G1 Y1',
      'o1 endsub',
      'o2 repeat [5]',
      'o1 call',
      'o2 break',
      'G1 X1',
      'o2 endrepeat'
    );
    const r = run(p);
    expect(r.pts).toEqual([{ x: 0, y: 1, z: 0 }]); // one call, then the break; no `G1 X1`
    expect(r.codes).not.toContain('rs274-misplaced-control');
  });

  it('straight-line statements after a finished loop are not charged against the iteration budget', () => {
    // cap 4: the loop uses 2 units (pass + one statement); a leaked loop depth would charge the tail.
    const tail = Array.from({ length: 10 }, () => 'G1 X1');
    const r = run(lines('G91', 'o1 repeat [1]', 'G1 X1', 'o1 endrepeat', ...tail), {
      limits: { maxProgramIterations: 4 }
    });
    expect(r.xs.length).toBe(11);
    expect(r.codes).not.toContain('rs274-iteration-limit');
  });

  it('a break AFTER a finished loop is a disclosed no-op, not an abort of the rest of the program', () => {
    const r = run(lines('G91', 'o1 repeat [1]', 'G1 X1', 'o1 endrepeat', 'o9 break', 'G1 X1'));
    expect(r.xs.length).toBe(2);
    expect(r.counts['rs274-misplaced-control']).toBe(1);
  });

  it('a mismatched endsub label is disclosed once, and the sub is still defined under its opener id', () => {
    const r = run(lines('o1 sub', 'G1 X4', 'o2 endsub', 'o1 call'));
    expect(r.xs).toEqual([4]);
    expect(r.counts['rs274-unbalanced-oword']).toBe(1);
  });
});

describe('interpretOWordProgram with a hand-written host', () => {
  const mkHost = (over: Partial<FlowHost> = {}): FlowHost => ({
    processLine: () => undefined,
    stopped: () => false,
    evalExpression: () => 1,
    pushScope: () => undefined,
    popScope: () => undefined,
    warn: () => undefined,
    maxProgramIterations: 1000,
    maxCallDepth: 50,
    ...over
  });
  const fl = (...t: string[]) => t.map((text, i) => ({ text, offset: i * 10 }));

  it('an error thrown by the host inside a subroutine propagates AND the scope is still popped', () => {
    let pushed = 0;
    let popped = 0;
    const host = mkHost({
      processLine: (t) => {
        if (t === 'BOOM') throw new Error('host failure');
      },
      pushScope: () => void pushed++,
      popScope: () => void popped++
    });
    expect(() => interpretOWordProgram(fl('o1 sub', 'BOOM', 'o1 endsub', 'o1 call'), host)).toThrow('host failure');
    expect([pushed, popped]).toEqual([1, 1]);
  });

  it('a host that reports stopped() halts the program and marks it degraded', () => {
    let seen = 0;
    const host = mkHost({
      processLine: () => void seen++,
      stopped: () => seen >= 2
    });
    const out = interpretOWordProgram(fl('G1 X1', 'G1 X2', 'G1 X3', 'G1 X4'), host);
    expect(seen).toBe(2);
    expect(out.degraded).toBe(true);
  });

  it('call arguments are evaluated in the caller before the scope is pushed, in order', () => {
    const log: string[] = [];
    const host = mkHost({
      evalExpression: (t) => (log.push(`eval ${t}`), Number(t.replace(/[[\]]/g, ''))),
      pushScope: (a) => void log.push(`push ${a.join(',')}`),
      popScope: () => void log.push('pop')
    });
    interpretOWordProgram(fl('o1 sub', 'o1 endsub', 'o1 call [7] [8]'), host);
    expect(log).toEqual(['eval [7]', 'eval [8]', 'push 7,8', 'pop']);
  });
});

describe('work bound: tests, arguments and text inside loops/subs draw on maxProgramIterations (P1)', () => {
  // Each program below ran for 3-30 s at the default cap before the fix (the cap only counted statements).
  // Now each is stopped at a small cap, so a broken guard finishes the whole program and fails the assertion.
  const LOOP = (body: string[], passes = 2000) =>
    lines('#1=0', `o2 while [#1 lt ${passes}]`, '#1=[#1+1]', ...body, 'o2 endwhile');
  const CAP = { limits: { maxProgramIterations: 5000 } };

  it('an elseif ladder: every tested branch costs a unit (1000 branches stop within 5 passes)', () => {
    const ladder = ['o1 if [0]', ...Array.from({ length: 1000 }, () => 'o1 elseif [0]'), 'o1 endif'];
    const t = Date.now();
    const r = run(LOOP(ladder), CAP);
    expect(r.counts['rs274-iteration-limit']).toBe(1);
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it('an 8 KB condition costs 31 extra units per test', () => {
    const cond = '[' + '1+'.repeat(4000) + '1]';
    const base = run(LOOP(['o3 if [1+1]', 'o3 endif']), { limits: { maxProgramIterations: 7000 } });
    expect(base.codes).not.toContain('rs274-iteration-limit'); // 2000 passes x 3 units = 6000 fit
    const r = run(LOOP(['o3 if ' + cond, 'o3 endif']), { limits: { maxProgramIterations: 7000 } });
    expect(r.counts['rs274-iteration-limit']).toBe(1); // 2000 x 34 does not
  });

  it('a call with 1000 arguments costs 1001+ units per call', () => {
    const r = run(
      lines('o1 sub', 'o1 endsub', 'o2 repeat [2000]', 'o1 call ' + '[1]'.repeat(1000), 'o2 endrepeat'),
      CAP
    );
    expect(r.counts['rs274-iteration-limit']).toBe(1);
  });

  it('a call argument costs 1 + its text weight (an 8 KB argument = 32 units per call)', () => {
    const arg = '[' + '0+'.repeat(4000) + '1]';
    const mk = (a: string) => lines('o1 sub', 'o1 endsub', 'o2 repeat [100]', 'o1 call ' + a, 'o2 endrepeat');
    const cap = { limits: { maxProgramIterations: 400 } }; // 100 x (1 pass + 1 call + 1 arg) = 300 fit
    expect(run(mk('[1]'), cap).codes).not.toContain('rs274-iteration-limit');
    expect(run(mk(arg), cap).counts['rs274-iteration-limit']).toBe(1);
  });

  it('500 empty `while [0]` blocks inside a loop: each entry costs a unit', () => {
    const empties: string[] = [];
    for (let i = 0; i < 500; i++) empties.push(`o${10 + i} while [0]`, `o${10 + i} endwhile`);
    const r = run(LOOP(empties), CAP);
    expect(r.counts['rs274-iteration-limit']).toBe(1);
  });

  it('a 40 KB statement inside a loop costs 156 extra units per pass', () => {
    const r = run(lines('o1 repeat [1000]', 'G1 X1 ;' + 'x'.repeat(40_000), 'o1 endrepeat'), {
      limits: { maxProgramIterations: 5000 }
    });
    expect(r.counts['rs274-iteration-limit']).toBe(1);
  });

  it('a long repeat count / while condition is charged on every evaluation', () => {
    const one = '[' + '0+'.repeat(4000) + '1]'; // value 1: one pass, so only the text weight can trip the cap
    const rep = run(lines('o1 repeat ' + one, 'o1 endrepeat'), { limits: { maxProgramIterations: 20 } });
    expect(rep.counts['rs274-iteration-limit']).toBe(1); // the count text (31 units) alone exceeds a cap of 20
    const dw = run(lines('G91', 'o1 do', 'G1 X1', 'o1 while [' + '0+'.repeat(4000) + '0 gt 5]'), {
      limits: { maxProgramIterations: 20 }
    });
    expect(dw.counts['rs274-iteration-limit']).toBe(1); // 1 pass + 1 stmt + 31 for the condition text
    const wh = run(lines('G91', 'o1 while [' + '1+'.repeat(4000) + '1 gt 0]', 'G1 X1', 'o1 endwhile'), {
      limits: { maxProgramIterations: 100 }
    });
    expect(wh.counts['rs274-iteration-limit']).toBe(1);
    expect(wh.xs.length).toBeLessThan(5);
  });

  it('exact unit counts are pinned: if-in-loop is 3 per pass, plain loop is 2, nested entry +1, else free', () => {
    const over = (p: string, cap: number) => run(p, { limits: { maxProgramIterations: cap } }).codes;
    const ifLoop = lines('G91', 'o1 repeat [2]', 'o2 if [1]', 'G1 X1', 'o2 endif', 'o1 endrepeat'); // 2 x (1+1+1)
    expect(over(ifLoop, 6)).not.toContain('rs274-iteration-limit');
    expect(over(ifLoop, 5)).toContain('rs274-iteration-limit');
    const plain = lines('G91', 'o1 repeat [2]', 'G1 X1', 'o1 endrepeat'); // 2 x (1+1): unchanged by this PR
    expect(over(plain, 4)).not.toContain('rs274-iteration-limit');
    expect(over(plain, 3)).toContain('rs274-iteration-limit');
    const nested = lines('G91', 'o1 repeat [1]', 'o2 repeat [1]', 'G1 X1', 'o2 endrepeat', 'o1 endrepeat'); // 1+1+1+1
    expect(over(nested, 4)).not.toContain('rs274-iteration-limit');
    expect(over(nested, 3)).toContain('rs274-iteration-limit');
    const elseArm = lines('G91', 'o1 repeat [1]', 'o2 if [0]', 'o2 else', 'G1 X1', 'o2 endif', 'o1 endrepeat'); // 1+1+1
    expect(over(elseArm, 3)).not.toContain('rs274-iteration-limit');
    expect(over(elseArm, 2)).toContain('rs274-iteration-limit');
  });

  it('root-level if tests and root-level statements are never charged (a straight-line program is not truncated)', () => {
    const prog = lines(
      'G91',
      ...Array.from(
        { length: 20 },
        (_, i) => `o${i + 1} if [1]
G1 X1
o${i + 1} endif`
      )
    );
    const r = run(prog, { limits: { maxProgramIterations: 0 } });
    expect(r.xs.length).toBe(20);
    expect(r.codes).not.toContain('rs274-iteration-limit');
  });

  it('an ordinary line (255 chars) costs nothing extra; 256 chars costs one', () => {
    const mk = (n: number) => lines('G91', 'o1 repeat [1]', 'G1 X1 ;' + 'x'.repeat(n - 7), 'o1 endrepeat');
    const over = (n: number) => run(mk(n), { limits: { maxProgramIterations: 2 } }).codes;
    expect(over(255)).not.toContain('rs274-iteration-limit');
    expect(over(256)).toContain('rs274-iteration-limit');
  });
});

describe('non-finite values are never silently laundered', () => {
  it('a comparison or logic operator with a NaN/Infinity operand is disclosed and false (0)', () => {
    const exprs = [
      '1/0 GT 5',
      'SQRT[-1] AND 1',
      '1 OR SQRT[-1]',
      '1/0 EQ 1/0',
      '5 LT 1/0',
      'SQRT[-1] XOR 0',
      '1 NE SQRT[-1]',
      '1 GE 1/0',
      '1 LE 1/0'
    ];
    for (const e of exprs) {
      const r = run(`G1 X[[${e}] + 7]`);
      expect(r.xs).toEqual([7]); // the operator yielded 0, not 1
      expect(r.counts['rs274-non-finite-value']).toBe(1);
    }
  });

  it('the non-finite operand disclosure is raised once per program, not once per use', () => {
    const r = run('G1 X[[1/0 GT 1]+1] Y[[1/0 GT 1]+2] Z[[SQRT[-1] AND 1]+3]');
    expect(r.pts).toEqual([{ x: 1, y: 2, z: 3 }]);
    expect(r.counts['rs274-non-finite-value']).toBe(1);
  });

  it('a finite comparison is unchanged and silent', () => {
    const r = run('G1 X[5 GT 1] Y[2 AND 3] Z[3 EQ 3.00001]');
    expect(r.pts).toEqual([{ x: 1, y: 1, z: 1 }]);
    expect(r.codes).not.toContain('rs274-non-finite-value');
  });

  it('an `if` whose condition compares a non-finite value does not take the branch', () => {
    const r = run(lines('o1 if [1/0 GT 5]', 'G1 X1', 'o1 else', 'G1 X2', 'o1 endif'));
    expect(r.xs).toEqual([2]);
    expect(r.codes).toContain('rs274-non-finite-value');
  });

  it('a NaN or infinite parameter INDEX reads 0 with a disclosure (never undefined) and writes nothing', () => {
    for (const idx of ['SQRT[-1]', '1/0', '-1/0']) {
      const rd = run(`G1 X[#[${idx}] + 3]`);
      expect(rd.xs).toEqual([3]);
      expect(rd.counts['rs274-non-finite-value']).toBe(1);
      const wr = run(lines(`#[${idx}]=9`, 'G1 X1'));
      expect(wr.xs).toEqual([1]);
      expect(wr.counts['rs274-non-finite-value']).toBe(1);
    }
  });
});

describe('writes to read-only or out-of-range numbered parameters are disclosed once', () => {
  it('#0, a negative number, #5400 and #9999 each ignore the write with rs274-readonly-param', () => {
    for (const t of ['#0', '#[0-3]', '#5420', '#5400', '#9999']) {
      const r = run(lines(`${t}=5`, 'G1 X1'));
      expect(r.xs).toEqual([1]);
      expect(r.counts['rs274-readonly-param']).toBe(1);
    }
  });

  it('several rejected writes give one warning; a valid write gives none', () => {
    const r = run(lines('#0=1', '#5420=2', '#9999=3', '#100=4', 'G1 X#100'));
    expect(r.xs).toEqual([4]);
    expect(r.counts['rs274-readonly-param']).toBe(1);
    expect(run('#5399=1\n#1=2\nG1 X1').codes).not.toContain('rs274-readonly-param');
  });
});

describe('ROUND is half away from zero (LinuxCNC interp_execute.cc:408-411)', () => {
  it.each([
    ['2.5', 3],
    ['-2.5', -3],
    ['2.4', 2],
    ['-2.4', -2],
    ['0.5', 1],
    ['-0.5', -1],
    ['-0.49', 0],
    ['1.5', 2],
    ['-1.5', -2]
  ])('ROUND[%s] = %s', (v, want) => {
    const r = run(`G1 X[ROUND[${v}]]`);
    expect(r.xs[0] + 0).toBe(want + 0); // +0 folds -0 to 0
  });
});
