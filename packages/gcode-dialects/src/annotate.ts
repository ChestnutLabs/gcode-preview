/**
 * Shared annotation helpers for slicer adapters (DD-005 phase 3, issue #75).
 *
 * Comment markers arrive with a source-byte position but no segment index; the
 * IR's byte-ordered sourceIndex resolves them to segment ranges in `finalize`
 * (DD-005 §4.3: "annotation ranges are [segAtEvent, segBeforeNextEvent]").
 */
import { MoveKind, type MachineGeometry, type Point2, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import type { AnnotationSink } from './contracts.js';

/** First segment whose producing command starts at or after `byte`. */
export function segAtOrAfterByte(ir: ToolpathIR, byte: number): number {
  const offsets = ir.sourceIndex.byteOffsets;
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] < byte) lo = mid + 1;
    else hi = mid;
  }
  return lo < offsets.length ? ir.sourceIndex.segmentIndices[lo] : ir.segments.count;
}

export interface RangeMarker {
  srcByte: number;
  value: number; // FeatureRole index or object-channel value
}

/**
 * Apply byte-positioned markers as contiguous channel ranges: each marker
 * covers [its first segment, the next marker's first segment - 1]. A marker
 * value of 0 acts as a range terminator (back to unknown/none).
 */
export function applyMarkerRanges(
  ir: ToolpathIR,
  markers: RangeMarker[],
  write: (segStart: number, segEnd: number, value: number) => void
): number {
  let applied = 0;
  for (let i = 0; i < markers.length; i++) {
    if (markers[i].value === 0) continue;
    const start = segAtOrAfterByte(ir, markers[i].srcByte);
    const end = (i + 1 < markers.length ? segAtOrAfterByte(ir, markers[i + 1].srcByte) : ir.segments.count) - 1;
    if (end >= start) {
      write(start, end, markers[i].value);
      applied++;
    }
  }
  return applied;
}

/** One end of a housekeeping bracket (DD-016/DD-026 D3): source byte + whether it OPENED the bracket. */
export interface BracketMark {
  srcByte: number;
  open: boolean; // true = <NAME>_START, false = <NAME>_END
}

/** One end of a wipe bracket (DD-016, #182). Structurally a {@link BracketMark}; kept for compatibility. */
export type WipeMark = BracketMark;

/**
 * Classify a comment as a PrusaSlicer/OrcaSlicer wipe-bracket marker. The convention is bare
 * `;WIPE_START` / `;WIPE_END` (the semicolon is already stripped before onComment); tolerant of a
 * leading space and casing. Returns null for any other comment.
 */
export function matchWipeComment(comment: string): 'start' | 'end' | null {
  return matchBracketComment(comment, 'WIPE');
}

/**
 * Classify a comment as a bare `<NAME>_START` / `<NAME>_END` bracket marker (semicolon already stripped
 * before onComment; case/space tolerant). Used for wipe (DD-016) and the DD-026 D3 housekeeping brackets
 * (`FLUSH_START/END`, `WIPE_TOWER_START/END`). Returns null for any other comment.
 */
export function matchBracketComment(comment: string, name: string): 'start' | 'end' | null {
  const t = comment.trim().toUpperCase();
  const n = name.toUpperCase();
  if (t === `${n}_START`) return 'start';
  if (t === `${n}_END`) return 'end';
  return null;
}

/**
 * Resolve balanced open/close bracket marks to inclusive segment ranges and hand each to `emit`. Shared
 * by the wipe (MoveKind) and DD-026 housekeeping-role (FeatureRole) brackets. Unbalanced or nested
 * markers degrade safely: a stray END is ignored, a second START before an END folds into the open
 * bracket, and a START left open at end-of-file closes at the last segment. Returns ranges emitted.
 */
function forEachBracketRange(
  ir: ToolpathIR,
  marks: BracketMark[],
  emit: (segStart: number, segEndInclusive: number) => void
): number {
  let applied = 0;
  let openByte = -1;
  for (const mark of marks) {
    if (mark.open) {
      if (openByte < 0) openByte = mark.srcByte;
    } else if (openByte >= 0) {
      const start = segAtOrAfterByte(ir, openByte);
      const end = segAtOrAfterByte(ir, mark.srcByte); // first segment AFTER the block
      if (end - 1 >= start) {
        emit(start, end - 1);
        applied++;
      }
      openByte = -1;
    }
  }
  if (openByte >= 0) {
    const start = segAtOrAfterByte(ir, openByte);
    if (ir.segments.count - 1 >= start) {
      emit(start, ir.segments.count - 1);
      applied++;
    }
  }
  return applied;
}

/**
 * Resolve WIPE_START/END byte marks to segment ranges and add `MoveKind.Wipe` additively via the sink
 * (DD-016 §4.2). Segments emitted between a START and its END are the wipe moves. Returns ranges applied.
 */
export function applyWipeRanges(ir: ToolpathIR, marks: WipeMark[], sink: AnnotationSink): number {
  return forEachBracketRange(ir, marks, (start, end) => sink.addMoveKind(start, end, MoveKind.Wipe));
}

/**
 * Resolve a housekeeping bracket (DD-026 D3) — e.g. Bambu `FLUSH_START/END` → `FeatureRole.Purge`,
 * `WIPE_TOWER_START/END` → `FeatureRole.WipeTower` — to segment ranges and set `role` on the enclosed
 * segments. Apply this AFTER the `;TYPE:`/`; FEATURE:` markers so the explicit bracket wins over the
 * surrounding role (the classifier then excludes the whole bracket from `modelBounds`). Returns ranges
 * applied.
 */
export function applyFeatureBracketRanges(
  ir: ToolpathIR,
  marks: BracketMark[],
  role: number,
  sink: AnnotationSink
): number {
  return forEachBracketRange(ir, marks, (start, end) => sink.setFeature(start, end, role));
}

export interface SegMarker {
  segIndex: number;
  value: number; // channel value; 0 = range terminator
}

/**
 * Apply SEGMENT-indexed markers (CommandEvent.segIndex — exact, no byte
 * resolution needed) as contiguous ranges; value 0 terminates (DD-005 phase 5).
 */
export function applySegmentMarkers(
  markers: SegMarker[],
  segmentCount: number,
  write: (segStart: number, segEnd: number, value: number) => void
): number {
  let applied = 0;
  for (let i = 0; i < markers.length; i++) {
    if (markers[i].value === 0) continue;
    const start = markers[i].segIndex;
    const end = (i + 1 < markers.length ? markers[i + 1].segIndex : segmentCount) - 1;
    if (end >= start && start < segmentCount) {
      write(start, Math.min(end, segmentCount - 1), markers[i].value);
      applied++;
    }
  }
  return applied;
}

/** Parse `key = value` / `key: value` slicer comment lines (Prusa tail, Orca header/config blocks). */
export function parseKeyValue(comment: string): { key: string; value: string } | null {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.*\S)\s*$/.exec(comment);
  return m === null ? null : { key: m[1].toLowerCase(), value: m[2] };
}

/** Parse "0x0,250x0,250x210,0x210" bed/printable-area point lists. */
export function parseAreaPoints(value: string): Point2[] | null {
  const parts = value.split(',');
  if (parts.length < 3 || parts.length > 64) return null;
  const points: Point2[] = [];
  for (const p of parts) {
    const m = /^\s*(-?\d+(?:\.\d+)?)x(-?\d+(?:\.\d+)?)\s*$/.exec(p);
    if (m === null) return null;
    points.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
  }
  return points;
}

/** Points → MachineGeometry bed (axis-aligned quad becomes rect, else polygon). */
export function bedFromPoints(
  points: Point2[],
  adapterId: string,
  evidence: string,
  heightMm: number | undefined,
  printerName: string | undefined,
  srcByte: number | undefined
): MachineGeometry {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const min = { x: Math.min(...xs), y: Math.min(...ys) };
  const max = { x: Math.max(...xs), y: Math.max(...ys) };
  const rect =
    points.length === 4 && points.every((p) => (p.x === min.x || p.x === max.x) && (p.y === min.y || p.y === max.y));
  return {
    bed: rect ? { kind: 'rect', min, max } : { kind: 'polygon', points },
    origin: { x: 0, y: 0 },
    heightMm,
    printerName,
    confidence: 'inferred', // read from slicer COMMENTS, not machine config
    source: { adapterId, evidence, srcByte }
  };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const t = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

/** Dependency-free base64 decode (thumbnail comments); returns null on invalid input. */
export function decodeBase64(text: string): Uint8Array | null {
  const clean = text.replace(/[\s=]+/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i);
    const v = c < 128 ? B64_LOOKUP[c] : -1;
    if (v === -1) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** Shared thumbnail-comment accumulator (`thumbnail begin WxH LEN` … base64 … `thumbnail end`). */
export class ThumbnailCollector {
  private active: { width: number; height: number; b64: string[]; bytes: number } | null = null;
  constructor(private readonly maxBytesPerThumbnail = 512 * 1024) {}

  /** True while inside a begin/end block — the adapter must route EVERY comment here. */
  get isActive(): boolean {
    return this.active !== null;
  }

  /** Feed one comment line; emits to the sink when a bounded thumbnail completes. */
  feed(comment: string, sink: AnnotationSink): void {
    const trimmed = comment.trim();
    const begin = /^thumbnail(?:_JPG|_QOI)? begin (\d+)[x ](\d+) (\d+)/i.exec(trimmed);
    if (begin !== null) {
      const declared = parseInt(begin[3]);
      this.active =
        declared <= this.maxBytesPerThumbnail
          ? { width: parseInt(begin[1]), height: parseInt(begin[2]), b64: [], bytes: 0 }
          : null;
      return;
    }
    if (/^thumbnail(?:_JPG|_QOI)? end/i.test(trimmed)) {
      if (this.active !== null) {
        const bytes = decodeBase64(this.active.b64.join(''));
        if (bytes !== null && bytes.byteLength > 0) {
          sink.addThumbnail({ width: this.active.width, height: this.active.height, mime: 'image/png', bytes });
        }
      }
      this.active = null;
      return;
    }
    if (this.active !== null) {
      this.active.bytes += trimmed.length;
      if (this.active.bytes > (this.maxBytesPerThumbnail * 4) / 3 + 8) {
        this.active = null; // lied about its size — drop, stay bounded
        return;
      }
      this.active.b64.push(trimmed);
    }
  }
}
