/**
 * Container pipeline integration (DD-005 §4.4, issue #74): .gcode.3mf through
 * the worker/session — sniff, plate lifecycle, machine metadata to the result,
 * structured container errors, and honest degradation without adapters.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGcode3mf, sniffGcode3mf } from '@chestnutlabs/gcode-containers';
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
