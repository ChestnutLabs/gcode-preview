import { type SourceIndex } from './ir';

/**
 * Build the source-position index: sort segments by their source byte offset so a
 * consumer (live progress, E5/DD-006) can map `byteOffset -> segmentIndex`.
 */
export function buildSourceIndex(srcByte: Uint32Array, count: number): SourceIndex {
  const order = Array.from({ length: count }, (_, i) => i);
  order.sort((a, b) => srcByte[a] - srcByte[b]);
  const byteOffsets = new Uint32Array(count);
  const segmentIndices = new Uint32Array(count);
  for (let k = 0; k < count; k++) {
    byteOffsets[k] = srcByte[order[k]];
    segmentIndices[k] = order[k];
  }
  return { byteOffsets, segmentIndices };
}

/**
 * Return the segment index for the largest indexed byte offset `<= byteOffset`,
 * or `-1` if `byteOffset` precedes the first segment. Exact where an offset matches;
 * otherwise resolves to the segment in progress at that offset.
 */
export function segmentAtByte(index: SourceIndex, byteOffset: number): number {
  const offsets = index.byteOffsets;
  let lo = 0;
  let hi = offsets.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= byteOffset) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans === -1 ? -1 : index.segmentIndices[ans];
}
