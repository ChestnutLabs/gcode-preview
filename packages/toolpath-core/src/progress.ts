/**
 * Normalized live progress: observation contract + source-position mapper (DD-006).
 *
 * A host (e.g. AnyBridge) pushes `ProgressObservation`s built from its own telemetry;
 * `createProgressMapper` turns each into a `MappedProgress` over an existing `ToolpathIR`
 * using the fallback hierarchy of DD-006 §4.3: byte > line (reserved) > layer > percent.
 * Everything here is plain serializable data and pure IR math — no telemetry transport,
 * no worker round-trip, O(log n) per observation.
 *
 * Honesty rules are the point: confidence reuses the DD-001 vocabulary, approximate tiers
 * carry an uncertainty band instead of pretending to be a point, and unusable observations
 * degrade to `unavailable` — never a fabricated position.
 */
import { type Confidence, type ToolpathIR } from './ir.js';
import { segmentAtByte } from './source-index.js';

/** Contract version of `ProgressObservation`. Bump only on breaking shape changes. */
export const PROGRESS_OBSERVATION_VERSION = 1;

/** Default staleness threshold (DD-006 §4.4.3). */
export const DEFAULT_STALE_AFTER_MS = 10_000;

/** What a percent observation measures — decides how it maps (DD-006 D4). */
export type ProgressPercentBasis = 'bytes' | 'job' | 'unknown';

export type ProgressJobState = 'printing' | 'paused' | 'complete' | 'cancelled' | 'unknown';

/** Identity evidence for the file the printer is executing (mismatch detection, DD-006 §4.4.1). */
export interface ProgressFileIdentity {
  name?: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface ProgressPosition {
  /** Exact byte offset into the byte stream the parser consumed (DD-006 §4.4.1 byte domain). */
  byte?: number;
  /** 0-based source line. Reserved (D3): carried and serialized, not mapped in v1. */
  line?: number;
  /** Current layer as reported by the printer/host (numbering caveats, DD-006 §4.3). */
  layer?: number;
  totalLayers?: number;
  /** Fraction 0..1. */
  percent?: number;
  percentBasis?: ProgressPercentBasis;
}

/** One consumer-supplied snapshot of where the printer is. All position facts optional. */
export interface ProgressObservation {
  v: 1;
  /** Consumer clock (ms) — drives staleness via `tick()`. */
  timestampMs: number;
  file?: ProgressFileIdentity;
  position?: ProgressPosition;
  state?: ProgressJobState;
}

/** Which observation fact won the fallback hierarchy. */
export type ProgressBasis = 'byte' | 'line' | 'layer' | 'percent' | 'none';

export interface ProgressNote {
  code: string;
  message?: string;
}

export interface MappedProgress {
  /** Last segment at-or-before the observed position; null when unavailable (or before the first segment). */
  segIndex: number | null;
  basis: ProgressBasis;
  /** DD-001 vocabulary (D2): byte→known, line/layer→inferred, percent→approximated, none→unavailable. */
  confidence: Confidence;
  /** Inclusive uncertainty band [loSeg, hiSeg]; a point (lo === hi) for the byte tier. */
  band: [number, number] | null;
  layerIndex: number | null;
  /** True once `tick(now)` observes `now - timestampMs > staleAfterMs`. */
  stale: boolean;
  /** Structured degradation reasons (capped at {@link MAX_PROGRESS_NOTES}). */
  notes: ProgressNote[];
}

export interface ProgressMapperOptions {
  /** Staleness threshold in ms (default {@link DEFAULT_STALE_AFTER_MS}). */
  staleAfterMs?: number;
  /** Byte length of the parsed source; enables percent(bytes) promotion to the byte tier (D4). */
  fileSizeBytes?: number;
}

export interface ProgressMapper {
  /** Map one observation. Never throws on observation content (DD-006 §6). */
  observe(obs: ProgressObservation): MappedProgress;
  /** Recompute staleness against `nowMs` without a new observation. */
  tick(nowMs: number): MappedProgress;
  reset(): void;
}

/** Notes are bounded so a hostile/buggy host cannot grow memory (DD-006 §7). */
export const MAX_PROGRESS_NOTES = 8;

/** Widening factor for percent(bytes) promotion: the source is still a fraction (§4.3 tier 4). */
const PERCENT_BYTES_BAND_FRACTION = 0.005;
/** Minimum half-width for ordinal percent interpolation (§4.3 tier 5). */
const PERCENT_ORDINAL_BAND_FRACTION = 0.02;

const UNAVAILABLE: MappedProgress = Object.freeze({
  segIndex: null,
  basis: 'none',
  confidence: 'unavailable',
  band: null,
  layerIndex: null,
  stale: false,
  notes: []
});

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Extract the usable numeric facts, noting (not throwing on) malformed ones (DD-006 §6). */
function sanitizePosition(
  position: ProgressPosition | undefined,
  notes: ProgressNote[]
): { byte?: number; line?: number; layer?: number; percent?: number; percentBasis: ProgressPercentBasis } {
  const out: ReturnType<typeof sanitizePosition> = { percentBasis: 'unknown' };
  if (position === undefined || position === null || typeof position !== 'object') return out;
  for (const field of ['byte', 'line', 'layer', 'percent'] as const) {
    const raw = (position as Record<string, unknown>)[field];
    if (raw === undefined || raw === null) continue;
    const value = finiteNonNegative(raw);
    if (value === undefined) {
      pushNote(notes, { code: 'invalid-field', message: `position.${field} ignored` });
    } else {
      out[field] = value;
    }
  }
  if (out.percent !== undefined && out.percent > 1) {
    pushNote(notes, { code: 'invalid-field', message: 'position.percent > 1 ignored' });
    out.percent = undefined;
  }
  if (position.percentBasis === 'bytes' || position.percentBasis === 'job') {
    out.percentBasis = position.percentBasis;
  }
  return out;
}

function pushNote(notes: ProgressNote[], note: ProgressNote): void {
  if (notes.length < MAX_PROGRESS_NOTES) notes.push(note);
}

function clampSeg(ir: ToolpathIR, seg: number): number {
  return Math.max(0, Math.min(ir.segments.count - 1, seg));
}

function layerOfSegment(ir: ToolpathIR, segIndex: number | null): number | null {
  if (segIndex === null || ir.segments.count === 0) return null;
  return ir.segments.layer[segIndex];
}

/**
 * Build a `ProgressMapper` over a parsed IR. The mapper keeps only the last observation's
 * timestamp/result (for `tick`); it never mutates the IR.
 */
export function createProgressMapper(ir: ToolpathIR, opts?: ProgressMapperOptions): ProgressMapper {
  const staleAfterMs = opts?.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const fileSizeBytes = finiteNonNegative(opts?.fileSizeBytes);
  let lastTimestampMs: number | null = null;
  let lastResult: MappedProgress = UNAVAILABLE;

  function mapByte(byte: number, confidence: Confidence, bandHalfWidth: number, notes: ProgressNote[]): MappedProgress {
    const seg = segmentAtByte(ir.sourceIndex, byte);
    if (seg === -1) {
      // Position precedes the first segment: nothing completed yet — honest empty, not seg 0.
      pushNote(notes, { code: 'before-first-segment' });
      return { segIndex: null, basis: 'byte', confidence, band: null, layerIndex: null, stale: false, notes };
    }
    const lo = clampSeg(ir, seg - bandHalfWidth);
    const hi = clampSeg(ir, seg + bandHalfWidth);
    return {
      segIndex: seg,
      basis: 'byte',
      confidence,
      band: [lo, hi],
      layerIndex: layerOfSegment(ir, seg),
      stale: false,
      notes
    };
  }

  function mapLayer(reported: number, notes: ProgressNote[]): MappedProgress {
    const layerCount = ir.layers.length;
    let layer = Math.floor(reported);
    if (layer >= layerCount) {
      pushNote(notes, { code: 'layer-out-of-range', message: `reported ${layer}, IR has ${layerCount}` });
      layer = layerCount - 1;
    }
    const entry = ir.layers[layer];
    // segEnd is inclusive; "somewhere in layer L" maps to its last segment with a whole-layer band.
    return {
      segIndex: entry.segEnd,
      basis: 'layer',
      confidence: 'inferred',
      band: [entry.segStart, entry.segEnd],
      layerIndex: layer,
      stale: false,
      notes
    };
  }

  function mapPercentOrdinal(percent: number, notes: ProgressNote[]): MappedProgress {
    const count = ir.segments.count;
    const seg = clampSeg(ir, Math.round(percent * (count - 1)));
    const halfWidth = Math.ceil(count * PERCENT_ORDINAL_BAND_FRACTION);
    const layer = ir.segments.layer[seg];
    const entry = ir.layers[layer];
    // Band: at least ±2% of segments, widened to cover the whole containing layer (§4.3 tier 5).
    const lo = Math.min(clampSeg(ir, seg - halfWidth), entry?.segStart ?? seg);
    const hi = Math.max(clampSeg(ir, seg + halfWidth), entry?.segEnd ?? seg);
    return {
      segIndex: seg,
      basis: 'percent',
      confidence: 'approximated',
      band: [lo, hi],
      layerIndex: layer,
      stale: false,
      notes
    };
  }

  function map(obs: ProgressObservation): MappedProgress {
    if (ir.segments.count === 0) return { ...UNAVAILABLE, notes: [{ code: 'empty-ir' }] };
    if ((obs as { v?: unknown }).v !== PROGRESS_OBSERVATION_VERSION) {
      return { ...UNAVAILABLE, notes: [{ code: 'version-unsupported' }] };
    }
    const notes: ProgressNote[] = [];
    const p = sanitizePosition(obs.position, notes);

    // `complete` maps to the final segment regardless of position facts (§4.4.3).
    if (obs.state === 'complete') {
      const last = ir.segments.count - 1;
      return {
        segIndex: last,
        basis: p.byte !== undefined ? 'byte' : 'none',
        confidence: 'known',
        band: [last, last],
        layerIndex: layerOfSegment(ir, last),
        stale: false,
        notes
      };
    }

    // Fallback hierarchy (§4.3): highest-precision usable fact wins.
    if (p.byte !== undefined) return mapByte(p.byte, 'known', 0, notes);
    if (p.line !== undefined) {
      // Reserved tier (D3): carried but unmapped in v1 — fall through, visibly.
      pushNote(notes, { code: 'line-unmapped', message: 'no line index in v1; falling through' });
    }
    if (p.layer !== undefined && ir.layers.length > 0) return mapLayer(p.layer, notes);
    if (p.percent !== undefined) {
      const size = fileSizeBytes ?? finiteNonNegative(obs.file?.sizeBytes);
      if (p.percentBasis === 'bytes' && size !== undefined) {
        // Promotion (D4): arithmetic is exact, the source is still a fraction → approximated + band.
        const halfWidth = Math.ceil(ir.segments.count * PERCENT_BYTES_BAND_FRACTION);
        const mapped = mapByte(Math.round(p.percent * size), 'approximated', halfWidth, notes);
        return { ...mapped, basis: 'percent' };
      }
      return mapPercentOrdinal(p.percent, notes);
    }
    if (notes.length === 0) pushNote(notes, { code: 'no-position-facts' });
    return { ...UNAVAILABLE, notes };
  }

  return {
    observe(obs: ProgressObservation): MappedProgress {
      lastTimestampMs =
        typeof obs?.timestampMs === 'number' && Number.isFinite(obs.timestampMs) ? obs.timestampMs : null;
      lastResult = map(obs);
      return lastResult;
    },
    tick(nowMs: number): MappedProgress {
      if (lastTimestampMs === null) return lastResult;
      const stale = nowMs - lastTimestampMs > staleAfterMs;
      if (stale !== lastResult.stale) lastResult = { ...lastResult, stale };
      return lastResult;
    },
    reset(): void {
      lastTimestampMs = null;
      lastResult = UNAVAILABLE;
    }
  };
}
