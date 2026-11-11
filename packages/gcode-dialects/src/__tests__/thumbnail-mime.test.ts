/**
 * Thumbnail-comment MIME labelling (#487): `thumbnail`, `thumbnail_JPG` and `thumbnail_QOI`
 * blocks must report image/png, image/jpeg and image/qoi respectively; a begin/end variant
 * mismatch is dropped fail-closed.
 */
import { describe, expect, it } from 'vitest';
import { ThumbnailCollector } from '../annotate';
import type { AnnotationSink } from '../sink';

interface Got {
  width: number;
  height: number;
  mime: string;
  bytes: number[];
}

function run(lines: string[]): Got[] {
  const got: Got[] = [];
  const sink = {
    addThumbnail: (t: { width: number; height: number; mime: string; bytes: Uint8Array }) =>
      got.push({ width: t.width, height: t.height, mime: t.mime, bytes: Array.from(t.bytes) })
  } as unknown as AnnotationSink;
  const c = new ThumbnailCollector();
  for (const l of lines) c.feed(l, sink);
  return got;
}

// "AAEC" decodes to bytes [0, 1, 2]; "AwQF" to [3, 4, 5]; "BgcI" to [6, 7, 8].
describe('thumbnail comment mime (#487)', () => {
  it('plain thumbnail is image/png', () => {
    expect(run([' thumbnail begin 16x16 4', ' AAEC', ' thumbnail end'])).toEqual([
      { width: 16, height: 16, mime: 'image/png', bytes: [0, 1, 2] }
    ]);
  });

  it('thumbnail_JPG is image/jpeg', () => {
    expect(run([' thumbnail_JPG begin 16x8 4', ' AAEC', ' thumbnail_JPG end'])).toEqual([
      { width: 16, height: 8, mime: 'image/jpeg', bytes: [0, 1, 2] }
    ]);
  });

  it('thumbnail_QOI is image/qoi', () => {
    expect(run([' thumbnail_QOI begin 8x8 4', ' AAEC', ' thumbnail_QOI end'])).toEqual([
      { width: 8, height: 8, mime: 'image/qoi', bytes: [0, 1, 2] }
    ]);
  });

  it('a mixed file keeps order and per-block mimes', () => {
    const got = run([
      ' thumbnail begin 16x16 4',
      ' AAEC',
      ' thumbnail end',
      ' thumbnail_JPG begin 32x32 4',
      ' AwQF',
      ' thumbnail_JPG end',
      ' thumbnail_QOI begin 48x48 4',
      ' BgcI',
      ' thumbnail_QOI end'
    ]);
    expect(got.map((g) => g.mime)).toEqual(['image/png', 'image/jpeg', 'image/qoi']);
    expect(got.map((g) => g.width)).toEqual([16, 32, 48]);
    expect(got.map((g) => g.bytes)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8]
    ]);
  });

  it('matches the variant case-insensitively', () => {
    expect(run(['THUMBNAIL_jpg begin 4x4 4', 'AAEC', 'THUMBNAIL_jpg END'])[0]?.mime).toBe('image/jpeg');
    expect(run(['Thumbnail_qoi begin 4x4 4', 'AAEC', 'thumbnail_QOI end'])[0]?.mime).toBe('image/qoi');
  });

  it('drops a block whose end variant differs from its begin variant', () => {
    expect(run([' thumbnail_JPG begin 4x4 4', ' AAEC', ' thumbnail end'])).toEqual([]);
    expect(run([' thumbnail begin 4x4 4', ' AAEC', ' thumbnail_QOI end'])).toEqual([]);
    expect(run([' thumbnail_JPG begin 4x4 4', ' AAEC', ' thumbnail_QOI end'])).toEqual([]);
  });

  it('a dropped mismatched block does not poison the next valid block', () => {
    const got = run([
      ' thumbnail_JPG begin 4x4 4',
      ' AAEC',
      ' thumbnail end',
      ' thumbnail_QOI begin 8x8 4',
      ' AwQF',
      ' thumbnail_QOI end'
    ]);
    expect(got).toEqual([{ width: 8, height: 8, mime: 'image/qoi', bytes: [3, 4, 5] }]);
  });
});
