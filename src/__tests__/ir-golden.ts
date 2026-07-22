/**
 * Golden ToolpathIR fixtures (#28, DD-001 §8).
 *
 * For every fixture in test-data/manifest.json, parse with the inherited Parser +
 * Interpreter, convert via jobToToolpathIR (#29), summarize the IR into a stable
 * digest, and compare against test-data/golden/<id>.json. These snapshots pin the
 * IR contract so the parser or renderer can be replaced without silently changing
 * the produced IR.
 *
 * Regenerate deliberately with: UPDATE_GOLDEN=1 npx vitest run src/__tests__/ir-golden.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';
import { Parser } from '../gcode-parser';
import { Interpreter } from '../interpreter';
import { Job } from '../job';
import { jobToToolpathIR } from '../ir-adapter';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const goldenDir = join(repoRoot, 'test-data', 'golden');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

interface ManifestFixture {
  id: string;
  path: string;
  sha256: string;
}

const manifest = JSON.parse(readFileSync(join(repoRoot, 'test-data', 'manifest.json'), 'utf8')) as {
  fixtures: ManifestFixture[];
};

/** FNV-1a (32-bit) over a typed array's underlying bytes; stable hex digest. */
function fnv1a(view: ArrayBufferView): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const round = (n: number): number => Math.round(n * 1000) / 1000;
/** Empty bounds (no qualifying segments) carry ±Infinity — represent as null in JSON honestly. */
const roundOrNull = (n: number): number | null => (Number.isFinite(n) ? round(n) : null);

/** Stable, human-reviewable summary of a ToolpathIR. */
function summarize(ir: ToolpathIR): Record<string, unknown> {
  const s = ir.segments;
  return {
    irSchemaVersion: ir.header.irSchemaVersion,
    segmentCount: s.count,
    layerCount: ir.layers.length,
    toolCount: ir.tools.length,
    originOffset: {
      x: round(ir.header.originOffset.x),
      y: round(ir.header.originOffset.y),
      z: round(ir.header.originOffset.z)
    },
    bounds: {
      min: { x: roundOrNull(ir.bounds.min.x), y: roundOrNull(ir.bounds.min.y), z: roundOrNull(ir.bounds.min.z) },
      max: { x: roundOrNull(ir.bounds.max.x), y: roundOrNull(ir.bounds.max.y), z: roundOrNull(ir.bounds.max.z) }
    },
    boundsWithTravel: {
      min: {
        x: roundOrNull(ir.boundsWithTravel.min.x),
        y: roundOrNull(ir.boundsWithTravel.min.y),
        z: roundOrNull(ir.boundsWithTravel.min.z)
      },
      max: {
        x: roundOrNull(ir.boundsWithTravel.max.x),
        y: roundOrNull(ir.boundsWithTravel.max.y),
        z: roundOrNull(ir.boundsWithTravel.max.z)
      }
    },
    capabilities: ir.header.capabilities,
    warningCodes: [...new Set(ir.header.warnings.map((w) => w.code))].sort(),
    bufferDigests: {
      x0: fnv1a(s.x0),
      y0: fnv1a(s.y0),
      z0: fnv1a(s.z0),
      x1: fnv1a(s.x1),
      y1: fnv1a(s.y1),
      z1: fnv1a(s.z1),
      e: fnv1a(s.e),
      feedrate: fnv1a(s.feedrate),
      kind: fnv1a(s.kind),
      tool: fnv1a(s.tool),
      layer: fnv1a(s.layer),
      feature: fnv1a(s.feature),
      object: fnv1a(s.object),
      srcByte: fnv1a(s.srcByte)
    }
  };
}

function produceIR(fixturePath: string, byteLength: number, id: string): ToolpathIR {
  const text = readFileSync(join(repoRoot, fixturePath), 'utf8');
  const parser = new Parser();
  const { commands } = parser.parseGCode(text);
  const job = new Job();
  new Interpreter().execute(commands, job);
  job.finishPath();
  return jobToToolpathIR(job, { parserVersion: 'golden', source: { id, byteLength } });
}

describe('golden ToolpathIR fixtures (#28)', () => {
  for (const fixture of manifest.fixtures) {
    it(`matches the golden IR summary for ${fixture.id}`, () => {
      const bytes = readFileSync(join(repoRoot, fixture.path));
      const ir = produceIR(fixture.path, bytes.length, fixture.id);
      const summary = summarize(ir);
      const goldenPath = join(goldenDir, `${fixture.id}.json`);

      if (UPDATE || !existsSync(goldenPath)) {
        mkdirSync(goldenDir, { recursive: true });
        writeFileSync(goldenPath, JSON.stringify(summary, null, 2) + '\n');
      }

      const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
      expect(summary).toEqual(golden);
    });
  }
});
