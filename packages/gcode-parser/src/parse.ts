/**
 * Pure G-code parse core (DD-003 §14 phase 1, issue #44; async driver added in phase 2, #45).
 *
 * Ports the inherited xyz-tools interpreter semantics — motion handling (G0/G1),
 * arc flattening (G2/G3 incl. R-mode and full circles), units (G20/G21), homing
 * (G28), tool selection (T0–T7), travel/extrusion path splitting, and the
 * layer-indexing rules (0.05 tolerance, non-planar clearing) — but writes the
 * DD-001 `ToolpathIR` SoA buffers **directly** through a budget-aware growable
 * writer, with **real** per-segment `srcByte`, extrusion deltas, and modal
 * feed rate (the #29 adapter had to report those `unavailable`).
 *
 * Provenance: machine-state semantics adapted from the inherited MIT source
 * (`src/interpreter.ts`, `src/gcode-parser.ts`, `src/indexers.ts` @ the founding
 * baseline) — recorded in docs/UPSTREAM_PROVENANCE.md. Deliberate quirk-for-quirk
 * fidelity (e.g. truthy `x || state.x` in arcs, tool captured at path start) is
 * required by the golden-equivalence gate; do not "fix" behavior here without a
 * reviewed golden regeneration.
 *
 * Two drivers share one engine:
 * - `parseGcodeToIR` — synchronous (tests, Node tooling).
 * - `parseGcodeToIRAsync` — the DD-003 §5.2 cooperative driver: processes at most
 *   `yieldIntervalMs` of CPU work between explicit MessageChannel macrotask yields
 *   so a queued worker `cancel` message can actually be dispatched; reports
 *   progress and honors a cancellation hook.
 *
 * Byte offsets assume single-byte (ASCII/UTF-8) G-code, which holds for slicer
 * output; multi-byte comment bytes would skew offsets and are a documented
 * limitation until the streaming decoder lands (phase 3).
 */
import {
  IR_SCHEMA_VERSION,
  MoveKind,
  buildSourceIndex,
  computeSegmentBounds,
  type Confidence,
  type ToolInfo,
  type ToolpathIR,
  type ToolpathLayer,
  type Units,
  type Warning
} from '@chestnutlabs/toolpath-core';
import { BudgetExceededError, SegmentWriter } from './growable.js';

export interface ParseLimits {
  maxInputBytes: number;
  maxSegments: number;
  maxBufferBytes: number;
  maxLineLength: number;
  maxWarnings: number;
}

export const DEFAULT_LIMITS: ParseLimits = {
  maxInputBytes: 512 * 1024 * 1024,
  maxSegments: 20_000_000,
  maxBufferBytes: 1536 * 1024 * 1024,
  maxLineLength: 64 * 1024,
  maxWarnings: 10_000
};

/**
 * Read-only normalized command event (DD-005 §4.3, amendment 1): observers see
 * each lexed command BEFORE dispatch and cannot alter parsing.
 */
export interface CommandEvent {
  /** Normalized lowercase word+number, e.g. 'm486'. */
  gcode: string;
  params: Readonly<Record<string, number>>;
  /** The raw line, for vendor syntaxes the lexer's params don't capture. */
  rawLine: string;
  srcByte: number;
  /** Segment count at event time — maps events to segment ranges. */
  segIndex: number;
}

export interface ParseOptions {
  parserVersion?: string;
  sourceId?: string;
  limits?: Partial<ParseLimits>;
  /** Layer-detection tolerance (inherited default 0.05). */
  minLayerThreshold?: number;
  /**
   * Firmware hint (DD-010 D2): does `G90`/`G91` also set the *extruder* mode? Marlin/Klipper —
   * `true`; RepRapFirmware treats E independently — `false`. Default `false` (RRF/unknown-conservative).
   * Only consulted while no `M82`/`M83` has latched the E-mode; supplied by the dialect layer / caller
   * that has confidently classified the firmware. The byte-exact engine never sniffs firmware itself.
   */
  extruderFollowsPositioning?: boolean;
  /**
   * DD-005 §4.3 read-only hooks: observe comments/commands during the parse.
   * Inert when unset (one branch per line); they cannot alter lexing, dispatch,
   * or machine state — the golden-gated semantics are untouched.
   */
  onComment?: (text: string, srcByte: number) => void;
  onCommand?: (event: CommandEvent) => void;
}

export interface StopReason {
  code: 'E_LIMIT_INPUT_BYTES' | 'E_LIMIT_SEGMENTS' | 'E_LIMIT_BUFFER_BYTES';
  message: string;
  srcByte?: number;
}

export interface ParseStats {
  bytes: number;
  lines: number;
  commands: number;
  segments: number;
  points: number;
  retractions: number;
  deretractions: number;
  feedrateChanges: number;
  others: number;
  extrusionDistance: number;
  warningsByCode: Record<string, number>;
  stopReason?: StopReason;
}

export interface ParseResult {
  ir: ToolpathIR;
  stats: ParseStats;
  /** Dialect/machine metadata (DD-005 §4.2) — populated by the worker pipeline
   *  when dialect adapters are registered and matched; absent otherwise. */
  metadata?: import('@chestnutlabs/toolpath-core').DialectMetadata;
}

export interface AsyncParseHooks {
  /** Called after each cooperative yield with bytes processed so far. */
  onProgress?: (bytesProcessed: number, totalBytes: number, segments: number) => void;
  /** Checked after each yield; returning true stops the parse with a partial result. */
  shouldCancel?: () => boolean;
  /** Max CPU ms between yields (DD-003 §5.2 default 50). */
  yieldIntervalMs?: number;
  /**
   * Progressive preview (DD-004 §5.4, issue #60): receives path-aligned delta
   * snapshots of the IR built so far. Emission starts once bytesProcessed ≥
   * `partialMinBytes` and repeats at most every `partialIntervalMs`.
   */
  onPartial?: (slice: ToolpathIR, cumulativeSegments: number) => void;
  /** Bytes processed before the first partial may be emitted (default 0 when onPartial set). */
  partialMinBytes?: number;
  /** Minimum ms between partial snapshots (default 1000). */
  partialIntervalMs?: number;
  /**
   * DD-005 §4.5 stream detection windows: when set, the STREAMING driver fills
   * `head` with the first ≤64 KB of decoded text and keeps `tail` as a bounded
   * rolling window (last ≤16 KB) — read after the parse for late dialect
   * detection on non-seekable streams. In-memory drivers ignore this (their
   * windows are sliceable up front).
   */
  captureWindows?: { head: string; tail: string };
}

export interface AsyncParseResult extends ParseResult {
  cancelled: boolean;
}

const LAYER_TOLERANCE = 0.05;
const UNRESOLVED_LAYER = 0xffffffff;

interface Cmd {
  gcode: string;
  params: Record<string, number>;
}

const SPLIT_LETTERS = /([a-zA-Z])/g;

/** Port of the inherited lexer: trim, comment split on ';', letter/value pairs. */
function lexLine(line: string): Cmd {
  const input = line.trim();
  const cmd = input.split(';')[0];
  const parts = cmd
    .split(SPLIT_LETTERS)
    .slice(1)
    .map((s) => s.trim());
  const gcode = !parts.length ? '' : `${parts[0]?.toLowerCase()}${Number(parts[1])}`;
  // Faithful replication of the inherited parseParams reduce (odd indices are values):
  const params: Record<string, number> = {};
  const rest = parts.slice(2);
  for (let idx = 0; idx < rest.length; idx++) {
    if (idx % 2 === 0) continue;
    const key = rest[idx - 1].toLowerCase();
    const code = key.charCodeAt(0);
    if ((code >= 97 && code <= 122) || (code >= 65 && code <= 90)) {
      params[key] = parseFloat(rest[idx]);
    }
  }
  return { gcode, params };
}

interface PathState {
  type: 'extrusion' | 'travel';
  tool: number;
  segStart: number;
  startZ: number;
  /** True when any CONSECUTIVE vertex pair's z delta exceeds the tolerance —
   *  the inherited non-planar check is per-step, so vase-mode's tiny continuous
   *  z rise does NOT trigger it. */
  nonPlanar: boolean;
  pointCount: number;
}

interface LayerRec {
  z: number;
  height: number;
  segStart: number;
  segEnd: number;
}

/** Internal engine surface shared by the sync, async, and streaming drivers. Not public API. */
export interface Engine {
  text: string;
  limits: ParseLimits;
  processLine(rawLine: string, offset: number): void;
  stopped(): boolean;
  markInputTooBig(): void;
  /** Streaming driver: record the true source byte count as it becomes known. */
  setSourceBytes(bytes: number): void;
  /**
   * Progressive-preview delta (issue #60): copy segments [fromSeg, cut) where
   * `cut` is the current path boundary — every included segment has a resolved
   * layer. Returns null when nothing new is ready or the copy would break the
   * §7.2 buffer budget (snapshots are skippable; the parse never is).
   */
  snapshot(fromSeg: number): { slice: ToolpathIR; upTo: number } | null;
  finish(cancelledAtByte?: number): ParseResult;
}

/** Internal: build an engine over decoded text (streaming passes '' and feeds lines itself). */
export function createEngine(input: string | Uint8Array, opts: ParseOptions): Engine {
  const limits: ParseLimits = { ...DEFAULT_LIMITS, ...opts.limits };
  const tolerance = opts.minLayerThreshold ?? LAYER_TOLERANCE;
  const text = typeof input === 'string' ? input : new TextDecoder().decode(input);
  let byteLength = typeof input === 'string' ? text.length : input.byteLength;

  const warnings = new Map<string, Warning>();
  const stats: ParseStats = {
    bytes: byteLength,
    lines: 0,
    commands: 0,
    segments: 0,
    points: 0,
    retractions: 0,
    deretractions: 0,
    feedrateChanges: 0,
    others: 0,
    extrusionDistance: 0,
    warningsByCode: {}
  };
  const warn = (code: string, message: string, srcByte?: number): void => {
    stats.warningsByCode[code] = (stats.warningsByCode[code] ?? 0) + 1;
    const existing = warnings.get(code);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
    } else if (warnings.size < limits.maxWarnings) {
      warnings.set(code, { code, message, severity: 'warn', srcByte, count: 1 });
    }
  };

  const writer = new SegmentWriter(limits.maxBufferBytes);

  // Machine state (port of State.initial + Interpreter fields).
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let tool = 0;
  let units: Units = 'mm';
  let unitsSeen = false;
  let modalFeed = NaN;

  // Motion-model modal state (DD-010 E10 phase 1). `xyzAbsolute` (G90/G91) and the extruder mode
  // resolve the effective per-move E delta and the extrude/travel classification. Defaults are the
  // firmware power-on convention: absolute XYZ, absolute E. `eModeExplicit` is set only by M82/M83;
  // `lastE` is the running absolute-E datum (also reset by `G92 E`).
  let xyzAbsolute = true;
  let positioningSeen = false; // any G90/G91 observed → positioningMode 'known'
  let eModeExplicit: 'absolute' | 'relative' | null = null; // M82/M83; null = infer
  let lastE = 0;
  const extruderFollowsPositioning = opts.extruderFollowsPositioning === true;

  /**
   * Effective per-move E delta from the modal extruder mode (DD-010 D1/D2 precedence:
   * explicit M82/M83 → firmware-conditioned G90/G91 → absolute default). Updates `lastE`.
   * For relative E the delta is the raw word (byte-identical to the pre-E10 engine for the
   * M83 corpus); for absolute E it is `eParam − lastE`.
   */
  const resolveEDelta = (eParam: number | undefined): number => {
    if (eParam === undefined) return 0;
    const absolute =
      eModeExplicit !== null ? eModeExplicit === 'absolute' : extruderFollowsPositioning ? xyzAbsolute : true; // firmware-neutral default: absolute, disclosed 'inferred'
    const delta = absolute ? eParam - lastE : eParam;
    lastE = absolute ? eParam : lastE + eParam;
    return delta;
  };

  /** Absolute target for one axis given the modal positioning mode (G90/G91). */
  const nextAxis = (cur: number, word: number | undefined): number => (xyzAbsolute ? (word ?? cur) : cur + (word ?? 0));

  // Floating origin (DD-001 §4.6): fixed at the first emitted segment's start.
  let originSet = false;
  let ox = 0;
  let oy = 0;
  let oz = 0;

  // Path + layer tracking (port of Job/LayersIndexer semantics).
  let path: PathState | null = null;
  let prevX = 0;
  let prevY = 0;
  let prevZ = 0;
  const layers: LayerRec[] = [];
  let layersActive = true;
  let layersCleared = false;
  let carryLayer = 0;
  let unindexedPaths = 0;
  const toolsSeen = new Set<number>();

  let stopReason: StopReason | undefined;
  let truncatedAtByte: number | undefined;
  let currentSrcByte = 0;

  // Retraction/unretraction events (DD-009 D1, #148): E-only moves emit no segment,
  // so their position is captured here in ABSOLUTE coords and rebased to the origin
  // at IR assembly (mirroring segment positions). Physical convention: E<0 pulls
  // filament back = 'retract'; E>0 (no XYZ) pushes it out = 'unretract'.
  const retractionEvents: {
    x: number;
    y: number;
    z: number;
    kind: 'retract' | 'unretract';
    srcByte: number;
    segIndex: number;
  }[] = [];

  // M600 filament-swap color-change boundaries (DD-009 D2 amendment, #147): a marker
  // with a position but no motion segment, captured here in ABSOLUTE coords and rebased
  // to the origin at IR assembly (like retractions). Detected in the parser — M600 is
  // firmware-universal — so a bare M600 is honored even with no dialect detected.
  const colorChangeEvents: {
    x: number;
    y: number;
    z: number;
    segIndex: number;
    srcByte: number;
    tool: number;
  }[] = [];

  const emitSegment = (x: number, y: number, z: number, eDelta: number, kind: number): boolean => {
    if (writer.count >= limits.maxSegments) {
      stopReason = {
        code: 'E_LIMIT_SEGMENTS',
        message: `segment limit ${limits.maxSegments} reached`,
        srcByte: currentSrcByte
      };
      return false;
    }
    if (!originSet) {
      originSet = true;
      ox = prevX;
      oy = prevY;
      oz = prevZ;
    }
    try {
      writer.push({
        x0: prevX - ox,
        y0: prevY - oy,
        z0: prevZ - oz,
        x1: x - ox,
        y1: y - oy,
        z1: z - oz,
        e: eDelta,
        feedrate: modalFeed,
        kind,
        tool: path?.tool ?? tool,
        layer: UNRESOLVED_LAYER,
        srcByte: currentSrcByte
      });
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        stopReason = { code: 'E_LIMIT_BUFFER_BYTES', message: err.message, srcByte: currentSrcByte };
        return false;
      }
      if (err instanceof RangeError) {
        // Engine-level allocation failure (§7.2 amendment): mapped to the same
        // structured bounded result, never an unhandled exception or dead worker.
        stopReason = {
          code: 'E_LIMIT_BUFFER_BYTES',
          message: `platform allocation failure: ${err.message}`,
          srcByte: currentSrcByte
        };
        return false;
      }
      throw err;
    }
    if (path && Math.abs(z - prevZ) > tolerance) {
      path.nonPlanar = true;
    }
    prevX = x;
    prevY = y;
    prevZ = z;
    if (path) {
      path.pointCount++;
    }
    return true;
  };

  /** Port of Job.finishPath + Job.indexPath (LayersIndexer.sortIn) + adapter carry-forward. */
  const finishPath = (): void => {
    if (path === null) return;
    const segEnd = writer.count - 1;
    if (segEnd < path.segStart) {
      path = null;
      return;
    }
    let resolved: number | undefined;
    if (layersActive) {
      // Non-planar check: extrusion path with a consecutive z step beyond tolerance.
      if (path.type === 'extrusion' && path.nonPlanar) {
        // NonPlanarExtrusionError semantics: clear the layer index entirely.
        layers.length = 0;
        layersActive = false;
        layersCleared = true;
        warn('layers-cleared-non-planar', 'Non-planar extrusion detected; layer index cleared.', currentSrcByte);
      } else {
        if (path.type === 'extrusion') {
          const newZ = path.startZ;
          const last = layers[layers.length - 1];
          if (!last || newZ - last.z > tolerance) {
            const lastZ = last?.z || 0;
            layers.push({ z: newZ, height: newZ - lastZ, segStart: path.segStart, segEnd });
          }
        }
        const last = layers[layers.length - 1];
        if (last) {
          resolved = layers.length - 1;
          if (segEnd > last.segEnd) last.segEnd = segEnd;
          if (path.segStart < last.segStart) last.segStart = path.segStart;
        }
      }
    }
    if (resolved !== undefined) {
      carryLayer = resolved;
    } else {
      unindexedPaths++;
    }
    writer.setLayerRange(path.segStart, segEnd, resolved ?? carryLayer);
    toolsSeen.add(path.tool);
    path = null;
  };

  const breakPath = (type: 'extrusion' | 'travel'): void => {
    finishPath();
    path = {
      type,
      tool,
      segStart: writer.count,
      startZ: sz,
      nonPlanar: false,
      pointCount: 1
    };
    // breakPath adds the current position as the path's starting vertex.
    prevX = sx;
    prevY = sy;
    prevZ = sz;
  };

  const g0 = (p: Record<string, number>): boolean => {
    const { x, y, z, e, f } = p;
    // Classify on the true per-move delta, not the raw E word (DD-010 D1). For the M83/relative
    // corpus the delta equals the word, so output is byte-identical to the pre-E10 engine.
    const eDelta = resolveEDelta(e);
    if (x === undefined && y === undefined && z === undefined) {
      if (eDelta > 0) stats.retractions++;
      else if (eDelta < 0) stats.deretractions++;
      else if (f !== undefined) stats.feedrateChanges++;
      if (e !== undefined && eDelta !== 0) {
        retractionEvents.push({
          x: sx,
          y: sy,
          z: sz,
          kind: eDelta < 0 ? 'retract' : 'unretract',
          srcByte: currentSrcByte,
          segIndex: writer.count
        });
      } else stats.others++;
      if (f !== undefined) modalFeed = f;
      return true;
    }
    stats.points++;
    if (f !== undefined) modalFeed = f;
    const pathType = eDelta > 0 ? 'extrusion' : 'travel';
    if (path === null || path.type !== pathType) {
      breakPath(pathType);
    }
    if (eDelta > 0) stats.extrusionDistance += eDelta;
    sx = nextAxis(sx, x);
    sy = nextAxis(sy, y);
    sz = nextAxis(sz, z);
    return emitSegment(sx, sy, sz, eDelta, pathType === 'extrusion' ? MoveKind.Extrude : MoveKind.Travel);
  };

  const g2 = (p: Record<string, number>, cw: boolean): boolean => {
    const { x, y, z, e, f } = p;
    let { i, j, r } = p;
    if (f !== undefined) modalFeed = f;
    // E is delta-based (DD-010 D1) so M82 arcs classify correctly and `lastE` stays consistent with
    // g0; the arc XYZ geometry stays absolute here (G91-arc handling lands with the arc-plane rewrite,
    // phase 2). Relative-E → delta === word → the XY-arc corpus is byte-identical.
    const eDelta = resolveEDelta(e);
    const pathType = eDelta ? 'extrusion' : 'travel';
    if (path === null || path.type !== pathType) {
      breakPath(pathType);
    }
    if (eDelta > 0) stats.extrusionDistance += eDelta;

    if (r) {
      const deltaX = x - sx; // assume abs mode (inherited)
      const deltaY = y - sy;
      const minR = Math.sqrt(Math.pow(deltaX / 2, 2) + Math.pow(deltaY / 2, 2));
      r = Math.max(r, minR);
      const dSquared = Math.pow(deltaX, 2) + Math.pow(deltaY, 2);
      const hSquared = Math.pow(r, 2) - dSquared / 4;
      let hDivD = Math.sqrt(hSquared / dSquared);
      if ((cw && r < 0.0) || (!cw && r > 0.0)) hDivD = -hDivD;
      i = deltaX / 2 + deltaY * hDivD;
      j = deltaY / 2 - deltaX * hDivD;
    }

    const wholeCircle = sx == x && sy == y;
    const centerX = sx + i;
    const centerY = sy + j;
    const arcRadius = Math.sqrt(i * i + j * j);
    const arcCurrentAngle = Math.atan2(-j, -i);
    const finalTheta = Math.atan2(y - centerY, x - centerX);

    let totalArc;
    if (wholeCircle) {
      totalArc = 2 * Math.PI;
    } else {
      totalArc = cw ? arcCurrentAngle - finalTheta : finalTheta - arcCurrentAngle;
      if (totalArc < 0.0) totalArc += 2 * Math.PI;
    }
    let totalSegments = (arcRadius * totalArc) / 0.5;
    if (units == 'in') totalSegments *= 25;
    if (totalSegments < 1) totalSegments = 1;
    let arcAngleIncrement = totalArc / totalSegments;
    arcAngleIncrement *= cw ? -1 : 1;

    const zDist = sz - (z || sz);
    const zStep = zDist / totalSegments;

    const kind = (pathType === 'extrusion' ? MoveKind.Extrude : MoveKind.Travel) | MoveKind.ArcSegment;
    const eachE = e !== undefined ? eDelta / Math.max(1, Math.ceil(totalSegments)) : 0;

    let px;
    let py;
    let pz = sz;
    let currentAngle = arcCurrentAngle;
    for (let moveIdx = 0; moveIdx < totalSegments - 1; moveIdx++) {
      currentAngle += arcAngleIncrement;
      px = centerX + arcRadius * Math.cos(currentAngle);
      py = centerY + arcRadius * Math.sin(currentAngle);
      pz += zStep;
      if (!emitSegment(px, py, pz, eachE, kind)) return false;
    }
    sx = x || sx;
    sy = y || sy;
    sz = z || sz;
    return emitSegment(sx, sy, sz, eachE, kind);
  };

  const onComment = opts.onComment;
  const onCommand = opts.onCommand;

  const processLine = (rawLine: string, offset: number): void => {
    stats.lines++;
    currentSrcByte = offset;

    if (rawLine.length > limits.maxLineLength) {
      warn('line-too-long', `line exceeds maxLineLength=${limits.maxLineLength}; skipped`, offset);
      return;
    }
    // DD-005 §4.3 read-only observation points — no effect on lexing or state.
    if (onComment !== undefined) {
      const ci = rawLine.indexOf(';');
      if (ci !== -1) onComment(rawLine.slice(ci + 1), offset);
    }
    const cmd = lexLine(rawLine);
    if (cmd.gcode === '') return;
    stats.commands++;
    if (onCommand !== undefined) {
      onCommand({ gcode: cmd.gcode, params: cmd.params, rawLine, srcByte: offset, segIndex: writer.count });
    }
    let ok = true;
    switch (cmd.gcode) {
      case 'g0':
      case 'g1':
        ok = g0(cmd.params);
        break;
      case 'g2':
        ok = g2(cmd.params, true);
        break;
      case 'g3':
        ok = g2(cmd.params, false);
        break;
      case 'g20':
        units = 'in';
        unitsSeen = true;
        break;
      case 'g21':
        units = 'mm';
        unitsSeen = true;
        break;
      case 'g28':
        sx = 0;
        sy = 0;
        sz = 0;
        break;
      case 't0':
      case 't1':
      case 't2':
      case 't3':
      case 't4':
      case 't5':
      case 't6':
      case 't7':
        tool = Number(cmd.gcode.slice(1));
        break;
      case 'm600':
        // Manual filament swap = color boundary (#147). A marker, not motion — do
        // NOT break/finish the current path; record position (current head), the
        // next segment index (slot boundary), and the active tool for provenance.
        colorChangeEvents.push({ x: sx, y: sy, z: sz, segIndex: writer.count, srcByte: offset, tool });
        break;
      // Motion-model modal commands (DD-010 E10 phase 1).
      case 'g90':
        xyzAbsolute = true;
        positioningSeen = true;
        break;
      case 'g91':
        xyzAbsolute = false;
        positioningSeen = true;
        break;
      case 'm82':
        eModeExplicit = 'absolute';
        break;
      case 'm83':
        eModeExplicit = 'relative';
        break;
      case 'g92':
        // Datum reset: `G92 E<v>` rebases the absolute-E origin so the next delta is sane (this is
        // the E-half of D4, needed in phase 1 because slicer M82 files pair it with `G92 E0`). The XYZ
        // work-offset (full G92 / G53–G59) is phase 3 — a `G92 X/Y/Z` is disclosed as unhandled, never
        // silently applied as a datum shift.
        if (cmd.params.e !== undefined) lastE = cmd.params.e;
        if (cmd.params.x !== undefined || cmd.params.y !== undefined || cmd.params.z !== undefined) {
          warn('g92-xyz-unhandled', 'G92 X/Y/Z work-offset not yet honored (E10 phase 3)', offset);
        }
        break;
      default:
        warn('unsupported-command', `unsupported command '${cmd.gcode}' preserved as metadata`, offset);
    }
    if (!ok) {
      truncatedAtByte = offset;
    }
  };

  const finish = (cancelledAtByte?: number): ParseResult => {
    if (stopReason !== undefined && truncatedAtByte === undefined) {
      truncatedAtByte = currentSrcByte;
    }
    if (cancelledAtByte !== undefined && stopReason === undefined && truncatedAtByte === undefined) {
      truncatedAtByte = cancelledAtByte;
    }

    finishPath();
    if (layersCleared) {
      writer.clearLayers();
      carryLayer = 0;
    }

    const segments = writer.finalize();
    stats.segments = segments.count;

    const origin = { x: ox, y: oy, z: oz };
    const { bounds, boundsWithTravel } = computeSegmentBounds(segments, origin);
    const sourceIndex = buildSourceIndex(segments.srcByte, segments.count);

    // Layer table for the IR (absolute z; seg ranges accumulated above).
    const irLayers: ToolpathLayer[] =
      layersCleared || layers.length === 0
        ? segments.count > 0
          ? [{ z: oz + segments.z1[0], segStart: 0, segEnd: segments.count - 1 }]
          : []
        : layers.map((l) => ({ z: l.z, segStart: l.segStart, segEnd: l.segEnd }));

    const layersCapability: Confidence =
      layersCleared || layers.length === 0 ? 'unavailable' : unindexedPaths > 0 ? 'inferred' : 'known';

    const capabilities: Record<string, Confidence> = {
      geometry: 'known',
      moveKind: 'known',
      tools: 'known',
      layers: layersCapability,
      extrusionDelta: 'known',
      feedrate: 'known',
      sourcePositions: 'known',
      featureRoles: 'unavailable',
      objects: 'unavailable',
      retractions: retractionEvents.length > 0 ? 'known' : 'unavailable',
      colorChanges: colorChangeEvents.length > 0 ? 'known' : 'unavailable',
      // Motion-model modes (DD-010 E10 phase 1). 'known' when the governing command was seen
      // (M82/M83, or a firmware-known G90/G91 for E); 'inferred' when defaulted (absolute).
      extrusionMode: eModeExplicit !== null || (extruderFollowsPositioning && positioningSeen) ? 'known' : 'inferred',
      positioningMode: positioningSeen ? 'known' : 'inferred'
    };

    if (layersCapability === 'unavailable') {
      warn('layers-unavailable', 'No planar layer index; all segments assigned to layer 0.');
    } else if (unindexedPaths > 0) {
      warn('layers-partially-inferred', `${unindexedPaths} path(s) not in the layer index; layer carried forward.`);
    }

    const tools: ToolInfo[] = [...toolsSeen].sort((a, b) => a - b).map((id) => ({ id }));

    const complete = stopReason === undefined && cancelledAtByte === undefined;
    const ir: ToolpathIR = {
      header: {
        irSchemaVersion: IR_SCHEMA_VERSION,
        parserVersion: opts.parserVersion ?? '@chestnutlabs/gcode-parser@0.0.0',
        source: { id: opts.sourceId, byteLength },
        units,
        unitsSource: unitsSeen ? 'known' : 'inferred',
        originOffset: origin,
        complete,
        truncatedAtByte: complete ? undefined : truncatedAtByte,
        dialects: [],
        warnings: [...warnings.values()],
        capabilities
      },
      segments,
      layers: irLayers,
      tools,
      objects: [],
      retractions: retractionEvents.map((r) => ({
        x: r.x - ox,
        y: r.y - oy,
        z: r.z - oz,
        kind: r.kind,
        srcByte: r.srcByte,
        segIndex: r.segIndex
      })),
      colorChanges: colorChangeEvents.map((c) => ({
        x: c.x - ox,
        y: c.y - oy,
        z: c.z - oz,
        segIndex: c.segIndex,
        srcByte: c.srcByte,
        tool: c.tool
      })),
      bounds,
      boundsWithTravel,
      sourceIndex
    };

    if (stopReason !== undefined) {
      stats.stopReason = stopReason;
    }
    return { ir, stats };
  };

  // Force a mid-path snapshot cut once the open path grows this large — a
  // single unbroken extrusion (vase/spiral mode) would otherwise never emit a
  // preview. Mid-path segments carry UNRESOLVED_LAYER sentinels: preview-grade.
  const FORCE_CUT_SEGMENTS = 65_536;

  const snapshot = (fromSeg: number): { slice: ToolpathIR; upTo: number } | null => {
    // Path-aligned cut: segments in the open path still carry UNRESOLVED_LAYER.
    let cut = path === null ? writer.count : path.segStart;
    if (cut <= fromSeg && writer.count - fromSeg >= FORCE_CUT_SEGMENTS) {
      cut = writer.count;
    }
    if (cut <= fromSeg || !originSet) return null;
    let channels;
    try {
      channels = writer.snapshotRange(fromSeg, cut);
    } catch (err) {
      if (err instanceof BudgetExceededError || err instanceof RangeError) return null; // skip, never stop the parse
      throw err;
    }
    const origin = { x: ox, y: oy, z: oz };
    const { bounds, boundsWithTravel } = computeSegmentBounds(channels, origin);
    const lastZ = channels.count > 0 ? oz + channels.z1[channels.count - 1] : oz;
    const slice: ToolpathIR = {
      header: {
        irSchemaVersion: IR_SCHEMA_VERSION,
        parserVersion: opts.parserVersion ?? '@chestnutlabs/gcode-parser@0.0.0',
        source: { id: opts.sourceId, byteLength },
        units,
        unitsSource: unitsSeen ? 'known' : 'inferred',
        originOffset: origin,
        complete: false, // a snapshot is by definition not the whole toolpath
        dialects: [],
        warnings: [],
        capabilities: {
          geometry: 'known',
          moveKind: 'known',
          tools: 'known',
          // Single coarse layer entry + globally-indexed layer channel: honest
          // "approximated" — the final IR carries the real table.
          layers: 'approximated',
          extrusionDelta: 'known',
          feedrate: 'known',
          sourcePositions: 'unavailable', // no per-slice source index is built
          featureRoles: 'unavailable',
          objects: 'unavailable',
          retractions: 'unavailable', // markers resolve on the final IR, not on preview slices
          colorChanges: 'unavailable', // color-change boundaries resolve on the final IR
          extrusionMode: 'inferred', // motion modes resolve fully on the final IR (E10)
          positioningMode: 'inferred'
        }
      },
      segments: channels,
      layers: channels.count > 0 ? [{ z: lastZ, segStart: 0, segEnd: channels.count - 1 }] : [],
      tools: [...toolsSeen].sort((a, b) => a - b).map((id) => ({ id })),
      objects: [],
      retractions: [],
      colorChanges: [],
      bounds,
      boundsWithTravel,
      sourceIndex: { byteOffsets: new Uint32Array(0), segmentIndices: new Uint32Array(0) }
    };
    return { slice, upTo: cut };
  };

  return {
    text,
    limits,
    processLine,
    stopped: () => stopReason !== undefined,
    snapshot,
    markInputTooBig: () => {
      stopReason = {
        code: 'E_LIMIT_INPUT_BYTES',
        message: `input of ${byteLength} B exceeds maxInputBytes=${limits.maxInputBytes} B`,
        srcByte: 0
      };
      truncatedAtByte = 0;
    },
    setSourceBytes: (bytes: number) => {
      byteLength = bytes;
      stats.bytes = bytes;
    },
    finish
  };
}

/** Parse a whole G-code text into a ToolpathIR. Pure and synchronous. */
export function parseGcodeToIR(input: string | Uint8Array, opts: ParseOptions = {}): ParseResult {
  const engine = createEngine(input, opts);
  const byteLength = typeof input === 'string' ? input.length : input.byteLength;
  if (byteLength > engine.limits.maxInputBytes) {
    engine.markInputTooBig();
    return engine.finish();
  }
  const text = engine.text;
  const len = text.length;
  let offset = 0;
  while (offset < len && !engine.stopped()) {
    let nl = text.indexOf('\n', offset);
    if (nl === -1) nl = len;
    engine.processLine(text.slice(offset, nl), offset);
    offset = nl + 1;
  }
  return engine.finish();
}

/** Explicit macrotask yield via MessageChannel (DD-003 §5.2 — setTimeout is clamped). */
function yieldMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      ch.port2.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
}

/**
 * Cooperative async driver (DD-003 §5.2): identical parsing semantics, but the
 * loop processes at most `yieldIntervalMs` (default 50) of CPU work between
 * explicit macrotask yields so queued `cancel` messages are dispatched. Progress
 * and cancellation are surfaced through hooks.
 */
export async function parseGcodeToIRAsync(
  input: string | Uint8Array,
  opts: ParseOptions = {},
  hooks: AsyncParseHooks = {}
): Promise<AsyncParseResult> {
  const engine = createEngine(input, opts);
  const byteLength = typeof input === 'string' ? input.length : input.byteLength;
  if (byteLength > engine.limits.maxInputBytes) {
    engine.markInputTooBig();
    return { ...engine.finish(), cancelled: false };
  }
  const yieldEvery = hooks.yieldIntervalMs ?? 50;
  const partial = makePartialEmitter(engine, hooks);
  const text = engine.text;
  const len = text.length;
  let offset = 0;
  let sliceStart = Date.now();

  while (offset < len && !engine.stopped()) {
    let nl = text.indexOf('\n', offset);
    if (nl === -1) nl = len;
    engine.processLine(text.slice(offset, nl), offset);
    offset = nl + 1;

    if (Date.now() - sliceStart >= yieldEvery) {
      hooks.onProgress?.(Math.min(offset, len), byteLength, 0);
      partial(Math.min(offset, len));
      await yieldMacrotask();
      if (hooks.shouldCancel?.()) {
        return { ...engine.finish(Math.min(offset, len)), cancelled: true };
      }
      sliceStart = Date.now();
    }
  }
  hooks.onProgress?.(len, byteLength, 0);
  return { ...engine.finish(), cancelled: false };
}

/**
 * Shared partial-snapshot emitter for the async and streaming drivers (#60):
 * called at cooperative yield points; emits a delta once bytesProcessed passes
 * `partialMinBytes` and at most every `partialIntervalMs`.
 */
export function makePartialEmitter(engine: Engine, hooks: AsyncParseHooks): (bytesProcessed: number) => void {
  const onPartial = hooks.onPartial;
  if (onPartial === undefined) return () => undefined;
  const minBytes = hooks.partialMinBytes ?? 0;
  const intervalMs = hooks.partialIntervalMs ?? 1000;
  let sentSegs = 0;
  let lastEmit = Date.now();
  return (bytesProcessed: number): void => {
    if (bytesProcessed < minBytes) return;
    const now = Date.now();
    if (now - lastEmit < intervalMs) return;
    const snap = engine.snapshot(sentSegs);
    if (snap === null) return;
    lastEmit = now;
    sentSegs = snap.upTo;
    onPartial(snap.slice, snap.upTo);
  };
}
