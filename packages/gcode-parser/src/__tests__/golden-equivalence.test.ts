/**
 * Golden-equivalence gate (DD-003 §9, issue #44).
 *
 * The native parse core must reproduce the inherited engine's geometry exactly:
 * for every #28 fixture, the {x0,y0,z0,x1,y1,z1,tool,layer} channel digests and
 * segment count must equal the committed adapter goldens, and the kind channel
 * must match once masked to the Extrude|Travel bits the adapter knew about
 * (the native core additionally sets ARC_SEGMENT — a documented improvement).
 *
 * Native goldens (with e/feedrate/srcByte = known) are written alongside under
 * test-data/golden-native/ via UPDATE_GOLDEN=1 on first run.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MoveKind } from '@chestnutlabs/toolpath-core';
import { parseGcodeToIR } from '../index';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const goldenDir = join(repoRoot, 'test-data', 'golden');
const nativeGoldenDir = join(repoRoot, 'test-data', 'golden-native');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

const manifest = JSON.parse(readFileSync(join(repoRoot, 'test-data', 'manifest.json'), 'utf8')) as {
  fixtures: { id: string; path: string; sizeTier: string }[];
};

/**
 * The DD-003 §9 equivalence gate is defined over the inherited demo corpus.
 * Adversarial-tier fixtures exercise NEW protective behavior the inherited engine
 * lacks (e.g. maxLineLength skips a hostile 80 KB line that the inherited parser
 * would happily execute), so strict adapter-equivalence deliberately excludes
 * them; their behavior is pinned by the adversarial suite and the native goldens.
 */
const equivalenceFixtures = manifest.fixtures.filter((f) => f.sizeTier !== 'adversarial');

/**
 * E10 phase 3 (#158, DD-010 D4 + probe amendment): these fixtures use coordinate-system commands the
 * inherited engine ignored, so the native core INTENTIONALLY diverges from the adapter goldens — a
 * documented semantic correction, not a regression. demo-mach3 probes (`G31`) then `G92 Z0`-resyncs
 * the logical frame; the native core honors that (position stays in the authored logical range and no
 * fabricated move is drawn across the probe), where the inherited engine ignored both. These fixtures
 * are excluded from strict adapter-position equivalence and pinned instead by their native goldens.
 *
 * DD-012 (#189): demo-easel is a CNC file (`M3 S12000` … `M5`). The native core now classifies its
 * spindle-engaged no-E moves as `MoveKind.Cut` — a documented semantic correction — where the
 * inherited adapter (which knew only Extrude|Travel) called them Travel. Positions are unchanged; only
 * the masked-kind digest diverges, so it too is excluded here and pinned by its native golden.
 */
// container-adv-traversal-names is an ADVERSARIAL BINARY container (a malicious ZIP) — never real
// G-code. The #189 multi-command lexer (which reads every G/M word on a line, not just the first)
// finds a few coincidental `G<digit>` byte patterns in the ZIP bytes, so a raw-text parse of it yields
// a handful of bounded segments where the inherited first-word lexer yielded zero. Bounded and
// harmless (the real path decodes the container first); excluded from strict adapter-equivalence and
// pinned by its native golden, like the CNC motion corrections above.
const INTENTIONAL_MOTION_CORRECTION = new Set(['demo-mach3', 'demo-easel', 'container-adv-traversal-names']);

function fnv1a(view: ArrayBufferView): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

describe('native parser vs adapter goldens (#28 gate)', () => {
  for (const fixture of equivalenceFixtures) {
    it.skipIf(INTENTIONAL_MOTION_CORRECTION.has(fixture.id))(`geometry-equivalent for ${fixture.id}`, () => {
      const golden = JSON.parse(readFileSync(join(goldenDir, `${fixture.id}.json`), 'utf8'));
      const text = readFileSync(join(repoRoot, fixture.path), 'utf8');
      const { ir } = parseGcodeToIR(text, { sourceId: fixture.id, parserVersion: 'golden' });
      const s = ir.segments;

      expect(s.count).toBe(golden.segmentCount);
      // Exact-position equivalence: identical float math → identical bits.
      expect(fnv1a(s.x0)).toBe(golden.bufferDigests.x0);
      expect(fnv1a(s.y0)).toBe(golden.bufferDigests.y0);
      expect(fnv1a(s.z0)).toBe(golden.bufferDigests.z0);
      expect(fnv1a(s.x1)).toBe(golden.bufferDigests.x1);
      expect(fnv1a(s.y1)).toBe(golden.bufferDigests.y1);
      expect(fnv1a(s.z1)).toBe(golden.bufferDigests.z1);
      expect(fnv1a(s.tool)).toBe(golden.bufferDigests.tool);
      expect(fnv1a(s.layer)).toBe(golden.bufferDigests.layer);
      // Kind masked to the bits the adapter could know (Extrude|Travel).
      const masked = new Uint8Array(s.count);
      const mask = MoveKind.Extrude | MoveKind.Travel;
      for (let i = 0; i < s.count; i++) masked[i] = s.kind[i] & mask;
      expect(fnv1a(masked)).toBe(golden.bufferDigests.kind);
      // Same floating origin.
      expect(ir.header.originOffset.x).toBeCloseTo(golden.originOffset.x, 3);
      expect(ir.header.originOffset.y).toBeCloseTo(golden.originOffset.y, 3);
      expect(ir.header.originOffset.z).toBeCloseTo(golden.originOffset.z, 3);
    });

    it(`matches the native golden for ${fixture.id}`, () => {
      const text = readFileSync(join(repoRoot, fixture.path), 'utf8');
      const { ir, stats } = parseGcodeToIR(text, { sourceId: fixture.id, parserVersion: 'golden' });
      const s = ir.segments;
      const summary = {
        segmentCount: s.count,
        layerCount: ir.layers.length,
        toolCount: ir.tools.length,
        points: stats.points,
        extrusionDistance: Math.round(stats.extrusionDistance),
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
          srcByte: fnv1a(s.srcByte)
        }
      };
      const goldenPath = join(nativeGoldenDir, `${fixture.id}.json`);
      if (UPDATE || !existsSync(goldenPath)) {
        mkdirSync(nativeGoldenDir, { recursive: true });
        writeFileSync(goldenPath, JSON.stringify(summary, null, 2) + '\n');
      }
      expect(summary).toEqual(JSON.parse(readFileSync(goldenPath, 'utf8')));
    });
  }
});
