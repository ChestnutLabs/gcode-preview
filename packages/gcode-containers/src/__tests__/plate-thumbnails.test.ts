/**
 * `.gcode.3mf` plate thumbnails (#483): `thumbnailsFor(plate)` reads `plate_N.png` then `plate_N_small.png`,
 * never `top_N`/`pick_N`; the argument is the plate INDEX; reads draw on the shared archive budget AFTER the
 * G-code; a bad image is dropped with a warning, never thrown. Expected values are literal.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONTAINER_LIMITS, openGcode3mf } from '../index';
import { readPngSize } from '../png';
import { buildZip, refCrc32 } from './zip-builder';

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../test-data/fixtures/containers'
);
const load = (name: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(fixtureDir, name)));

/** A 24-byte-minimum PNG prefix: signature + IHDR chunk header + width + height (+ `extra` filler bytes). */
function png(width: number, height: number, extra = 0): Uint8Array {
  const b = new Uint8Array(24 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

const GCODE = 'G1 X1 Y1 E1\n'.repeat(10);

async function drain(stream: { getReader(): { read(): Promise<{ done: boolean }> } }): Promise<void> {
  const r = stream.getReader();
  while (!(await r.read()).done) {
    /* consume */
  }
}

describe('thumbnailsFor on the synthetic mini-thumbs fixture', () => {
  it('is the fixture the manifest pins', () => {
    expect(createHash('sha256').update(load('mini-thumbs.gcode.3mf')).digest('hex')).toBe(
      'ae8638cd4e89d34ec4fcf3e987d372cbcbf28a58df0cd3dfa25164f0b41a2801'
    );
  });

  it('plate index 0 → plate_1.png (4x3) then plate_1_small.png (2x1); top_/pick_ are ignored', async () => {
    const opened = await openGcode3mf(load('mini-thumbs.gcode.3mf'));
    const r = await opened.thumbnailsFor(0);
    expect(r.warnings).toEqual([]);
    expect(r.thumbnails.map((t) => [t.format, t.width, t.height])).toEqual([
      ['png', 4, 3],
      ['png', 2, 1]
    ]);
    // the real image bytes, not a decoy: each starts with the PNG signature and re-parses to its own size
    expect(Array.from(r.thumbnails[0].bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(readPngSize(r.thumbnails[1].bytes)).toEqual({ width: 2, height: 1 });
  });

  it('plate index 1 of a file holding plates 1 and 3 (stored out of order) → plate_3.png (8x6) + small (4x3)', async () => {
    const opened = await openGcode3mf(load('mini-thumbs.gcode.3mf'));
    expect(opened.plates.map((p) => p.name)).toEqual(['Metadata/plate_1.gcode', 'Metadata/plate_3.gcode']);
    const r = await opened.thumbnailsFor(1);
    expect(r.warnings).toEqual([]);
    expect(r.thumbnails.map((t) => [t.width, t.height])).toEqual([
      [8, 6],
      [4, 3]
    ]);
  });

  it('an index outside the plates returns nothing (no throw, no warning)', async () => {
    const opened = await openGcode3mf(load('mini-thumbs.gcode.3mf'));
    for (const i of [-1, 2, 99, 0.5, NaN]) {
      expect(await opened.thumbnailsFor(i)).toEqual({ thumbnails: [], warnings: [] });
    }
  });

  it('every call returns fresh bytes (a transferred buffer cannot poison the next call)', async () => {
    const opened = await openGcode3mf(load('mini-thumbs.gcode.3mf'));
    const a = await opened.thumbnailsFor(0);
    const b = await opened.thumbnailsFor(0);
    expect(a.thumbnails[0].bytes.buffer).not.toBe(b.thumbnails[0].bytes.buffer);
    a.thumbnails[0].bytes.fill(0);
    expect(readPngSize(b.thumbnails[0].bytes)).toEqual({ width: 4, height: 3 });
  });

  it('a plate with no images returns nothing and no warning', async () => {
    const opened = await openGcode3mf(load('mini-project.gcode.3mf'));
    expect(await opened.thumbnailsFor(0)).toEqual({ thumbnails: [], warnings: [] });
  });
});

describe('thumbnailsFor budget, caps and bad images', () => {
  const settingsless = (imageEntries: { name: string; data: Uint8Array; deflate?: boolean }[]): Uint8Array =>
    buildZip([{ name: 'Metadata/plate_1.gcode', data: GCODE }, ...imageEntries]).bytes;

  it('images that would exhaust the remaining total never starve the G-code: it loads, the images drop with a warning', async () => {
    const img = png(4, 3, 100); // 124 B
    const bytes = settingsless([{ name: 'Metadata/plate_1.png', data: img }]);
    const total = GCODE.length + img.length - 1;
    const opened = await openGcode3mf(bytes, { maxExpandedBytesTotal: total });
    await drain(opened.openPlate(0)); // the G-code is read first, in full
    const r = await opened.thumbnailsFor(0);
    expect(r.thumbnails).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].code).toBe('metadata-truncated');
    expect(r.warnings[0].message).toBe(
      `Metadata/plate_1.png unreadable: entry 'metadata/plate_1.png' claims 124 B, past the archive's ${total} B expanded total`
    );
  });

  it('control: the same archive with one more byte of budget keeps the image', async () => {
    const img = png(4, 3, 100);
    const bytes = settingsless([{ name: 'Metadata/plate_1.png', data: img }]);
    const opened = await openGcode3mf(bytes, { maxExpandedBytesTotal: GCODE.length + img.length });
    await drain(opened.openPlate(0));
    const r = await opened.thumbnailsFor(0);
    expect(r.warnings).toEqual([]);
    expect(r.thumbnails.map((t) => [t.width, t.height, t.bytes.length])).toEqual([[4, 3, 124]]);
  });

  it('an image over maxMetadataBytes is skipped before it is read (metadata-truncated)', async () => {
    const img = png(4, 3, 100);
    // the valid 24 B small image (under the cap) must survive the oversize one before it
    const opened = await openGcode3mf(
      settingsless([
        { name: 'Metadata/plate_1.png', data: img },
        { name: 'Metadata/plate_1_small.png', data: png(2, 1) }
      ]),
      { maxMetadataBytes: img.length - 1 }
    );
    const r = await opened.thumbnailsFor(0);
    expect(r.thumbnails.map((t) => [t.width, t.height])).toEqual([[2, 1]]);
    expect(r.warnings).toEqual([
      { code: 'metadata-truncated', message: 'Metadata/plate_1.png exceeds maxMetadataBytes; skipped' }
    ]);
  });

  it('an image exactly at maxMetadataBytes is kept', async () => {
    const img = png(4, 3, 100);
    const opened = await openGcode3mf(settingsless([{ name: 'Metadata/plate_1.png', data: img }]), {
      maxMetadataBytes: img.length
    });
    expect((await opened.thumbnailsFor(0)).thumbnails).toHaveLength(1);
  });

  it('a header that lies small but inflates past the cap is dropped with a warning', async () => {
    const big = png(4, 3, 4000); // deflates tiny, inflates to 4024 B
    const bytes = buildZip([
      { name: 'Metadata/plate_1.gcode', data: GCODE },
      {
        name: 'Metadata/plate_1.png',
        data: big,
        deflate: true,
        local: { uncompressedSize: 50 },
        central: { uncompressedSize: 50 }
      }
    ]).bytes;
    const opened = await openGcode3mf(bytes, { maxMetadataBytes: 100 });
    const r = await opened.thumbnailsFor(0);
    expect(r.thumbnails).toEqual([]);
    expect(r.warnings).toEqual([
      {
        code: 'container-thumbnail-invalid',
        message:
          "Metadata/plate_1.png unreadable: entry 'metadata/plate_1.png' expanded past 100 B — headers lied; extraction stopped"
      }
    ]);
  });

  it('a CRC-failing image is dropped; the intact image beside it is kept', async () => {
    const good = png(2, 1);
    const bad = png(4, 3);
    // the first image's stored CRC is wrong in BOTH headers
    const zip = buildZip([
      { name: 'Metadata/plate_1.gcode', data: GCODE },
      {
        name: 'Metadata/plate_1.png',
        data: bad,
        local: { crc: refCrc32(bad) ^ 1 },
        central: { crc: refCrc32(bad) ^ 1 }
      },
      { name: 'Metadata/plate_1_small.png', data: good }
    ]).bytes;
    const r = await (await openGcode3mf(zip)).thumbnailsFor(0);
    expect(r.thumbnails.map((t) => [t.width, t.height])).toEqual([[2, 1]]);
    expect(r.warnings).toEqual([
      {
        code: 'container-thumbnail-invalid',
        message: "Metadata/plate_1.png unreadable: CRC mismatch for 'metadata/plate_1.png'"
      }
    ]);
  });

  it.each([
    ['empty', new Uint8Array(0)],
    ['truncated to 10 bytes', png(4, 3).subarray(0, 10)],
    ['text, not an image', new TextEncoder().encode('this is definitely not a png, it is text!')]
  ])('a %s image is dropped with a warning, not thrown', async (_label, data) => {
    const opened = await openGcode3mf(
      settingsless([
        { name: 'Metadata/plate_1.png', data },
        { name: 'Metadata/plate_1_small.png', data: png(2, 1) }
      ])
    );
    const r = await opened.thumbnailsFor(0);
    expect(r.thumbnails.map((t) => [t.width, t.height])).toEqual([[2, 1]]);
    expect(r.warnings).toEqual([
      {
        code: 'container-thumbnail-invalid',
        message: 'Metadata/plate_1.png is not a PNG with a valid header; skipped'
      }
    ]);
  });
});

describe('readPngSize (IHDR probe)', () => {
  it('reads width and height; accepts 24 bytes exactly and the 1 / 2^31-1 bounds', () => {
    expect(readPngSize(png(4, 3))).toEqual({ width: 4, height: 3 });
    expect(readPngSize(png(1, 1))).toEqual({ width: 1, height: 1 });
    expect(readPngSize(png(0x7fffffff, 0x7fffffff))).toEqual({ width: 2147483647, height: 2147483647 });
    expect(readPngSize(png(300, 70000))).toEqual({ width: 300, height: 70000 });
  });

  it('honours a subarray view (byteOffset is respected)', () => {
    const wrapped = new Uint8Array(40);
    wrapped.set(png(7, 9), 5);
    expect(readPngSize(wrapped.subarray(5, 29))).toEqual({ width: 7, height: 9 });
  });

  it('rejects anything shorter than 24 bytes', () => {
    expect(readPngSize(png(4, 3).subarray(0, 23))).toBeNull();
    expect(readPngSize(png(4, 3).subarray(0, 8))).toBeNull();
    expect(readPngSize(new Uint8Array(0))).toBeNull();
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7])('rejects a wrong signature byte at offset %i', (i) => {
    const b = png(4, 3);
    b[i] ^= 0xff;
    expect(readPngSize(b)).toBeNull();
  });

  it.each([12, 13, 14, 15])('rejects a wrong first-chunk-name byte at offset %i', (i) => {
    const b = png(4, 3);
    b[i] ^= 0x20; // IHDR → ihdr-ish
    expect(readPngSize(b)).toBeNull();
  });

  it('rejects an IHDR chunk whose length field is not 13', () => {
    for (const len of [0, 12, 14, 0x0d000000]) {
      const b = png(4, 3);
      new DataView(b.buffer).setUint32(8, len);
      expect(readPngSize(b)).toBeNull();
    }
    const ok = png(4, 3);
    new DataView(ok.buffer).setUint32(8, 13);
    expect(readPngSize(ok)).toEqual({ width: 4, height: 3 });
  });

  it('rejects a zero or out-of-range width/height', () => {
    expect(readPngSize(png(0, 3))).toBeNull();
    expect(readPngSize(png(4, 0))).toBeNull();
    expect(readPngSize(png(0x80000000, 3))).toBeNull();
    expect(readPngSize(png(4, 0x80000000))).toBeNull();
    expect(readPngSize(png(0xffffffff, 0xffffffff))).toBeNull();
  });
});

describe('thumbnail limits are the container defaults', () => {
  it('maxMetadataBytes is 8 MiB (the per-image cap)', () => {
    expect(DEFAULT_CONTAINER_LIMITS.maxMetadataBytes).toBe(8388608);
  });
});
