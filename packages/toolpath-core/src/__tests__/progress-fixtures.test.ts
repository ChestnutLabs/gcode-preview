/**
 * Contract-fixture runner (DD-006 §9, phase 2 — #91).
 *
 * Auto-extends: every `*.json` in `test-data/fixtures/progress/` becomes a suite. Each fixture
 * pins an observation sequence shaped like a real AnyBridge telemetry stream (DD-006 §1.1) with
 * expected `MappedProgress` outputs — the cross-repo evidence AnyBridge consumes as plain JSON.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  MoveKind,
  ToolpathIRBuilder,
  createProgressMapper,
  type MappedProgress,
  type ProgressMapperOptions,
  type ProgressObservation,
  type ToolpathIR
} from '../index';

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'test-data',
  'fixtures',
  'progress'
);

interface IRSpec {
  layers: number;
  segsPerLayer: number;
  srcByteStart: number;
  srcByteStride: number;
  source?: { byteLength?: number; sha256?: string };
}

interface StepExpect {
  segIndex?: number | null;
  basis?: string;
  confidence?: string;
  band?: [number, number] | null;
  layerIndex?: number | null;
  stale?: boolean;
  noteCodes?: string[];
  noteCodesAbsent?: string[];
}

interface FixtureStep {
  obs?: ProgressObservation;
  tick?: number;
  expect: StepExpect;
}

interface ProgressFixture {
  meta: { surface: string; notes?: string; dd?: string };
  irSpec: IRSpec;
  mapperOptions?: ProgressMapperOptions;
  steps: FixtureStep[];
}

function buildIR(spec: IRSpec): ToolpathIR {
  const b = new ToolpathIRBuilder({
    parserVersion: 'fixture',
    units: 'mm',
    unitsSource: 'known',
    source: spec.source
  });
  const count = spec.layers * spec.segsPerLayer;
  for (let i = 0; i < count; i++) {
    const layer = Math.floor(i / spec.segsPerLayer);
    b.addSegment({
      x0: i,
      y0: 0,
      z0: 0.2 * (layer + 1),
      x1: i + 1,
      y1: 0,
      z1: 0.2 * (layer + 1),
      e: 1,
      kind: MoveKind.Extrude,
      layer,
      srcByte: i * spec.srcByteStride + spec.srcByteStart
    });
  }
  return b.finalize();
}

function assertStep(result: MappedProgress, exp: StepExpect): void {
  if ('segIndex' in exp) expect(result.segIndex).toEqual(exp.segIndex);
  if (exp.basis !== undefined) expect(result.basis).toBe(exp.basis);
  if (exp.confidence !== undefined) expect(result.confidence).toBe(exp.confidence);
  if ('band' in exp) expect(result.band).toEqual(exp.band);
  if ('layerIndex' in exp) expect(result.layerIndex).toEqual(exp.layerIndex);
  if (exp.stale !== undefined) expect(result.stale).toBe(exp.stale);
  const codes = result.notes.map((n) => n.code);
  for (const code of exp.noteCodes ?? []) expect(codes).toContain(code);
  for (const code of exp.noteCodesAbsent ?? []) expect(codes).not.toContain(code);
}

const files = readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));

describe('progress contract fixtures (DD-006 §9)', () => {
  it('has the four real-stream fixtures from §1.1', () => {
    expect(files.sort()).toEqual([
      'anycubic-percent.json',
      'bambu-percent-layer.json',
      'byte-exact.json',
      'klipper-byte-fraction.json'
    ]);
  });

  for (const file of files) {
    const fixture = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as ProgressFixture;
    describe(file, () => {
      it(fixture.meta.surface, () => {
        const mapper = createProgressMapper(buildIR(fixture.irSpec), fixture.mapperOptions);
        fixture.steps.forEach((step, i) => {
          const result = step.tick !== undefined ? mapper.tick(step.tick) : mapper.observe(step.obs!);
          try {
            assertStep(result, step.expect);
          } catch (err) {
            throw new Error(`${file} step ${i}: ${(err as Error).message}`);
          }
        });
      });
    });
  }
});
