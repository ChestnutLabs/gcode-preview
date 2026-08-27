/*
 * RS274NGC parametric programs — Phase 2: O-word control flow (DD-017 §4.4/§4.5, phase 7 of #189).
 *
 * Phase 1 (`rs274.ts`) added the parameter store + expression evaluator on a forward-only line model.
 * Control flow breaks that model: `while`/`repeat`/`do` RE-RUN a line range and `if`/`elseif`/`else`
 * SKIP one, which a once-per-line driver cannot express (DD-017 §1). This module is the program-buffered
 * interpreter of DD-017 D1 Option A: engaged only when a program actually contains an O-word control line
 * (`programUsesOWords`), it buffers the whole program (small — hand/CAM-written, not million-line FDM),
 * builds a block tree, and executes it, feeding every non-control line back through the SAME engine
 * `processLine` (so geometry/params/expressions stay on one code path). Non-O-word input never reaches
 * here and stays byte-identical.
 *
 * SUPPORTED: `if`/`elseif`/`else`/`endif`, `while`/`endwhile`, `do`/`while`, `repeat`/`endrepeat`,
 * `break`/`continue` (Phase 2), and in-file subroutines `sub`/`endsub`/`call`/`return` (Phase 3 — a
 * `call` binds args to `#1`..`#30` in a fresh scope, runs the named sub's body, and returns; subs may
 * recurse and be forward-referenced). External subroutine files (`M98`) stay a non-goal (no I/O).
 *
 * BOUNDED EXECUTION (DD-017 §4.5 — this is a small interpreter, so a hostile `o while [1]` or an
 * exponential recursive fan-out must not hang/OOM the worker): one shared counter is charged per loop
 * pass AND per statement executed inside any loop OR subroutine, stopping the program at
 * `maxProgramIterations` (disclosed) — this bounds both a large loop body and the total call-tree size.
 * Subroutine recursion depth is separately bounded by `maxCallDepth`, and combined nesting + call-depth
 * JS recursion by `MAX_EXEC_DEPTH`; the engine's geometry limits still halt emission. There is no `eval`
 * and no I/O, so an adversarial program can waste only bounded CPU.
 *
 * We interpret a BLOCK TREE rather than a raw program-counter + jump table (both satisfy DD-017 D4's
 * "match each opener to its closer"): the tree makes `if`/`elseif`/`else` and nested loops correct by
 * construction, makes `break`/`continue` a local signal, and — critically — makes the bounded-execution
 * proof a single charge point. Semantics follow RS274NGC / LinuxCNC behaviour (no spec text copied).
 */
import { stripParenComments } from './rs274.js';

/** Warning codes surfaced to the IR by the flow interpreter (DD-017 §4.6). */
export const RS274_FLOW_WARN = {
  iterationLimit: 'rs274-iteration-limit',
  unbalancedOword: 'rs274-unbalanced-oword',
  unsupportedOword: 'rs274-unsupported-oword',
  controlNesting: 'rs274-control-nesting',
  misplacedControl: 'rs274-misplaced-control',
  streamingUnsupported: 'rs274-streaming-flow-unsupported',
  callDepth: 'rs274-call-depth', // subroutine recursion exceeded maxCallDepth (Phase 3)
  unknownSub: 'rs274-unknown-sub', // `call` of a subroutine that was never defined (Phase 3)
  duplicateSub: 'rs274-duplicate-sub' // a subroutine id defined more than once (first wins, Phase 3)
} as const;

/** Structural nesting cap (adversarial `o if`/`o if`/… stacks). Real programs nest < 10; 256 is
 *  unambiguously hostile and bounds the block BUILD's structural depth (per opener frame). */
const MAX_CONTROL_NESTING = 256;

/**
 * Runtime execution-recursion backstop (DD-017 Phase 3). With subroutines, JS `execBlock` recursion
 * grows with BOTH structural nesting AND `call` depth combined, so neither `MAX_CONTROL_NESTING` nor
 * `maxCallDepth` alone bounds the JS stack. This directly caps live `execBlock` nesting — real programs
 * stay well under 50; 512 is an unambiguously adversarial combination that halts (disclosed) rather than
 * risking a stack overflow escaping the parse.
 */
const MAX_EXEC_DEPTH = 512;

/** The recognized O-word keywords. An `o<id>` line with any OTHER trailing word is NOT a control line
 *  (e.g. a stray `o5 g1`) — it falls through to the normal lexer, so detection never hijacks plain code. */
export const KNOWN_OWORD_KEYWORDS: ReadonlySet<string> = new Set([
  'sub',
  'endsub',
  'call',
  'return',
  'if',
  'elseif',
  'else',
  'endif',
  'while',
  'endwhile',
  'do',
  'repeat',
  'endrepeat',
  'break',
  'continue'
]);

export type WarnFn = (code: string, message: string, srcByte?: number) => void;

/** A classified O-word control line: its keyword, its (opaque, normalized) id token, and any trailing
 *  expression (an `if`/`while` condition or a `repeat` count). */
export interface OwInfo {
  keyword: string;
  /** The id token verbatim-normalized: `100`, `<name>`, or a literal `[expr]` — matched, never evaluated. */
  id: string;
  expr: string;
}

/**
 * Classify one raw line as an O-word control line, or `null` when it is not one. `null` covers every
 * plain line (all FDM, all geometry/param lines) AND an `o<id>` whose trailing word is not a recognized
 * keyword (e.g. `o5 g1 x10`) — those fall through to the normal lexer, so classification never hijacks
 * ordinary code. The id is read as an opaque token (numeric / `<name>` / balanced `[expr]`) and is used
 * only to pair an opener with its closer — it is deliberately NOT evaluated here.
 */
export function classifyOWord(rawLine: string): OwInfo | null {
  let body = stripParenComments(rawLine);
  const semi = body.indexOf(';');
  if (semi !== -1) body = body.slice(0, semi);
  body = body.trim();
  if (body === '') return null;
  body = body.replace(/^n\d+\s*/i, ''); // an optional leading N line-number (LinuxCNC allows it)
  if (body[0] !== 'o' && body[0] !== 'O') return null;

  let i = 1;
  while (i < body.length && /\s/.test(body[i])) i++;
  let id: string;
  const c = body[i];
  if (c === '<') {
    const e = body.indexOf('>', i);
    if (e === -1) return null;
    id = body.slice(i, e + 1);
    i = e + 1;
  } else if (c === '[') {
    let depth = 0;
    let j = i;
    for (; j < body.length; j++) {
      if (body[j] === '[') depth++;
      else if (body[j] === ']') {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    if (depth !== 0) return null;
    id = body.slice(i, j);
    i = j;
  } else if (c >= '0' && c <= '9') {
    let j = i;
    while (j < body.length && /[0-9.]/.test(body[j])) j++;
    id = body.slice(i, j);
    i = j;
  } else {
    return null;
  }

  while (i < body.length && /\s/.test(body[i])) i++;
  let kw = '';
  while (i < body.length && /[a-zA-Z]/.test(body[i])) kw += body[i++];
  kw = kw.toLowerCase();
  if (!KNOWN_OWORD_KEYWORDS.has(kw)) return null;

  return { keyword: kw, id: id.trim().toLowerCase(), expr: body.slice(i).trim() };
}

/** One buffered source line with its byte offset (for `srcByte` on any geometry it emits). */
export interface FlowLine {
  text: string;
  offset: number;
}

/** The engine surface the interpreter drives — supplied by `createEngine` with its closures. */
export interface FlowHost {
  /** Execute one plain (non-control) source line through the normal engine path. */
  processLine(text: string, offset: number): void;
  /** True once a geometry limit (segments/buffer) has stopped emission — the interpreter then halts. */
  stopped(): boolean;
  /** Evaluate a control expression against the shared parameter store; `null` = malformed/non-finite. */
  evalExpression(text: string, srcByte: number): number | null;
  /** Push a subroutine call-frame scope with `args` bound to `#1`..`#30` (Phase 3). */
  pushScope(args: readonly number[]): void;
  /** Pop the current call-frame scope (Phase 3). */
  popScope(): void;
  warn: WarnFn;
  maxProgramIterations: number;
  /** Subroutine recursion depth cap (Phase 3); exceeding it discloses and skips the call. */
  maxCallDepth: number;
}

export interface FlowOutcome {
  /** True when execution was degraded (limit hit, unbalanced/unsupported O-word, malformed condition). */
  degraded: boolean;
}

// --- block tree ---------------------------------------------------------------------------------

type IfBranch = { expr: string | null; offset: number; body: Node[] };

type Node =
  | { t: 'line'; text: string; offset: number }
  | { t: 'if'; branches: IfBranch[] }
  | { t: 'loop'; kind: 'while' | 'do' | 'repeat'; expr: string; offset: number; body: Node[] }
  | { t: 'call'; id: string; args: string[]; offset: number } // Phase 3: invoke a subroutine by id
  | { t: 'return'; offset: number } // Phase 3: early-exit the current subroutine
  | { t: 'break'; offset: number }
  | { t: 'continue'; offset: number }
  | { t: 'noop' }; // an unsupported construct, already disclosed at build — a no-op at execution

/** A collected subroutine definition (Phase 3): its body runs only on `call`, never inline. */
interface SubDef {
  body: Node[];
  offset: number;
}

// --- build-time frames --------------------------------------------------------------------------

interface Frame {
  kind: 'root' | 'if' | 'while' | 'do' | 'repeat' | 'sub';
  id: string;
  offset: number;
  /** Body accumulator (for `if`, `branches` holds the bodies instead). */
  body: Node[];
  /** For `if`: the ordered branches; `body` points at the current branch's body. */
  branches?: IfBranch[];
  /** For a pre-tested `while` / `repeat`: the condition / count expression. */
  expr?: string;
}

/** True once the built tree used any recognized control construct (drives the capability). */
export function programUsesOWords(text: string): boolean {
  const len = text.length;
  let i = 0;
  while (i < len) {
    let nl = text.indexOf('\n', i);
    if (nl === -1) nl = len;
    if (lineStartsOWord(text, i, nl)) return true;
    i = nl + 1;
  }
  return false;
}

/** True when a single line is a recognized O-word control line (used by the streaming disclosure). */
export function isOWordControlLine(line: string): boolean {
  return lineStartsOWord(line, 0, line.length);
}

/**
 * Cheap gate: does `text[start,end)` begin (after leading `( )` comments, whitespace, and an optional
 * `N` line-number) with an `o<id>` whose trailing word is a recognized keyword? The peek costs a few
 * char comparisons for a normal FDM line (first non-space is `G`/`M`/`;`/digit → immediate reject, no
 * allocation); only a genuine `o…`-leading candidate is sliced and fully classified.
 */
function lineStartsOWord(s: string, start: number, end: number): boolean {
  let i = start;
  let sawN = false;
  // Whitespace `classifyOWord` would strip (via .trim()/`\s`): ASCII plus the common non-breaking space.
  const isWs = (c: string): boolean =>
    c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\v' || c === ' ';
  // Skip anything `classifyOWord` removes before the O-word — whitespace, `( )` comment groups, and one
  // optional `N` line-number — in ANY order, so the pre-filter is a strict SUPERSET of the classifier's
  // leading region (never a false negative: a missed O-word would be silent wrong geometry). A false
  // positive is harmless — `classifyOWord` below is the authority and rejects it.
  for (;;) {
    while (i < end && isWs(s[i])) i++;
    if (i < end && s[i] === '(') {
      let depth = 1;
      i++;
      while (i < end && depth > 0) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') depth--;
        i++;
      }
      continue;
    }
    if (!sawN && i + 1 < end && (s[i] === 'n' || s[i] === 'N') && s[i + 1] >= '0' && s[i + 1] <= '9') {
      i += 2;
      while (i < end && s[i] >= '0' && s[i] <= '9') i++;
      sawN = true;
      continue;
    }
    break;
  }
  if (i >= end || (s[i] !== 'o' && s[i] !== 'O')) return false;
  // A genuine `o…`-leading candidate — defer entirely to the authoritative classifier (which strips
  // comments globally and confirms a recognized keyword), so the two never diverge.
  return classifyOWord(s.slice(start, end)) !== null;
}

// --- interpreter --------------------------------------------------------------------------------

/** Internal control signals for `break` / `continue` — caught by the nearest enclosing loop. Carry the
 *  source offset so a misplaced (loop-less) `break`/`continue` can be disclosed with a location. */
class BreakSignal {
  constructor(readonly offset?: number) {}
}
class ContinueSignal {
  constructor(readonly offset?: number) {}
}
/** `return` control signal (Phase 3) — caught by the nearest enclosing subroutine `call`. */
class ReturnSignal {
  constructor(readonly offset?: number) {}
}

/** Split a `call`'s argument text into its top-level bracket expressions, e.g. `[1] [2+3] [#5]`.
 *  `malformed` is true when an unbalanced trailing `[` was found (and dropped) — the caller discloses it. */
function splitBracketArgs(s: string): { args: string[]; malformed: boolean } {
  const args: string[] = [];
  let i = 0;
  let malformed = false;
  while (i < s.length) {
    if (s[i] === '[') {
      let depth = 0;
      const start = i;
      for (; i < s.length; i++) {
        if (s[i] === '[') depth++;
        else if (s[i] === ']') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
      }
      if (depth !== 0) {
        malformed = true; // unbalanced trailing `[` — drop it, disclosed by the caller
        break;
      }
      args.push(s.slice(start, i));
    } else {
      i++;
    }
  }
  return { args, malformed };
}

/**
 * Interpret a fully-buffered O-word program. Builds the block tree (tolerant of unbalanced O-words —
 * disclosed, never thrown out), then executes it with bounded iteration. Returns whether execution was
 * degraded so the caller can tier the `parametricProgram` capability.
 */
export function interpretOWordProgram(lines: readonly FlowLine[], host: FlowHost): FlowOutcome {
  let degraded = false;
  const disclose = (code: string, message: string, offset?: number): void => {
    degraded = true;
    host.warn(code, message, offset);
  };

  // --- build the block tree -------------------------------------------------------------------
  const root: Frame = { kind: 'root', id: '', offset: 0, body: [] };
  // Subroutine definitions (Phase 3), collected during the build so a `call` can forward-reference a
  // `sub` defined later in the file. A sub body is captured here and executed only on `call`, never inline.
  const subs = new Map<string, SubDef>();
  const stack: Frame[] = [root];
  const top = (): Frame => stack[stack.length - 1];
  const pushChild = (n: Node): void => {
    top().body.push(n);
  };
  const controlDepth = (): number => stack.length - 1; // frames beyond root

  let buildOk = true;

  for (const line of lines) {
    if (!buildOk) break;
    const info = classifyOWord(line.text);
    if (info === null) {
      pushChild({ t: 'line', text: line.text, offset: line.offset });
      continue;
    }
    const { keyword, id, expr } = info;
    switch (keyword) {
      case 'if': {
        if (!openFrame({ kind: 'if', id, offset: line.offset, body: [], branches: [] })) break;
        const f = top();
        const branch: IfBranch = { expr, offset: line.offset, body: [] };
        f.branches!.push(branch);
        f.body = branch.body;
        break;
      }
      case 'elseif':
      case 'else': {
        const f = top();
        if (f.kind !== 'if') {
          disclose(RS274_FLOW_WARN.misplacedControl, `'o${id} ${keyword}' without an enclosing if`, line.offset);
          break;
        }
        const branches = f.branches!;
        if (branches.length > 0 && branches[branches.length - 1].expr === null) {
          // A branch already followed `else` — it can never run. Disclose and route its body to a
          // DETACHED sink (not one of `branches`) so the dead lines are dropped, not leaked into `else`.
          disclose(RS274_FLOW_WARN.misplacedControl, `'o${id} ${keyword}' after else is unreachable`, line.offset);
          f.body = [];
          break;
        }
        const branch: IfBranch = { expr: keyword === 'else' ? null : expr, offset: line.offset, body: [] };
        branches.push(branch);
        f.body = branch.body;
        break;
      }
      case 'endif': {
        closeFrame('if', 'endif', id, line.offset, (f) => ({ t: 'if', branches: f.branches! }));
        break;
      }
      case 'while': {
        // `while` closes a matching `do` (post-tested loop); otherwise it opens a pre-tested loop.
        if (top().kind === 'do' && idMatches(top().id, id)) {
          closeFrame('do', 'while', id, line.offset, (f) => ({
            t: 'loop',
            kind: 'do',
            expr,
            offset: f.offset,
            body: f.body
          }));
        } else {
          openFrame({ kind: 'while', id, offset: line.offset, body: [], expr });
        }
        break;
      }
      case 'endwhile': {
        closeFrame('while', 'endwhile', id, line.offset, (f) => ({
          t: 'loop',
          kind: 'while',
          expr: f.expr ?? '',
          offset: f.offset,
          body: f.body
        }));
        break;
      }
      case 'do': {
        openFrame({ kind: 'do', id, offset: line.offset, body: [] });
        break;
      }
      case 'repeat': {
        openFrame({ kind: 'repeat', id, offset: line.offset, body: [], expr });
        break;
      }
      case 'endrepeat': {
        closeFrame('repeat', 'endrepeat', id, line.offset, (f) => ({
          t: 'loop',
          kind: 'repeat',
          expr: f.expr ?? '',
          offset: f.offset,
          body: f.body
        }));
        break;
      }
      case 'sub': {
        // Phase 3: open a frame so the body is captured; it is stored (not inlined) at the matching
        // `endsub` and runs only on `call`. A sub definition must never execute where it is written.
        openFrame({ kind: 'sub', id, offset: line.offset, body: [] });
        break;
      }
      case 'endsub': {
        const f = top();
        if (f.kind !== 'sub') {
          disclose(RS274_FLOW_WARN.unbalancedOword, `'o${id} endsub' without a matching sub`, line.offset);
          break;
        }
        if (!idMatches(f.id, id)) {
          disclose(RS274_FLOW_WARN.unbalancedOword, `'o${id} endsub' does not match 'o${f.id} sub'`, line.offset);
        }
        stack.pop();
        if (subs.has(f.id)) {
          disclose(RS274_FLOW_WARN.duplicateSub, `subroutine 'o${f.id}' redefined; keeping the first`, f.offset);
        } else {
          subs.set(f.id, { body: f.body, offset: f.offset });
        }
        break;
      }
      case 'call': {
        const { args, malformed } = splitBracketArgs(expr);
        if (malformed) {
          disclose(
            RS274_FLOW_WARN.unsupportedOword,
            `'o${id} call' has a malformed argument; it was dropped`,
            line.offset
          );
        }
        pushChild({ t: 'call', id, args, offset: line.offset });
        break;
      }
      case 'return': {
        pushChild({ t: 'return', offset: line.offset });
        break;
      }
      case 'break': {
        pushChild({ t: 'break', offset: line.offset });
        break;
      }
      case 'continue': {
        pushChild({ t: 'continue', offset: line.offset });
        break;
      }
      default: {
        disclose(RS274_FLOW_WARN.unsupportedOword, `unsupported O-word '${keyword}'; ignored`, line.offset);
        pushChild({ t: 'noop' });
      }
    }
  }

  // Any frames still open at EOF are unterminated (missing `endif`/`endwhile`/…). Disclose each and drop
  // it (its captured body is undefined-in-extent, so executing it would be a guess) — root siblings that
  // closed cleanly still run.
  while (stack.length > 1) {
    const f = stack.pop()!;
    disclose(RS274_FLOW_WARN.unbalancedOword, `unterminated 'o${f.id} ${f.kind}' (missing its end)`, f.offset);
  }

  /** Push a new control frame, enforcing the nesting cap. Returns false if the cap aborted the build. */
  function openFrame(f: Frame): boolean {
    if (controlDepth() + 1 > MAX_CONTROL_NESTING) {
      disclose(
        RS274_FLOW_WARN.controlNesting,
        `control nesting exceeds ${MAX_CONTROL_NESTING}; program not executed`,
        f.offset
      );
      buildOk = false;
      return false;
    }
    stack.push(f);
    return true;
  }

  /** Close the top frame, verifying it matches the expected opener kind + id, and append its node. */
  function closeFrame(
    expectKind: Frame['kind'],
    closer: string,
    id: string,
    offset: number,
    make: (f: Frame) => Node
  ): void {
    const f = top();
    if (f.kind !== expectKind) {
      disclose(RS274_FLOW_WARN.unbalancedOword, `'o${id} ${closer}' without a matching opener`, offset);
      return;
    }
    if (!idMatches(f.id, id)) {
      // Structurally it closes the top frame; the id label just disagrees — close it but disclose.
      disclose(RS274_FLOW_WARN.unbalancedOword, `'o${id} ${closer}' does not match 'o${f.id}'`, offset);
    }
    stack.pop();
    top().body.push(make(f));
  }

  if (!buildOk) return { degraded: true }; // nesting cap tripped — nothing executed (adversarial input)

  // --- execute the tree -----------------------------------------------------------------------
  let iterations = 0;
  let halted = false; // set by the iteration cap or a geometry stop; unwinds cleanly
  let iterationWarned = false;
  let loopDepth = 0; // > 0 anywhere inside a loop (stays elevated across calls) — gates the charge
  let frameLoopDepth = 0; // loops in the CURRENT call frame (reset per call) — gates break/continue locality
  let callDepth = 0; // active subroutine call frames (Phase 3) — bounded by host.maxCallDepth
  let execDepth = 0; // live execBlock recursion — bounded by MAX_EXEC_DEPTH (JS-stack backstop)
  let execDepthWarned = false;

  /**
   * Charge ONE unit of loop work against the shared budget; returns false (and halts) when exhausted.
   * Charged both per loop-body *pass* (so an empty-bodied `o while [1]` is bounded) AND per statement
   * *inside* a loop body (so a loop with a huge body cannot multiply the real work past the limit —
   * the bound is total loop work, `maxProgramIterations`, independent of body size). Root-level (non-loop)
   * statements are bounded by input size and are not charged, so a large straight-line program is not
   * truncated.
   */
  const charge = (offset?: number): boolean => {
    if (++iterations > host.maxProgramIterations) {
      if (!iterationWarned) {
        iterationWarned = true;
        disclose(
          RS274_FLOW_WARN.iterationLimit,
          `program iteration limit ${host.maxProgramIterations} reached; execution stopped`,
          offset
        );
      }
      halted = true;
      return false;
    }
    return true;
  };

  const truthy = (expr: string, offset: number): boolean => {
    const v = host.evalExpression(expr, offset);
    if (v === null) {
      degraded = true; // malformed/non-finite condition — already disclosed by evalExpression
      return false;
    }
    return v !== 0;
  };

  const execBlock = (nodes: readonly Node[]): void => {
    // Runtime recursion backstop (Phase 3): structural nesting + call depth combine here, so cap live
    // execBlock depth directly to keep the JS stack safe regardless of how they multiply.
    if (execDepth >= MAX_EXEC_DEPTH) {
      if (!execDepthWarned) {
        execDepthWarned = true;
        disclose(RS274_FLOW_WARN.controlNesting, `execution nesting exceeded ${MAX_EXEC_DEPTH}; program stopped`);
      }
      halted = true;
      return;
    }
    execDepth++;
    try {
      for (const n of nodes) {
        if (halted || host.stopped()) {
          halted = true;
          return;
        }
        // Charge every executed statement inside a loop OR a subroutine. Loops bound `bodySize ×
        // iterations`; subroutines bound the CALL-TREE SIZE — each `call` node is itself charged once
        // callDepth > 0, so a loop-free fan-out (`o100 sub` calling `o100` twice) that maxCallDepth
        // bounds only in DEPTH is bounded in total work here. Root-level statements (both depths 0) run
        // once and stay bounded by input size, so a large straight-line program is not truncated.
        if ((loopDepth > 0 || callDepth > 0) && n.t !== 'if' && n.t !== 'loop') {
          if (!charge(n.t === 'line' || n.t === 'call' ? n.offset : undefined)) return;
        }
        switch (n.t) {
          case 'line':
            host.processLine(n.text, n.offset);
            break;
          case 'noop':
            break;
          case 'break':
          case 'continue':
            // Valid only inside a loop IN THE CURRENT frame. Outside one (top level, or a sub with no
            // loop of its own) it is a disclosed no-op — never a cross-frame jump, never a program abort.
            if (frameLoopDepth === 0) {
              disclose(RS274_FLOW_WARN.misplacedControl, `'${n.t}' outside a loop; ignored`, n.offset);
            } else if (n.t === 'break') {
              throw new BreakSignal(n.offset);
            } else {
              throw new ContinueSignal(n.offset);
            }
            break;
          case 'return':
            // Valid only inside a subroutine. Outside one it is a disclosed no-op, not a program abort.
            if (callDepth === 0) {
              disclose(RS274_FLOW_WARN.misplacedControl, 'return outside a subroutine; ignored', n.offset);
            } else {
              throw new ReturnSignal(n.offset);
            }
            break;
          case 'call':
            execCall(n);
            break;
          case 'if': {
            for (const br of n.branches) {
              if (br.expr === null || truthy(br.expr, br.offset)) {
                execBlock(br.body);
                break;
              }
            }
            break;
          }
          case 'loop':
            execLoop(n);
            break;
        }
      }
    } finally {
      execDepth--;
    }
  };

  /** Invoke a subroutine (Phase 3): bind args → a fresh scope, run its body, honor `return`, bound depth. */
  const execCall = (n: { id: string; args: string[]; offset: number }): void => {
    const sub = subs.get(n.id);
    if (sub === undefined) {
      disclose(RS274_FLOW_WARN.unknownSub, `call of undefined subroutine 'o${n.id}'; ignored`, n.offset);
      return;
    }
    if (callDepth >= host.maxCallDepth) {
      disclose(RS274_FLOW_WARN.callDepth, `subroutine recursion exceeded maxCallDepth ${host.maxCallDepth}`, n.offset);
      return;
    }
    // Args evaluate in the CALLER's scope, then bind to `#1`..`#30` in the fresh callee scope.
    const args = n.args.map((a) => {
      const v = host.evalExpression(a, n.offset);
      if (v === null) degraded = true; // malformed arg — disclosed by evalExpression; passes 0
      return v ?? 0;
    });
    host.pushScope(args);
    callDepth++;
    // A subroutine's break/continue see only loops WITHIN the sub — reset frame-loop depth for the body
    // (but NOT `loopDepth`, which stays elevated so a sub called inside a loop still charges its work).
    const savedFrameLoopDepth = frameLoopDepth;
    frameLoopDepth = 0;
    try {
      execBlock(sub.body);
    } catch (e) {
      if (!(e instanceof ReturnSignal)) throw e; // `return` = normal early exit; anything else propagates
    } finally {
      frameLoopDepth = savedFrameLoopDepth;
      callDepth--;
      host.popScope();
    }
  };

  const execLoop = (n: { kind: 'while' | 'do' | 'repeat'; expr: string; offset: number; body: Node[] }): void => {
    loopDepth++; // gate the per-statement charge in execBlock for this loop's body
    frameLoopDepth++; // this loop can catch a break/continue in the current call frame
    try {
      if (n.kind === 'repeat') {
        const cv = host.evalExpression(n.expr, n.offset);
        if (cv === null) {
          degraded = true;
          return;
        }
        const count = Math.floor(cv);
        for (let k = 0; k < count; k++) {
          if (halted || host.stopped()) {
            halted = true;
            return;
          }
          if (!charge(n.offset)) return;
          try {
            execBlock(n.body);
          } catch (e) {
            if (e instanceof BreakSignal) return;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      }
      if (n.kind === 'while') {
        while (!halted && !host.stopped() && truthy(n.expr, n.offset)) {
          if (!charge(n.offset)) return;
          try {
            execBlock(n.body);
          } catch (e) {
            if (e instanceof BreakSignal) return;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      }
      // post-tested `do … while [cond]` — the body runs at least once, then the condition is tested.
      do {
        if (halted || host.stopped()) {
          halted = true;
          return;
        }
        if (!charge(n.offset)) return;
        try {
          execBlock(n.body);
        } catch (e) {
          if (e instanceof BreakSignal) return;
          if (e instanceof ContinueSignal) continue; // fall through to the condition test
          throw e;
        }
      } while (!halted && !host.stopped() && truthy(n.expr, n.offset));
    } finally {
      loopDepth--;
      frameLoopDepth--;
    }
  };

  try {
    execBlock(root.body);
  } catch (e) {
    if (e instanceof BreakSignal || e instanceof ContinueSignal) {
      disclose(RS274_FLOW_WARN.misplacedControl, 'break/continue outside a loop; ignored', e.offset);
    } else if (e instanceof ReturnSignal) {
      disclose(RS274_FLOW_WARN.misplacedControl, 'return outside a subroutine; ignored', e.offset);
    } else {
      throw e;
    }
  }

  // A geometry limit (maxSegments/maxBufferBytes) that halted interpretation mid-program is a degraded
  // run — the parametric program did not fully execute (Finding 4a). Global `complete=false` also covers
  // it, but the per-capability tier should not claim a clean `known`.
  if (host.stopped()) degraded = true;

  return { degraded };
}

/** O-word ids match on their normalized token (numeric, `<name>`, or a literal `[expr]` text). */
function idMatches(a: string, b: string): boolean {
  return a === b;
}
