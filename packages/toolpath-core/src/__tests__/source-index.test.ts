import { describe, expect, it } from 'vitest';
import { buildSourceIndex, segmentAtByte } from '../index';

describe('source index', () => {
  it('sorts by byte offset and maps an offset to the segment at or before it', () => {
    // Deliberately out of order to prove sorting.
    const srcByte = Uint32Array.from([100, 10, 250, 40]);
    const index = buildSourceIndex(srcByte, 4);

    // Sorted offsets: 10 (seg1), 40 (seg3), 100 (seg0), 250 (seg2).
    expect(Array.from(index.byteOffsets)).toEqual([10, 40, 100, 250]);
    expect(Array.from(index.segmentIndices)).toEqual([1, 3, 0, 2]);

    expect(segmentAtByte(index, 10)).toBe(1); // exact
    expect(segmentAtByte(index, 39)).toBe(1); // between 10 and 40 -> the segment in progress (seg1)
    expect(segmentAtByte(index, 40)).toBe(3); // exact
    expect(segmentAtByte(index, 500)).toBe(2); // past the end -> last segment (seg2 @ 250)
    expect(segmentAtByte(index, 5)).toBe(-1); // before the first offset
  });
});
