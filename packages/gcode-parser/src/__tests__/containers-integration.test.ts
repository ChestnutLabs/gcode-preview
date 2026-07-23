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
    session.dispose();
  });

  it('{plate: 1} selects the second plate without the warning', async () => {
    const session = new GcodeParseSession({ worker: loopbackWorker({ containers: CONTAINERS }) });
    const result = await session.parse(load('mini-project.gcode.3mf'), { yieldIntervalMs: 5, plate: 1 });
    expect(result.ir.segments.count).toBe(251);
    expect(result.ir.header.warnings.some((w) => w.code === 'container-multiple-plates')).toBe(false);
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
