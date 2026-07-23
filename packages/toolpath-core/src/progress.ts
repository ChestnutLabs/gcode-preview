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
/** Relative file-size disagreement that demotes the byte domain (§4.4.1). */
const FILE_SIZE_MISMATCH_TOLERANCE = 0.001;
/** Reported-vs-IR layer-count disagreement beyond which the reported layer is a fraction (§4.3). */
const LAYER_COUNT_MISMATCH_TOLERANCE = 2;
/** Backward layer movement at or below this re-syncs silently (§4.4.2). */
const REGRESSION_LAYER_TOLERANCE = 2;

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
): {
  byte?: number;
  line?: number;
  layer?: number;
  totalLayers?: number;
  percent?: number;
  percentBasis: ProgressPercentBasis;
} {
  const out: ReturnType<typeof sanitizePosition> = { percentBasis: 'unknown' };
  if (position === undefined || position === null || typeof position !== 'object') return out;
  for (const field of ['byte', 'line', 'layer', 'totalLayers', 'percent'] as const) {
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

  /**
   * File-identity check (§4.4.1). A hash disagreement kills the mapping outright; a size
   * disagreement demotes the byte domain (byte + percent-bytes promotion) to fraction mapping.
   */
  function checkIdentity(
    file: ProgressFileIdentity | undefined,
    notes: ProgressNote[]
  ): 'ok' | 'demote' | 'unavailable' {
    if (file === undefined || file === null || typeof file !== 'object') return 'ok';
    const expectedSha = ir.header.source.sha256;
    if (typeof file.sha256 === 'string' && expectedSha !== undefined && file.sha256 !== expectedSha) {
      pushNote(notes, { code: 'file-mismatch', message: 'sha256 disagrees with the parsed source' });
      return 'unavailable';
    }
    const obsSize = finiteNonNegative(file.sizeBytes);
    const expectedSize = fileSizeBytes ?? finiteNonNegative(ir.header.source.byteLength);
    if (obsSize !== undefined && expectedSize !== undefined && expectedSize > 0) {
      if (Math.abs(obsSize - expectedSize) / expectedSize > FILE_SIZE_MISMATCH_TOLERANCE) {
        pushNote(notes, {
          code: 'file-mismatch',
          message: `sizeBytes ${obsSize} vs parsed ${expectedSize}`
        });
        return 'demote';
      }
    }
    return 'ok';
  }

  /**
   * Cross-check the winning tier against a reported layer (§4.3): disagreement beyond one layer
   * widens the band to cover both — precision claims stay evidence-backed, tiers never switch silently.
   */
  function applyLayerCrossCheck(result: MappedProgress, reportedLayerRaw: number): MappedProgress {
    if (result.layerIndex === null || result.band === null || ir.layers.length === 0) return result;
    const reported = Math.min(Math.max(Math.floor(reportedLayerRaw), 0), ir.layers.length - 1);
    if (Math.abs(result.layerIndex - reported) <= 1) return result;
    const entry = ir.layers[reported];
    const notes = [...result.notes];
    pushNote(notes, {
      code: 'cross-check-disagrees',
      message: `mapped layer ${result.layerIndex}, reported ${reported}`
    });
    return {
      ...result,
      band: [Math.min(result.band[0], entry.segStart), Math.max(result.band[1], entry.segEnd)],
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
    const identity = checkIdentity(obs.file, notes);
    if (identity === 'unavailable') {
      // A marker on the wrong file is worse than no marker (§4.4.1).
      return { ...UNAVAILABLE, notes };
    }

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
    if (p.byte !== undefined) {
      if (identity === 'demote') {
        // The printer's byte domain is not our parsed stream: map its byte as a fraction of
        // ITS file (tier 5), keeping the basis honest about which fact was used.
        const theirSize = finiteNonNegative(obs.file?.sizeBytes);
        if (theirSize !== undefined && theirSize > 0) {
          const demoted = mapPercentOrdinal(Math.min(1, p.byte / theirSize), notes);
          const withBasis: MappedProgress = { ...demoted, basis: 'byte' };
          return p.layer !== undefined ? applyLayerCrossCheck(withBasis, p.layer) : withBasis;
        }
        return { ...UNAVAILABLE, notes };
      }
      const mapped = mapByte(p.byte, 'known', 0, notes);
      return p.layer !== undefined ? applyLayerCrossCheck(mapped, p.layer) : mapped;
    }
    if (p.line !== undefined) {
      // Reserved tier (D3): carried but unmapped in v1 — fall through, visibly.
      pushNote(notes, { code: 'line-unmapped', message: 'no line index in v1; falling through' });
    }
    // Size usable for percent(bytes) promotion — untrusted after an identity demotion.
    const promoSize =
      identity === 'demote'
        ? undefined // their fraction is of a different byte stream — no promotion
        : (fileSizeBytes ?? finiteNonNegative(obs.file?.sizeBytes) ?? finiteNonNegative(ir.header.source.byteLength));

    /** Segment the percent fact points at on its own (for cross-checking a winning layer tier). */
    function percentImpliedSegment(percent: number): number {
      if (p.percentBasis === 'bytes' && promoSize !== undefined && promoSize > 0) {
        const seg = segmentAtByte(ir.sourceIndex, Math.round(percent * promoSize));
        return seg === -1 ? 0 : seg;
      }
      return clampSeg(ir, Math.round(percent * (ir.segments.count - 1)));
    }

    if (p.layer !== undefined && ir.layers.length > 0) {
      if (
        p.totalLayers !== undefined &&
        p.totalLayers > 0 &&
        Math.abs(p.totalLayers - ir.layers.length) > LAYER_COUNT_MISMATCH_TOLERANCE
      ) {
        // The reporter counts layers differently than the IR: its index is untrustworthy as an
        // index, but still meaningful as a fraction (§4.3 layer caveats).
        pushNote(notes, {
          code: 'layer-count-mismatch',
          message: `reported total ${p.totalLayers}, IR has ${ir.layers.length}`
        });
        const fraction = Math.min(1, p.layer / p.totalLayers);
        return { ...mapPercentOrdinal(fraction, notes), basis: 'layer' };
      }
      const mapped = mapLayer(p.layer, notes);
      // Winning layer tier is validated against the percent fact when both are present (§4.3).
      return p.percent !== undefined
        ? applyLayerCrossCheck(mapped, ir.segments.layer[percentImpliedSegment(p.percent)])
        : mapped;
    }
    if (p.percent !== undefined) {
      if (p.percentBasis === 'bytes' && promoSize !== undefined && promoSize > 0) {
        // Promotion (D4): arithmetic is exact, the source is still a fraction → approximated + band.
        const halfWidth = Math.ceil(ir.segments.count * PERCENT_BYTES_BAND_FRACTION);
        const mapped: MappedProgress = {
          ...mapByte(Math.round(p.percent * promoSize), 'approximated', halfWidth, notes),
          basis: 'percent'
        };
        return p.layer !== undefined ? applyLayerCrossCheck(mapped, p.layer) : mapped;
      }
      return mapPercentOrdinal(p.percent, notes);
    }
    if (notes.length === 0) pushNote(notes, { code: 'no-position-facts' });
    return { ...UNAVAILABLE, notes };
  }

  /** Append a note to a finished result (copy-on-write; respects the cap). */
  function withNote(result: MappedProgress, code: string, message?: string): MappedProgress {
    const notes = [...result.notes];
    pushNote(notes, message === undefined ? { code } : { code, message });
    return { ...result, notes };
  }

  return {
    observe(obs: ProgressObservation): MappedProgress {
      const prev = lastResult;
      let result = map(obs);

      // `cancelled`/`unknown` with no usable facts keep the last mapped position, flagged (§4.4.3).
      const state = obs?.state;
      if ((state === 'cancelled' || state === 'unknown') && result.basis === 'none' && prev.segIndex !== null) {
        result = withNote({ ...prev, stale: false }, state === 'cancelled' ? 'job-cancelled' : 'state-unknown');
      } else if (state === 'cancelled') {
        result = withNote(result, 'job-cancelled');
      }

      // Regression (§4.4.2): re-sync always; a jump back beyond tolerance is visible, not dropped.
      if (
        prev.layerIndex !== null &&
        result.layerIndex !== null &&
        prev.layerIndex - result.layerIndex > REGRESSION_LAYER_TOLERANCE
      ) {
        result = withNote(result, 'position-regressed', `layer ${prev.layerIndex} -> ${result.layerIndex}`);
      }

      lastTimestampMs =
        typeof obs?.timestampMs === 'number' && Number.isFinite(obs.timestampMs) ? obs.timestampMs : null;
      lastResult = result;
      return result;
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
