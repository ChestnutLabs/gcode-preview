/**
 * Container pipeline integration (DD-005 §4.4, issue #74): .gcode.3mf through
 * the worker/session — sniff, plate lifecycle, machine metadata to the result,
 * structured container errors, and honest degradation without adapters.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONTAINER_LIMITS, openGcode3mf, readDirectory, sniffGcode3mf } from '@chestnutlabs/gcode-containers';
import { openBgcodeContainer, sniffBgcode } from '@chestnutlabs/gcode-bgcode';
import { createDialectRunner, orcaBambu, prusaSlicer } from '@chestnutlabs/gcode-dialects';
import { FeatureRole } from '@chestnutlabs/toolpath-core';
import { createWorkerHandler, type WorkerHandlerOptions } from '../worker-core';
import { GcodeParseSession, ParseSessionError, type WorkerLike } from '../session';
import type { WorkerRequest } from '../protocol';

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../test-data/fixtures/containers'
);
const load = (name: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(fixtureDir, name)));

const CONTAINERS: WorkerHandlerOptions['containers'] = [
  { id: 'gcode-3mf', sniff: sniffGcode3mf, open: (bytes) => openGcode3mf(bytes) }
];

function loopbackWorker(opts?: WorkerHandlerOptions): WorkerLike {
  const w: WorkerLike = { onmessage: null, onerror: null, postMessage: () => undefined, terminate: () => undefined };
  const handler = createWorkerHandler((msg) => {
    void Promise.resolve().then(() => w.onmessage?.({ data: msg }));
  }, opts);
  w.postMessage = (m: unknown) => handler(m as WorkerRequest);
  return w;
}

describe('.gcode.3mf through the worker pipeline (#74)', () => {
  it('parses plate 0 by default with the multi-plate warning + machine metadata (known)', async () => {
    const session = new GcodeParseSession({ worker: loopbackWorker({ containers: CONTAINERS }) });
    const result = await session.parse(load('mini-project.gcode.3mf'), { yieldIntervalMs: 5 });
    expect(result.ir.header.complete).toBe(true);
    expect(result.ir.segments.count).toBe(401); // plate 1: 400 G1 moves + initial G0
    const warn = result.ir.header.warnings.find((w) => w.code === 'container-multiple-plates');
    expect(warn).toBeDefined();
    expect(warn?.message).toContain('plate_2.gcode');
    expect(result.metadata?.machine?.bed).toEqual({ kind: 'rect', min: { x: 0, y: 0 }, max: { x: 256, y: 256 } });
    expect(result.metadata?.machine?.confidence).toBe('known');
    expect(result.metadata?.filaments?.length).toBe(2);
    expect(result.metadata?.raw?.['printer_model']).toBe('Chestnut Test Printer X1');
    // Structured plate list (#306/#3): consumer can build a selector without scraping the warning.
    expect(result.metadata?.plates?.list.map((p) => p.name)).toEqual([
      'Metadata/plate_1.gcode',
      'Metadata/plate_2.gcode'
    ]);
    expect(result.metadata?.plates?.parsed).toBe(0);
    session.dispose();
  });

  it('{plate: 1} selects the second plate without the warning', async () => {
    const session = new GcodeParseSession({ worker: loopbackWorker({ containers: CONTAINERS }) });
    const result = await session.parse(load('mini-project.gcode.3mf'), { yieldIntervalMs: 5, plate: 1 });
    expect(result.ir.segments.count).toBe(251);
    expect(result.ir.header.warnings.some((w) => w.code === 'container-multiple-plates')).toBe(false);
    expect(result.metadata?.plates?.parsed).toBe(1); // structured list reflects the selected plate (#306/#3)
    expect(result.metadata?.plates?.list).toHaveLength(2);
    session.dispose();

    const session2 = new GcodeParseSession({ worker: loopbackWorker({ containers: CONTAINERS }) });
    await expect(session2.parse(load('mini-project.gcode.3mf'), { yieldIntervalMs: 5, plate: 9 })).rejects.toThrow(
      ParseSessionError
    );
    session2.dispose();
  });

  it('container integrity failures surface as structured session errors', async () => {
    for (const [fixture, code] of [
      ['adv-bad-crc.gcode.3mf', 'E_CONTAINER_CRC'],
      ['adv-duplicate-plate.gcode.3mf', 'E_CONTAINER_DUPLICATE'],
      ['adv-truncated.gcode.3mf', 'E_CONTAINER_FORMAT']
    ] as const) {
      const session = new GcodeParseSession({ worker: loopbackWorker({ containers: CONTAINERS }) });
      let err: unknown;
      try {
        await session.parse(load(fixture), { yieldIntervalMs: 5 });
      } catch (e) {
        err = e;
      }
      expect(err, fixture).toBeInstanceOf(ParseSessionError);
      // Structured codes survive both open-time and mid-stream failure paths.
      expect((err as ParseSessionError).code, fixture).toBe(code);
      session.dispose();
    }
  });

  it('COMPOSITION (#75): container machine (known) + dialect feature annotation together', async () => {
    // Batteries-equivalent worker: container adapter + phase-3 dialect adapters.
    const session = new GcodeParseSession({
      worker: loopbackWorker({ containers: CONTAINERS, dialects: createDialectRunner([prusaSlicer(), orcaBambu()]) })
    });
    const result = await session.parse(load('mini-project.gcode.3mf'), { yieldIntervalMs: 5 });
    // Dialect detected FROM CONTAINER METADATA (plate stream has no head window);
    // FEATURE comments annotated during the streaming parse.
    expect(result.metadata?.dialects?.[0]).toMatchObject({ dialectId: 'orca-bambu' });
    expect(result.ir.header.capabilities.featureRoles).toBe('known');
    const roles = new Set(Array.from(result.ir.segments.feature));
    expect(roles.has(FeatureRole.ExternalPerimeter)).toBe(true);
    expect(roles.has(FeatureRole.Infill)).toBe(true);
    // Machine geometry comes from the CONTAINER config ('known') — outranks comment inference.
    expect(result.metadata?.machine?.confidence).toBe('known');
    expect(result.metadata?.machine?.source.adapterId).toBe('gcode-3mf');
    // Filament MERGE: both the dialect (gcode `; filament_colour/type`) and the container
    // (project_settings.config) declare the same 2 slots — must dedupe by slot, not concatenate
    // into 4 (`[0,0,1,1]`, which broke palette-by-tool indexing downstream).
    expect(result.metadata?.filaments?.map((f) => f.slot)).toEqual([0, 1]);
    expect(result.metadata?.filaments).toHaveLength(2);
    session.dispose();
  });

  it('explicit consumer partialPreview settings WIN over the container 8MiB default (#78)', async () => {
    const session = new GcodeParseSession({ worker: loopbackWorker({ containers: CONTAINERS }) });
    let partials = 0;
    session.onPartial(() => partials++);
    // Consumer explicitly demands a huge threshold: the container default must NOT override it.
    await session.parse(load('mini-project.gcode.3mf'), {
      yieldIntervalMs: 5,
      partialPreview: { minInputBytes: Number.MAX_SAFE_INTEGER, intervalMs: 0 }
    });
    expect(partials).toBe(0);
    session.dispose();
  });

  it('containers:false parses the raw bytes as G-code (honest failure, no sniffing)', async () => {
    const session = new GcodeParseSession({ worker: loopbackWorker({ containers: CONTAINERS }) });
    const result = await session.parse(load('mini-project.gcode.3mf'), { yieldIntervalMs: 5, containers: false });
    // ZIP bytes are not G-code: parse "succeeds" with zero segments — no magic.
    expect(result.ir.segments.count).toBe(0);
    expect(result.metadata).toBeUndefined();
    session.dispose();
  });

  it('worker without container adapters ignores containers entirely (slim behavior)', async () => {
    const session = new GcodeParseSession({ worker: loopbackWorker() });
    const result = await session.parse(load('mini-project.gcode.3mf'), { yieldIntervalMs: 5 });
    expect(result.ir.segments.count).toBe(0);
    expect(result.metadata).toBeUndefined();
    session.dispose();
  });
});

describe('.bgcode through the worker pipeline (#188)', () => {
  const bgcodeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../test-data/fixtures/bgcode');
  const BGCODE: WorkerHandlerOptions['containers'] = [
    { id: 'bgcode', sniff: (prefix) => sniffBgcode(prefix), open: (bytes) => openBgcodeContainer(bytes) }
  ];

  it('sniffs + decodes a real Prusa .bgcode → the same IR as the plain .gcode + machine metadata', async () => {
    const session = new GcodeParseSession({ worker: loopbackWorker({ containers: BGCODE }) });
    const bytes = new Uint8Array(fs.readFileSync(path.join(bgcodeDir, 'prim-cube.bgcode')));
    const result = await session.parse(bytes, { yieldIntervalMs: 5 });
    expect(result.ir.header.complete).toBe(true);
    // Same segment count the golden-equivalence test pins against the plain .gcode.
    expect(result.ir.segments.count).toBe(11417);
    // Machine geometry surfaced from the container's decoded metadata blocks (bed_shape).
    expect(result.metadata?.machine?.bed).toEqual({ kind: 'rect', min: { x: 0, y: 0 }, max: { x: 360, y: 360 } });
    expect(result.metadata?.machine?.printerName).toBe('XL2IS');
    expect(result.metadata?.machine?.confidence).toBe('inferred');
    expect(result.metadata?.raw?.['printer_model']).toBe('XL2IS');
    expect(result.metadata?.raw?.['Producer']).toContain('PrusaSlicer');
    session.dispose();
  });

  it('a worker without the bgcode adapter does not decode it (honest — no adapter, no magic)', async () => {
    const session = new GcodeParseSession({ worker: loopbackWorker({ containers: CONTAINERS }) }); // only 3mf
    const bytes = new Uint8Array(fs.readFileSync(path.join(bgcodeDir, 'prim-cube.bgcode')));
    const result = await session.parse(bytes, { yieldIntervalMs: 5 });
    // Binary bytes fed to the raw parser → at most a few spurious moves from byte noise, nowhere near
    // the real 11417-segment decode; never a crash.
    expect(result.ir.segments.count).toBeLessThan(100);
    session.dispose();
  });
});

describe('.bgcode thumbnails reach metadata.thumbnails (#433)', () => {
  const bgcodeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../test-data/fixtures/bgcode');
  const BGCODE: WorkerHandlerOptions['containers'] = [
    { id: 'bgcode', sniff: (prefix) => sniffBgcode(prefix), open: (bytes) => openBgcodeContainer(bytes) }
  ];
  const sha16 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex').slice(0, 16);

  /** A no-CRC `.bgcode` v1 file: None-compressed thumbnail blocks (`[format, w, h, size]`) then one G-code block. */
  function bgcodeFile(thumbs: [number, number, number, number][], gcode = 'G1 X1 Y1\n'): Uint8Array {
    const g = new TextEncoder().encode(gcode);
    const size = 10 + thumbs.reduce((n, t) => n + 14 + t[3], 0) + 10 + g.length;
    const f = new Uint8Array(size);
    const v = new DataView(f.buffer);
    f.set([0x47, 0x43, 0x44, 0x45], 0); // "GCDE"
    v.setUint32(4, 1, true); // version 1
    v.setUint16(8, 0, true); // no checksum
    let o = 10;
    for (const [format, w, h, n] of thumbs) {
      v.setUint16(o, 5, true); // Thumbnail block
      v.setUint16(o + 2, 0, true); // None compression
      v.setUint32(o + 4, n, true);
      v.setUint16(o + 8, format, true);
      v.setUint16(o + 10, w, true);
      v.setUint16(o + 12, h, true);
      f.fill(w & 0xff, o + 14, o + 14 + n); // payload = the width byte, so each thumbnail is identifiable
      o += 14 + n;
    }
    v.setUint16(o, 1, true); // GCode block
    v.setUint16(o + 2, 0, true);
    v.setUint32(o + 4, g.length, true);
    v.setUint16(o + 8, 0, true); // encoding None
    f.set(g, o + 10);
    return f;
  }

  /** A dialect run that reports one `; thumbnail`-comment thumbnail (what prusaSlicer/orcaBambu emit). */
  const commentThumbDialect = (): WorkerHandlerOptions['dialects'] => ({
    adapterIds: ['stub'],
    createRun: () => ({
      onComment: () => undefined,
      onCommand: () => undefined,
      finalize: () => ({
        metadata: { thumbnails: [{ width: 3, height: 3, mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }] },
        warnings: []
      })
    })
  });

  async function parseBgcode(bytes: Uint8Array, opts: WorkerHandlerOptions) {
    const session = new GcodeParseSession({ worker: loopbackWorker(opts) });
    try {
      return await session.parse(bytes, { yieldIntervalMs: 5 });
    } finally {
      session.dispose();
    }
  }

  it('a real PrusaSlicer .bgcode surfaces its 4 thumbnails, byte-exact, in file order', async () => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(bgcodeDir, 'prim-cube.bgcode')));
    const result = await parseBgcode(bytes, { containers: BGCODE });
    const thumbs = result.metadata?.thumbnails ?? [];
    expect(thumbs.map((t) => [t.mime, t.width, t.height, t.bytes.length])).toEqual([
      ['image/qoi', 16, 16, 433],
      ['image/qoi', 313, 173, 25120],
      ['image/qoi', 480, 240, 46906],
      ['image/png', 380, 285, 27364]
    ]);
    expect(Array.from(thumbs[3].bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic
    expect(Array.from(thumbs[0].bytes.subarray(0, 4))).toEqual([113, 111, 105, 102]); // "qoif"
    expect(thumbs.map((t) => sha16(t.bytes))).toEqual([
      'bfa581284d73500f',
      '65698c2bc3fe3ae0',
      'e0e3266bac7293c6',
      '7e7e5d96b52a607a'
    ]);
  });

  it('thumbnail buffers ride the done message as transferables', async () => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(bgcodeDir, 'prim-cube.bgcode')));
    const done = await new Promise<{ msg: unknown; transfer: ArrayBuffer[] }>((resolve) => {
      const handler = createWorkerHandler(
        (msg, transfer) => {
          if (msg.type === 'done' || msg.type === 'error') resolve({ msg, transfer: transfer ?? [] });
        },
        { containers: BGCODE }
      );
      handler({ v: 1, type: 'parse', id: 1, input: bytes, opts: { yieldIntervalMs: 5 } } as WorkerRequest);
    });
    const msg = done.msg as { type: string; metadata?: { thumbnails?: { bytes: Uint8Array }[] } };
    expect(msg.type).toBe('done');
    const thumbs = msg.metadata?.thumbnails ?? [];
    expect(thumbs.length).toBe(4);
    for (const t of thumbs) expect(done.transfer).toContain(t.bytes.buffer);
  });

  it('maps every format to a MIME type and drops empty thumbnails', async () => {
    // jpg, png, qoi, an empty png (dropped), and an out-of-spec format id 9 (kept, honestly untyped).
    const file = bgcodeFile([
      [1, 11, 1, 4],
      [0, 12, 1, 5],
      [2, 13, 1, 6],
      [0, 14, 1, 0],
      [9, 15, 1, 7]
    ]);
    const result = await parseBgcode(file, { containers: BGCODE });
    expect(result.ir.segments.count).toBe(1);
    expect((result.metadata?.thumbnails ?? []).map((t) => [t.mime, t.width, t.height, Array.from(t.bytes)])).toEqual([
      ['image/jpeg', 11, 1, [11, 11, 11, 11]],
      ['image/png', 12, 1, [12, 12, 12, 12, 12]],
      ['image/qoi', 13, 1, [13, 13, 13, 13, 13, 13]],
      ['application/octet-stream', 15, 1, [15, 15, 15, 15, 15, 15, 15]]
    ]);
  });

  it('keeps at most 8 container thumbnails, the first 8 in file order', async () => {
    const file = bgcodeFile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((w): [number, number, number, number] => [0, w, 1, 2]));
    const result = await parseBgcode(file, { containers: BGCODE });
    expect((result.metadata?.thumbnails ?? []).map((t) => t.width)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('an empty thumbnail does not use up one of the 8 slots (first, or right at the boundary)', async () => {
    const t = (w: number, n = 2): [number, number, number, number] => [0, w, 1, n];
    const first = bgcodeFile([t(1, 0), t(2), t(3), t(4), t(5), t(6), t(7), t(8), t(9), t(10)]);
    const r1 = await parseBgcode(first, { containers: BGCODE });
    expect((r1.metadata?.thumbnails ?? []).map((x) => x.width)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    // Seven kept, then an empty one: the 8th slot still goes to the next real thumbnail (9).
    const boundary = bgcodeFile([t(1), t(2), t(3), t(4), t(5), t(6), t(7), t(99, 0), t(9), t(10)]);
    const r2 = await parseBgcode(boundary, { containers: BGCODE });
    expect((r2.metadata?.thumbnails ?? []).map((x) => x.width)).toEqual([1, 2, 3, 4, 5, 6, 7, 9]);
  });

  it('precedence: container thumbnails come first, `; thumbnail` comment thumbnails are kept after them', async () => {
    const file = bgcodeFile([[0, 20, 10, 3]]);
    const result = await parseBgcode(file, { containers: BGCODE, dialects: commentThumbDialect() });
    expect((result.metadata?.thumbnails ?? []).map((t) => [t.mime, t.width, Array.from(t.bytes)])).toEqual([
      ['image/png', 20, [20, 20, 20]],
      ['image/png', 3, [1, 2, 3]]
    ]);
  });

  it('a .bgcode without thumbnail blocks leaves comment thumbnails alone, and adds none of its own', async () => {
    const withComments = await parseBgcode(bgcodeFile([]), { containers: BGCODE, dialects: commentThumbDialect() });
    expect((withComments.metadata?.thumbnails ?? []).map((t) => [t.width, Array.from(t.bytes)])).toEqual([
      [3, [1, 2, 3]]
    ]);
    const bare = await parseBgcode(bgcodeFile([]), { containers: BGCODE });
    expect(bare.metadata?.thumbnails).toBeUndefined();
  });

  it('the 32 MiB metadata/thumbnail budget still applies on this path', async () => {
    const atBudget = await parseBgcode(bgcodeFile([[0, 64, 64, 33554432]]), { containers: BGCODE });
    expect((atBudget.metadata?.thumbnails ?? []).map((t) => t.bytes.length)).toEqual([33554432]);

    let err: unknown;
    try {
      await parseBgcode(bgcodeFile([[0, 64, 64, 33554433]]), { containers: BGCODE });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ParseSessionError);
    expect((err as ParseSessionError).code).toBe('E_BGCODE_BOMB');
    expect((err as ParseSessionError).message).toBe('metadata/thumbnail blocks exceed the internal budget (33554433)');
  });
});

describe('.gcode.3mf plate thumbnails through the worker (#483)', () => {
  const dims = (r: { metadata?: { thumbnails?: { width: number; height: number; mime: string }[] } }): string[] =>
    (r.metadata?.thumbnails ?? []).map((t) => `${t.mime} ${t.width}x${t.height}`);
  const parse = async (
    containers: WorkerHandlerOptions['containers'],
    opts: { plate?: number } = {}
  ): Promise<Awaited<ReturnType<GcodeParseSession['parse']>>> => {
    const session = new GcodeParseSession({ worker: loopbackWorker({ containers }) });
    try {
      return await session.parse(load('mini-thumbs.gcode.3mf'), { yieldIntervalMs: 5, ...opts });
    } finally {
      session.dispose();
    }
  };

  it('no plate selected → the first plate images; {plate: 1} → the second plate (plate_3) images', async () => {
    const first = await parse(CONTAINERS);
    expect(dims(first)).toEqual(['image/png 4x3', 'image/png 2x1']);
    expect(first.metadata?.plates?.parsed).toBe(0);
    const second = await parse(CONTAINERS, { plate: 1 });
    expect(dims(second)).toEqual(['image/png 8x6', 'image/png 4x3']);
    expect(second.metadata?.plates?.parsed).toBe(1);
    expect(second.ir.segments.count).toBe(121); // plate_3.gcode: 120 G1 moves + initial G0
  });

  it('a budget that cannot hold the images still loads the G-code and drops them with a warning', async () => {
    const bytes = load('mini-thumbs.gcode.3mf');
    const sizes = new Map(
      readDirectory(bytes, DEFAULT_CONTAINER_LIMITS).entries.map((e) => [e.name, e.uncompressedSize])
    );
    const need = (n: string): number => sizes.get(n) as number;
    // settings + plate 1 G-code fit, but not plate_1.png on top of them
    const total =
      need('metadata/project_settings.config') + need('metadata/plate_1.gcode') + need('metadata/plate_1.png') - 1;
    const tight: WorkerHandlerOptions['containers'] = [
      { id: 'gcode-3mf', sniff: sniffGcode3mf, open: (b) => openGcode3mf(b, { maxExpandedBytesTotal: total }) }
    ];
    const r = await parse(tight);
    expect(r.ir.header.complete).toBe(true);
    expect(r.ir.segments.count).toBe(201); // plate_1.gcode: 200 G1 moves + initial G0
    expect(dims(r)).toEqual(['image/png 2x1']); // the small image still fits; the big one does not
    expect(r.ir.header.warnings.filter((x) => x.code === 'container-thumbnail-invalid')).toEqual([]);
    const w = r.ir.header.warnings.filter((x) => x.code === 'metadata-truncated');
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain('Metadata/plate_1.png unreadable');
    expect(w[0].severity).toBe('warn');
  });

  it('a thumbnailsFor that throws costs the images, never the parse', async () => {
    const throwing: WorkerHandlerOptions['containers'] = [
      {
        id: 'gcode-3mf',
        sniff: sniffGcode3mf,
        open: async (b) => ({
          ...(await openGcode3mf(b)),
          // a plain field that must NOT be used as a fallback once thumbnailsFor has thrown
          thumbnails: [{ format: 'png', width: 9, height: 9, bytes: new Uint8Array([1]) }],
          thumbnailsFor: () => Promise.reject(new Error('boom'))
        })
      }
    ];
    const r = await parse(throwing);
    expect(r.ir.header.complete).toBe(true);
    expect(r.metadata?.thumbnails).toBeUndefined();
    expect(r.ir.header.warnings.find((x) => x.code === 'container-thumbnail-invalid')?.message).toBe(
      'thumbnails unreadable: boom'
    );
  });

  it('a container without thumbnailsFor keeps using its plain thumbnails field', async () => {
    const plain: WorkerHandlerOptions['containers'] = [
      {
        id: 'gcode-3mf',
        sniff: sniffGcode3mf,
        open: async (b) => {
          const { thumbnailsFor: _unused, ...rest } = await openGcode3mf(b);
          void _unused;
          return { ...rest, thumbnails: [{ format: 'jpg', width: 3, height: 2, bytes: new Uint8Array([1, 2, 3]) }] };
        }
      }
    ];
    expect(dims(await parse(plain))).toEqual(['image/jpeg 3x2']);
  });
});
