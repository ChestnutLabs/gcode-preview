/**
 * #508: ParseLimits values are validated before parsing. A NaN bound used to switch the limit off
 * (`x > NaN` is never true), which brought back the RS274NGC `o1 while [1]` hang. Every test input here
 * is a tiny terminating program, so a regression fails with a plain assertion, never a timeout.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  GcodeParseSession,
  ParseOptionError,
  parseGcodeStreamToIR,
  parseGcodeToIR,
  parseGcodeToIRAsync,
  type ParseLimits,
  type WorkerLike
} from '../index';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGcode3mf, sniffGcode3mf } from '@chestnutlabs/gcode-containers';
import { createWorkerHandler, type WorkerHandlerOptions } from '../worker-core';
import { PROTOCOL_VERSION, type WorkerRequest } from '../protocol';

const FIELDS: (keyof ParseLimits)[] = [
  'maxInputBytes',
  'maxSegments',
  'maxBufferBytes',
  'maxLineLength',
  'maxWarnings',
  'maxProgramIterations',
  'maxCallDepth'
];
const BAD: unknown[] = [NaN, Infinity, -Infinity, -1, 1.5, null, '5', {}];
const PROGRAM = 'G1 X1 Y1 E1\n';

function limitsWith(key: keyof ParseLimits, value: unknown): Partial<ParseLimits> {
  return { [key]: value } as Partial<ParseLimits>;
}

describe('ParseLimits validation (#508)', () => {
  it('covers every ParseLimits field', () => {
    expect([...FIELDS].sort()).toEqual(Object.keys(DEFAULT_LIMITS).sort());
  });

  for (const key of FIELDS) {
    for (const bad of BAD) {
      it(`${key}: ${typeof bad === 'object' && bad !== null ? 'object' : String(bad)} throws E_PARSE_OPTION`, () => {
        let caught: unknown;
        try {
          parseGcodeToIR(PROGRAM, { limits: limitsWith(key, bad) });
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(ParseOptionError);
        expect((caught as ParseOptionError).code).toBe('E_PARSE_OPTION');
        expect((caught as ParseOptionError).name).toBe('ParseOptionError');
        expect((caught as ParseOptionError).message).toContain(`limits.${key} must be a non-negative integer`);
      });
    }
  }

  it('maxInputBytes above 2^32-1 throws E_PARSE_OPTION; 2^32-1 itself is accepted', () => {
    let caught: unknown;
    try {
      parseGcodeToIR(PROGRAM, { limits: { maxInputBytes: 4294967296 } });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ParseOptionError);
    expect((caught as ParseOptionError).code).toBe('E_PARSE_OPTION');
    expect((caught as ParseOptionError).message).toBe(
      'limits.maxInputBytes must be at most 4294967295 (got 4294967296)'
    );
    expect(() => parseGcodeToIR(PROGRAM, { limits: { maxInputBytes: 4294967295 } })).not.toThrow();
    // the ceiling is specific to maxInputBytes
    expect(() => parseGcodeToIR(PROGRAM, { limits: { maxSegments: 4294967296 } })).not.toThrow();
  });

  it('names the offending value in the message', () => {
    expect(() => parseGcodeToIR(PROGRAM, { limits: { maxCallDepth: NaN } })).toThrow(
      'limits.maxCallDepth must be a non-negative integer (got NaN)'
    );
    expect(() => parseGcodeToIR(PROGRAM, { limits: { maxSegments: -3 } })).toThrow(
      'limits.maxSegments must be a non-negative integer (got -3)'
    );
  });

  it('accepts zero and ordinary integers, and keeps the default for undefined', () => {
    const r = parseGcodeToIR('G1 X1\nG1 X2\nG1 X3\n', { limits: { maxSegments: 2, maxWarnings: undefined } });
    expect(r.ir.segments.count).toBe(2);
    expect(() => parseGcodeToIR(PROGRAM, { limits: { maxProgramIterations: 0, maxCallDepth: 0 } })).not.toThrow();
    expect(() => parseGcodeToIR(PROGRAM, { limits: {} })).not.toThrow();
    expect(() => parseGcodeToIR(PROGRAM, { limits: undefined })).not.toThrow();
  });

  it('a null limits object (untyped caller) behaves like no limits', () => {
    expect(() => parseGcodeToIR(PROGRAM, { limits: null as unknown as undefined })).not.toThrow();
  });

  it('a bad limit fails before any container sniffing in the worker', async () => {
    let sniffed = 0;
    const handlerCalls: unknown[] = [];
    const handler = createWorkerHandler((msg) => handlerCalls.push(msg), {
      containers: [
        {
          id: 'probe',
          sniff: () => {
            sniffed++;
            return false;
          },
          open: () => Promise.reject(new Error('unreachable'))
        }
      ]
    });
    handler({
      v: PROTOCOL_VERSION,
      type: 'parse',
      id: 1,
      input: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      opts: { limits: { maxLineLength: -1 } }
    } as WorkerRequest);
    await new Promise((r) => setTimeout(r, 20));
    expect(sniffed).toBe(0);
    expect(handlerCalls).toMatchObject([{ type: 'error', id: 1, error: { code: 'E_PARSE_OPTION' } }]);
  });

  it('a .gcode.3mf with a bad limit is rejected before the archive is opened or extracted', async () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../test-data/fixtures/containers');
    const bytes = () => new Uint8Array(fs.readFileSync(path.join(dir, 'mini-project.gcode.3mf')));
    let opens = 0;
    const containers: WorkerHandlerOptions['containers'] = [
      {
        id: 'gcode-3mf',
        sniff: sniffGcode3mf,
        open: (b) => {
          opens++;
          return openGcode3mf(b);
        }
      }
    ];
    const w: WorkerLike = { onmessage: null, onerror: null, postMessage: () => undefined, terminate: () => undefined };
    const handler = createWorkerHandler(
      (msg) => {
        void Promise.resolve().then(() => w.onmessage?.({ data: msg }));
      },
      { containers }
    );
    w.postMessage = (m: unknown) => handler(m as WorkerRequest);
    const session = new GcodeParseSession({ worker: w });
    await expect(session.parse(bytes(), { limits: { maxProgramIterations: NaN } })).rejects.toMatchObject({
      code: 'E_PARSE_OPTION'
    });
    expect(opens).toBe(0);
    // control: the same file with a valid limit does open the archive and parse
    const ok = await session.parse(bytes(), { limits: { maxProgramIterations: 100 } });
    expect(opens).toBe(1);
    expect(ok.ir.segments.count).toBe(401);
    session.dispose();
  });

  it('a looping program with a valid small bound still stops with the disclosure', () => {
    const r = parseGcodeToIR('o1 while [1]\nG1 X1\no1 endwhile', { limits: { maxProgramIterations: 5 } });
    expect(r.ir.header.warnings.map((w) => w.code)).toContain('rs274-iteration-limit');
  });

  it('the async parser throws the same typed error', async () => {
    await expect(parseGcodeToIRAsync(PROGRAM, { limits: { maxProgramIterations: NaN } })).rejects.toMatchObject({
      code: 'E_PARSE_OPTION'
    });
  });

  it('the streaming parser throws the same typed error', async () => {
    await expect(
      parseGcodeStreamToIR(new Blob([PROGRAM]), { limits: { maxLineLength: Infinity } })
    ).rejects.toMatchObject({ code: 'E_PARSE_OPTION' });
  });

  it('a worker parse rejects with the typed code before any container work', async () => {
    const w: WorkerLike = { onmessage: null, onerror: null, postMessage: () => undefined, terminate: () => undefined };
    const handler = createWorkerHandler((msg) => {
      void Promise.resolve().then(() => w.onmessage?.({ data: msg }));
    });
    w.postMessage = (m: unknown) => handler(m as WorkerRequest);
    const session = new GcodeParseSession({ worker: w });
    await expect(session.parse(PROGRAM, { limits: { maxProgramIterations: NaN } })).rejects.toMatchObject({
      code: 'E_PARSE_OPTION'
    });
    // the session stays usable
    const ok = await session.parse(PROGRAM, { limits: { maxProgramIterations: 10 } });
    expect(ok.ir.segments.count).toBe(1);
    session.dispose();
  });
});
