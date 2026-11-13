/*
 * The program-wide iteration budget (#598, DD-017 §4.5): one object per parse, shared by the O-word interpreter and
 * the canned-cycle L repeats. These tests drive the interpreter and drawFromBudget directly; the end-to-end pins
 * (cycles and loops in one file) live in program-iteration-budget.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { createProgramBudget, drawFromBudget, interpretOWordProgram, type FlowHost } from '../rs274-flow';

const mkHost = (over: Partial<FlowHost> = {}): FlowHost => ({
  processLine: () => undefined,
  stopped: () => false,
  evalExpression: (t) => Number(t.replace(/[[\]]/g, '')),
  pushScope: () => undefined,
  popScope: () => undefined,
  warn: () => undefined,
  maxProgramIterations: 1000,
  maxCallDepth: 50,
  ...over
});
const fl = (...t: string[]) => t.map((text, i) => ({ text, offset: i * 10 }));

describe('drawFromBudget', () => {
  it('grants what is left, charges it, and grants 0 once the budget is spent', () => {
    const b = createProgramBudget(10);
    expect(drawFromBudget(b, 4)).toBe(4);
    expect(b.used).toBe(4);
    expect(drawFromBudget(b, 10)).toBe(6);
    expect(b.used).toBe(10);
    expect(drawFromBudget(b, 3)).toBe(0);
    expect(b.used).toBe(10);
  });

  it('five L1e9 draws at limit 1000 grant 1000, 0, 0, 0, 0 (1000 charged in total)', () => {
    const b = createProgramBudget(1000);
    const granted = [1, 2, 3, 4, 5].map(() => drawFromBudget(b, 1_000_000_000));
    expect(granted).toEqual([1000, 0, 0, 0, 0]);
    expect(b.used).toBe(1000);
  });

  it('grants 0 (never a negative count) after a loop charge ran past the limit', () => {
    const b = createProgramBudget(10);
    b.used = 11; // the interpreter's stopping charge leaves used one past the limit
    expect(drawFromBudget(b, 3)).toBe(0);
    expect(b.used).toBe(11);
  });
});

describe('interpretOWordProgram with a shared budget', () => {
  it('charges loop work to the budget it is given, so work drawn before the program counts', () => {
    const budget = createProgramBudget(10);
    budget.used = 7; // e.g. a canned cycle earlier in the parse
    const ran: string[] = [];
    const warned: [string, string][] = [];
    const host = mkHost({
      processLine: (t) => void ran.push(t),
      warn: (code, msg) => void warned.push([code, msg]),
      budget
    });
    const out = interpretOWordProgram(fl('o1 repeat [100]', 'G1 X1', 'o1 endrepeat'), host);
    // pass 8, line 9 (runs), pass 10, line 11 > 10 → stop
    expect(ran).toEqual(['G1 X1']);
    expect(budget.used).toBe(11);
    expect(warned).toEqual([['rs274-iteration-limit', 'program iteration limit 10 reached; execution stopped']]);
    expect(out.degraded).toBe(true);
  });

  it('the budget limit is the cap, not host.maxProgramIterations', () => {
    const ran: string[] = [];
    const host = mkHost({
      processLine: (t) => void ran.push(t),
      maxProgramIterations: 1000,
      budget: createProgramBudget(4)
    });
    interpretOWordProgram(fl('o1 repeat [100]', 'G1 X1', 'o1 endrepeat'), host);
    expect(ran).toHaveLength(2);
  });

  it('leaves the units it used on the budget after a clean run, for later draws', () => {
    const budget = createProgramBudget(1000);
    const out = interpretOWordProgram(fl('o1 repeat [3]', 'G1 X1', 'o1 endrepeat'), mkHost({ budget }));
    expect(out.degraded).toBe(false);
    expect(budget.used).toBe(6); // 3 passes + 3 statements
    expect(drawFromBudget(budget, 1_000_000)).toBe(994);
  });

  it('without a budget the cap is host.maxProgramIterations, as before', () => {
    const ran: string[] = [];
    interpretOWordProgram(
      fl('o1 repeat [100]', 'G1 X1', 'o1 endrepeat'),
      mkHost({ processLine: (t) => void ran.push(t), maxProgramIterations: 4 })
    );
    expect(ran).toHaveLength(2);
  });
});
