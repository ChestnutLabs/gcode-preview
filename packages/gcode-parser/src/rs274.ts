/*
 * RS274NGC parametric programs — Phase 1: parameters + expressions (DD-017, phase 7 of #189).
 *
 * A pure, self-contained interpreter for the RS274NGC *programming* layer that FDM slicers never use:
 * numbered/named parameters (`#100`, `#<name>`, `#<_global>`), assignment (`#n = <expr>`), and bracket
 * expressions (`[ ... ]`) usable wherever a numeric word value is expected (`X[#1+2]`, `F[#feed]`).
 *
 * SCOPE (Phase 1): parameters + expressions ONLY. O-word control flow (`if`/`while`/`sub`/`call`) is
 * Phase 2 — this module executes straight-line, in source order. There is **no I/O and no `eval`**: a
 * fixed-grammar recursive-descent evaluator over `f64`, with a depth guard, so a hostile program can
 * waste only bounded CPU (DD-017 §4.5). Malformed input never throws out of the parse — the offending
 * word is dropped with a disclosure and parsing continues (DD-017 §4.3/§4.6).
 *
 * Semantics follow RS274NGC / LinuxCNC *behaviour* (NIST IR 6556; behavioural parity, no spec text
 * copied — RR-004 §6). Notably: trig is in **degrees**; `MOD` is floored (LinuxCNC, sign of divisor);
 * `EQ`/`NE` compare within a small tolerance; `FIX` = floor, `FUP` = ceil; booleans are `1`/`0`.
 *
 * This module is imported only by the parser engine and depends on nothing outside the package.
 */

/** Warning codes surfaced to the IR (DD-017 §4.6). */
export const RS274_WARN = {
  uninitializedParam: 'rs274-uninitialized-param',
  badExpression: 'rs274-bad-expression',
  nonFiniteValue: 'rs274-non-finite-value',
  unsupportedSysParam: 'rs274-unsupported-sysparam',
  paramLimit: 'rs274-param-limit'
} as const;

const MAX_EXPR_DEPTH = 64; // recursive-descent nesting guard for adversarial `[[[[…]]]]`
const MAX_NAMED_PARAMS = 5000; // bound the named-parameter store
const NUMBERED_LEN = 5400; // `#1`..`#5399` (index 0 unused); `#5400`+ are system params
const EQ_TOLERANCE = 1e-4; // LinuxCNC compares EQ/NE within a small tolerance
const DEG = Math.PI / 180;

/** A thrown control signal used internally to abort a malformed expression; never escapes the module. */
class Rs274EvalError extends Error {}

export type WarnFn = (code: string, message: string, srcByte?: number) => void;
export type PositionProvider = () => { x: number; y: number; z: number };

/**
 * True when a line's code section (comment already stripped) uses a parametric construct. A cheap
 * character scan — the parser runs this per line so a non-parametric line (every FDM line) takes the
 * untouched fast path and stays byte-identical.
 */
export function lineUsesParametric(codeSection: string): boolean {
  return codeSection.indexOf('#') !== -1 || codeSection.indexOf('[') !== -1;
}

/** Strip RS274NGC `( … )` comments from a code section (they are comments, never expressions). */
function stripParenComments(s: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') {
      if (depth > 0) depth--;
    } else if (depth === 0) out += c;
  }
  return out;
}

/** The result of lexing one parametric line. */
export type ParametricLine =
  | { kind: 'empty' }
  | { kind: 'plain' } // not actually parametric (e.g. `#` only in a comment) — use the normal lexer
  | { kind: 'assign' } // already applied to the store
  | { kind: 'cmd'; codes: string[]; params: Record<string, number> };

/**
 * The parameter store + expression evaluator for one program. Straight-line (Phase 1): a single scope,
 * assignments applied as they execute. Numbered params default to `0` on read-before-write (with a
 * one-time disclosure); named params likewise. A read-only allow-list resolves a few system parameters
 * (current position) from live engine state; any other system parameter reads `0` and is disclosed.
 */
export class Rs274Context {
  private readonly numbered = new Float64Array(NUMBERED_LEN);
  // 1 = the slot was assigned. Separate from the value so a legitimately computed NaN/Inf (e.g.
  // `#1 = SQRT[-1]`) is distinguishable from "never written" (which reads 0 + discloses).
  private readonly numberedWritten = new Uint8Array(NUMBERED_LEN);
  private readonly named = new Map<string, number>();
  private uninitWarned = false;
  private paramLimitWarned = false;
  /** True once any parametric construct was executed — drives the `parametricProgram` capability. */
  used = false;

  constructor(
    private readonly warn: WarnFn,
    private readonly position: PositionProvider
  ) {}

  private warnUninit(srcByte?: number): void {
    if (this.uninitWarned) return;
    this.uninitWarned = true;
    this.warn(RS274_WARN.uninitializedParam, 'read of an uninitialized parameter (RS274NGC default 0)', srcByte);
  }

  private readNumbered(n: number, srcByte?: number): number {
    const idx = Math.round(n);
    if (idx >= NUMBERED_LEN) return this.readSystem(idx, srcByte);
    if (idx < 1) {
      this.warnUninit(srcByte);
      return 0;
    }
    if (this.numberedWritten[idx] === 0) {
      this.warnUninit(srcByte);
      return 0;
    }
    return this.numbered[idx];
  }

  private readSystem(n: number, srcByte?: number): number {
    // Read-only allow-list (DD-017 §4.2): current commanded position, origin-relative to match how the
    // engine tracks it. Anything else is honestly unsupported → 0 + disclosure.
    const p = this.position();
    if (n === 5420) return p.x;
    if (n === 5421) return p.y;
    if (n === 5422) return p.z;
    this.warn(RS274_WARN.unsupportedSysParam, `system parameter #${n} is not supported; read as 0`, srcByte);
    return 0;
  }

  private readNamed(name: string, srcByte?: number): number {
    const v = this.named.get(name);
    if (v === undefined) {
      this.warnUninit(srcByte);
      return 0;
    }
    return v;
  }

  private writeNumbered(n: number, value: number): void {
    const idx = Math.round(n);
    if (idx >= 1 && idx < NUMBERED_LEN) {
      this.numbered[idx] = value;
      this.numberedWritten[idx] = 1;
    }
  }

  private writeNamed(name: string, value: number): void {
    if (this.named.has(name) || this.named.size < MAX_NAMED_PARAMS) this.named.set(name, value);
    else if (!this.paramLimitWarned) {
      this.paramLimitWarned = true;
      this.warn(
        RS274_WARN.paramLimit,
        `named-parameter limit (${MAX_NAMED_PARAMS}) reached; further new names ignored`
      );
    }
  }

  /** `EXISTS[#<name>]` → 1 if the named parameter has been assigned, else 0. */
  private exists(name: string): number {
    return this.named.has(name) ? 1 : 0;
  }

  /**
   * Lex one RAW parametric line — either apply a `#… = …` assignment, or resolve every word value into a
   * plain-number `Cmd` for the engine's existing dispatch. Strips `( … )` comments BEFORE the `;` comment
   * (RS274NGC order, so a `;` inside parens doesn't truncate the line). Malformed constructs are dropped +
   * disclosed; the line still parses as far as it can.
   */
  lexLine(rawLine: string, srcByte?: number): ParametricLine {
    const body = stripParenComments(rawLine).split(';')[0].trim();
    if (body === '') return { kind: 'empty' };
    // The `#`/`[` was only inside a comment — this is a plain line; let the normal lexer own it.
    if (!lineUsesParametric(body)) return { kind: 'plain' };
    this.used = true;

    // Assignment: `[N<line>] #<param> = <expr>` (a leading N line-number is allowed, LinuxCNC).
    const assignBody = body.replace(/^n\d+\s*/i, '');
    if (assignBody[0] === '#') {
      const eq = topLevelEqIndex(assignBody);
      if (eq !== -1) {
        try {
          const p = new Evaluator(assignBody, this, srcByte);
          p.skipWs();
          const target = p.readParamTarget(); // where to store
          p.skipWs();
          p.expect('=');
          const value = p.parseExpr(0);
          p.skipWsToEnd(); // trailing garbage → malformed
          target(value);
          return { kind: 'assign' };
        } catch (e) {
          if (e instanceof Rs274EvalError) {
            this.warn(RS274_WARN.badExpression, `malformed parameter assignment dropped: ${e.message}`, srcByte);
            return { kind: 'assign' }; // consumed the line; nothing stored
          }
          throw e;
        }
      }
    }

    // Motion/command line: walk words, resolving `#ref` / `[expr]` values to numbers.
    const codes: string[] = [];
    const params: Record<string, number> = {};
    let sawCommand = false;
    const ev = new Evaluator(body, this, srcByte);
    ev.skipWs();
    while (!ev.atEnd()) {
      const key = ev.readWordLetter();
      if (key === null) {
        ev.dropToNextLetter(); // skip an unexpected char, keep going
        continue;
      }
      let value: number;
      try {
        value = ev.readWordValue();
      } catch (e) {
        if (e instanceof Rs274EvalError) {
          this.warn(RS274_WARN.badExpression, `malformed word value for '${key.toUpperCase()}' dropped`, srcByte);
          ev.dropToNextLetter();
          continue;
        }
        throw e;
      }
      if (!Number.isFinite(value)) {
        // A well-formed expression that evaluated to NaN/Infinity (e.g. `X[1/0]`, `X[SQRT[-1]]`) — the
        // word is dropped, but disclosed (DD-017 §4.6), never silent.
        this.warn(
          RS274_WARN.nonFiniteValue,
          `word '${key.toUpperCase()}' evaluated to a non-finite value; dropped`,
          srcByte
        );
        ev.skipWs();
        continue;
      }
      if (key === 'g' || key === 'm') {
        codes.push(`${key}${value}`);
        sawCommand = true;
      } else if (key === 't' && !sawCommand) {
        codes.push(`t${value}`);
        sawCommand = true;
      } else if (key === 'n') {
        // line number — ignored
      } else {
        params[key] = value;
      }
      ev.skipWs();
    }
    return { kind: 'cmd', codes, params };
  }

  // --- operand hooks used by the Evaluator ---
  _readParam(kind: 'numbered' | 'named', key: number | string, srcByte?: number): number {
    return kind === 'numbered' ? this.readNumbered(key as number, srcByte) : this.readNamed(key as string, srcByte);
  }
  _writeParam(kind: 'numbered' | 'named', key: number | string, value: number): void {
    if (kind === 'numbered') this.writeNumbered(key as number, value);
    else this.writeNamed(key as string, value);
  }
  _exists(name: string): number {
    return this.exists(name);
  }
}

/** Index of a top-level `=` (not inside brackets), or -1. */
function topLevelEqIndex(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === '=' && depth === 0) return i;
  }
  return -1;
}

const FUNCS = new Set([
  'abs',
  'acos',
  'asin',
  'cos',
  'sin',
  'tan',
  'exp',
  'fix',
  'fup',
  'ln',
  'round',
  'sqrt',
  'atan',
  'exists'
]);

/** A cursor-based recursive-descent evaluator over one line's body. */
class Evaluator {
  private i = 0;
  private depth = 0;
  constructor(
    private readonly s: string,
    private readonly ctx: Rs274Context,
    private readonly srcByte?: number
  ) {}

  atEnd(): boolean {
    return this.i >= this.s.length;
  }
  skipWs(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  skipWsToEnd(): void {
    this.skipWs();
    if (!this.atEnd()) throw new Rs274EvalError(`trailing '${this.s.slice(this.i)}'`);
  }
  expect(ch: string): void {
    if (this.s[this.i] !== ch) throw new Rs274EvalError(`expected '${ch}'`);
    this.i++;
  }
  dropToNextLetter(): void {
    // Recover from a malformed word: advance to the next a-z letter (or end).
    if (this.i < this.s.length) this.i++;
    while (this.i < this.s.length && !isLetter(this.s[this.i])) this.i++;
  }

  /** Read a single command/axis letter (a–z), or null if the cursor isn't on a letter. */
  readWordLetter(): string | null {
    this.skipWs();
    const c = this.s[this.i];
    if (c !== undefined && isLetter(c)) {
      this.i++;
      return c.toLowerCase();
    }
    return null;
  }

  /** Read a word's value: a `#`param-ref, a `[expr]`, or a numeric literal. */
  readWordValue(): number {
    this.skipWs();
    const c = this.s[this.i];
    if (c === '#') return this.readParamRef();
    if (c === '[') return this.parseBracket();
    return this.readNumber();
  }

  /** Read a parameter *reference* as an operand and return its value. Depth-guarded (bounds `##…` chains). */
  private readParamRef(): number {
    if (++this.depth > MAX_EXPR_DEPTH) throw new Rs274EvalError('reference nested too deep');
    try {
      this.expect('#');
      this.skipWs();
      const c = this.s[this.i];
      if (c === '[') return this.ctx._readParam('numbered', this.parseBracket(), this.srcByte); // `#[expr]`
      if (c === '#') return this.ctx._readParam('numbered', this.readParamRef(), this.srcByte); // `##ref`
      if (c === '<') return this.ctx._readParam('named', this.readNamedRef(), this.srcByte);
      return this.ctx._readParam('numbered', this.readNumber(), this.srcByte); // `#N`
    } finally {
      this.depth--;
    }
  }

  /** Read the assignment *target* and return a setter that stores a value there. */
  readParamTarget(): (value: number) => void {
    this.expect('#');
    this.skipWs();
    const c = this.s[this.i];
    if (c === '[') {
      const n = this.parseBracket();
      return (v) => this.ctx._writeParam('numbered', n, v);
    }
    if (c === '#') {
      const n = this.readParamRef();
      return (v) => this.ctx._writeParam('numbered', n, v);
    }
    if (c === '<') {
      const name = this.readNamedRef();
      return (v) => this.ctx._writeParam('named', name, v);
    }
    const n = this.readNumber();
    return (v) => this.ctx._writeParam('numbered', n, v);
  }

  private readNamedRef(): string {
    this.expect('<');
    let name = '';
    while (this.i < this.s.length && this.s[this.i] !== '>') name += this.s[this.i++];
    this.expect('>');
    return name.trim().toLowerCase();
  }

  private readNumber(): number {
    this.skipWs();
    const start = this.i;
    if (this.s[this.i] === '+' || this.s[this.i] === '-') this.i++;
    let sawDigit = false;
    while (this.i < this.s.length && /[0-9]/.test(this.s[this.i])) {
      this.i++;
      sawDigit = true;
    }
    if (this.s[this.i] === '.') {
      this.i++;
      while (this.i < this.s.length && /[0-9]/.test(this.s[this.i])) {
        this.i++;
        sawDigit = true;
      }
    }
    if (!sawDigit) throw new Rs274EvalError(`expected a number at '${this.s.slice(start, start + 8)}'`);
    return Number(this.s.slice(start, this.i));
  }

  private parseBracket(): number {
    if (++this.depth > MAX_EXPR_DEPTH) throw new Rs274EvalError('expression nested too deep');
    this.expect('[');
    const v = this.parseExpr(0);
    this.skipWs();
    this.expect(']');
    this.depth--;
    return v;
  }

  /**
   * Precedence-climbing expression parser. RS274NGC precedence, tightest → loosest:
   * `**` > `* / MOD` > `+ -` > comparisons > logical. Implemented as levels 0..4 (0 = loosest).
   */
  parseExpr(level: number): number {
    if (level >= LEVELS.length) return this.parseUnary();
    let left = this.parseExpr(level + 1);
    for (;;) {
      this.skipWs();
      const op = this.peekOperator(LEVELS[level]);
      if (op === null) return left;
      this.i += op.length;
      const right = this.parseExpr(level + 1);
      left = applyBinary(op, left, right);
    }
  }

  private parseUnary(): number {
    this.skipWs();
    const c = this.s[this.i];
    if (c === '+' || c === '-') {
      if (++this.depth > MAX_EXPR_DEPTH) throw new Rs274EvalError('expression nested too deep'); // bounds `----…` chains
      this.i++;
      const v = c === '-' ? -this.parseUnary() : this.parseUnary();
      this.depth--;
      return v;
    }
    return this.parsePower();
  }

  /** `**` binds tighter than everything and is right-associative (`2**3**2` = `2**9`). */
  private parsePower(): number {
    const base = this.parseAtom();
    this.skipWs();
    if (this.s[this.i] === '*' && this.s[this.i + 1] === '*') {
      this.i += 2;
      const exp = this.parseUnary(); // right-assoc + allows `2 ** -1`
      return Math.pow(base, exp);
    }
    return base;
  }

  private parseAtom(): number {
    this.skipWs();
    const c = this.s[this.i];
    if (c === '#') return this.readParamRef();
    if (c === '[') return this.parseBracket();
    if (isLetter(c)) {
      const name = this.readIdentifier();
      if (FUNCS.has(name)) return this.callFunction(name);
      throw new Rs274EvalError(`unexpected '${name}'`);
    }
    return this.readNumber();
  }

  private readIdentifier(): string {
    let id = '';
    while (this.i < this.s.length && isLetter(this.s[this.i])) id += this.s[this.i++];
    return id.toLowerCase();
  }

  private callFunction(name: string): number {
    if (name === 'exists') return this.parseExistsArg();
    if (name === 'atan') {
      // `ATAN[y]/[x]` — degrees.
      const y = this.parseBracket();
      this.skipWs();
      this.expect('/');
      const x = this.parseBracket();
      return Math.atan2(y, x) / DEG;
    }
    return applyFunction(name, this.parseBracket());
  }

  /**
   * `EXISTS[#<name>]` — test a named parameter's existence WITHOUT reading it (no uninitialized read).
   * RS274NGC/LinuxCNC defines EXISTS only for a named parameter; any other argument is not an existence
   * query and returns 0 (its content is skipped, not evaluated — so it triggers no read/side effect).
   */
  private parseExistsArg(): number {
    if (++this.depth > MAX_EXPR_DEPTH) throw new Rs274EvalError('expression nested too deep');
    this.expect('[');
    this.skipWs();
    let result: number;
    if (this.s[this.i] === '#' && this.s[this.i + 1] === '<') {
      this.i++; // consume '#'
      result = this.ctx._exists(this.readNamedRef());
      this.skipWs();
      this.expect(']');
    } else {
      this.skipToCloseBracket();
      result = 0;
    }
    this.depth--;
    return result;
  }

  /** Consume up to and including the matching `]` (for a non-evaluated EXISTS argument). */
  private skipToCloseBracket(): void {
    let d = 1;
    while (this.i < this.s.length && d > 0) {
      const c = this.s[this.i++];
      if (c === '[') d++;
      else if (c === ']') d--;
    }
    if (d !== 0) throw new Rs274EvalError("unbalanced '[' in EXISTS");
  }

  /** Peek an operator belonging to `ops`; return its lexeme or null. Word ops must be word-bounded. */
  private peekOperator(ops: readonly string[]): string | null {
    for (const op of ops) {
      if (op === '**') continue; // power handled in parsePower
      const isWord = /^[a-z]+$/.test(op);
      if (isWord) {
        const seg = this.s.slice(this.i, this.i + op.length).toLowerCase();
        if (seg === op) {
          const after = this.s[this.i + op.length];
          if (after === undefined || !isLetter(after)) return op;
        }
      } else if (this.s.startsWith(op, this.i)) {
        if (op === '*' && this.s[this.i + 1] === '*') continue; // don't eat `**` as `*`
        return op;
      }
    }
    return null;
  }
}

// Operator levels, loosest (0) → tightest. `**` lives at the power level handled specially.
const LEVELS: readonly (readonly string[])[] = [
  ['and', 'or', 'xor'],
  ['eq', 'ne', 'gt', 'ge', 'lt', 'le'],
  ['+', '-'],
  ['*', '/', 'mod']
];

function isLetter(c: string | undefined): boolean {
  if (c === undefined) return false;
  const cc = c.charCodeAt(0);
  return (cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122);
}

const bool = (b: boolean): number => (b ? 1 : 0);

function applyBinary(op: string, a: number, b: number): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return a / b;
    case 'mod':
      return a - b * Math.floor(a / b); // LinuxCNC: floored, sign of divisor
    case 'and':
      return bool(a !== 0 && b !== 0);
    case 'or':
      return bool(a !== 0 || b !== 0);
    case 'xor':
      return bool((a !== 0) !== (b !== 0));
    case 'eq':
      return bool(Math.abs(a - b) < EQ_TOLERANCE);
    case 'ne':
      return bool(Math.abs(a - b) >= EQ_TOLERANCE);
    case 'gt':
      return bool(a > b);
    case 'ge':
      return bool(a >= b);
    case 'lt':
      return bool(a < b);
    case 'le':
      return bool(a <= b);
    default:
      throw new Rs274EvalError(`unknown operator '${op}'`);
  }
}

function applyFunction(name: string, x: number): number {
  switch (name) {
    case 'abs':
      return Math.abs(x);
    case 'acos':
      return Math.acos(x) / DEG;
    case 'asin':
      return Math.asin(x) / DEG;
    case 'cos':
      return Math.cos(x * DEG);
    case 'sin':
      return Math.sin(x * DEG);
    case 'tan':
      return Math.tan(x * DEG);
    case 'exp':
      return Math.exp(x);
    case 'fix':
      return Math.floor(x); // round toward -inf
    case 'fup':
      return Math.ceil(x); // round toward +inf
    case 'ln':
      return Math.log(x);
    case 'round':
      return Math.round(x);
    case 'sqrt':
      return Math.sqrt(x);
    default:
      throw new Rs274EvalError(`unknown function '${name}'`);
  }
}
