/**
 * Source-line ↔ segment mapping (#184) — the "G-code debugger" surface: resolve a rendered segment
 * to the G-code line that produced it, and a source line back to its segment. Framework-free and
 * built on data the IR already carries (`segments.srcByte`, the byte→segment `sourceIndex`); the only
 * missing piece is byte↔line, which needs the source text (the IR stores byte offsets, not lines).
 *
 * Build a {@link SourceLineIndex} once from the source, then all four lookups are O(log n).
 */
import { type SourceIndex } from './ir.js';

/** Byte offsets of each line start (index 0 = line 1 at byte 0), plus the total length. */
export interface SourceLineIndex {
  /** `lineStarts[k]` is the byte offset where line `k + 1` begins. */
  lineStarts: Uint32Array;
  /** Total source length in bytes. */
  byteLength: number;
}

/** Build the line index from the raw source (string or the parsed bytes). O(bytes), one pass. */
export function buildSourceLineIndex(source: string | Uint8Array): SourceLineIndex {
  // TextEncoder is a runtime global (browser + Node); reach it via globalThis so this DOM-free
  // package (lib: ES2022, types: []) typechecks without pulling the DOM lib.
  const Enc = (globalThis as unknown as { TextEncoder: new () => { encode(input: string): Uint8Array } }).TextEncoder;
  const bytes = typeof source === 'string' ? new Enc().encode(source) : source;
  const starts: number[] = [0];
  // A trailing '\n' ends the last line rather than starting an empty new one (editor convention),
  // so only record a start when bytes follow the newline.
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a /* \n */ && i + 1 < bytes.length) starts.push(i + 1);
  }
  return { lineStarts: Uint32Array.from(starts), byteLength: bytes.length };
}

/** 1-based line number containing `byteOffset` (binary search). Clamped to [1, lineCount]. */
export function lineAtByte(index: SourceLineIndex, byteOffset: number): number {
  const starts = index.lineStarts;
  let lo = 0;
  let hi = starts.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= byteOffset) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans + 1; // 1-based
}

/** Byte range `[start, end)` of a 1-based `line`; null when out of range. `end` excludes the newline-led next line. */
export function byteRangeOfLine(index: SourceLineIndex, line: number): [number, number] | null {
  const starts = index.lineStarts;
  if (line < 1 || line > starts.length) return null;
  const start = starts[line - 1];
  const end = line < starts.length ? starts[line] : index.byteLength;
  return [start, end];
}

/** 1-based source line that produced segment `segIndex`; null when the index is out of range. */
export function sourceLineOfSegment(srcByte: Uint32Array, lineIndex: SourceLineIndex, segIndex: number): number | null {
  if (segIndex < 0 || segIndex >= srcByte.length) return null;
  return lineAtByte(lineIndex, srcByte[segIndex]);
}

/**
 * The segment produced by a 1-based source `line`, or -1 when the line produced no segment (a comment,
 * a blank line, or a non-motion command). Resolves to the first segment whose source byte falls within
 * the line's byte range.
 */
export function segmentAtSourceLine(sourceIndex: SourceIndex, lineIndex: SourceLineIndex, line: number): number {
  const range = byteRangeOfLine(lineIndex, line);
  if (range === null) return -1;
  // Smallest indexed byte >= range start whose byte is < range end.
  const offsets = sourceIndex.byteOffsets;
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid] < range[0]) lo = mid + 1;
    else hi = mid;
  }
  if (lo < offsets.length && offsets[lo] >= range[0] && offsets[lo] < range[1]) {
    return sourceIndex.segmentIndices[lo];
  }
  // The line produced no segment (comment, blank, or a non-motion command) — honestly -1.
  return -1;
}
