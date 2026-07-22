/**
 * Fixture-manifest validation (#17; governance §11, PROJECT_SETUP §1.1).
 *
 * Every fixture used by tests must have a complete manifest entry, and the
 * manifest must not drift from the actual files: paths exist, sizes match, and
 * sha256 hashes match. CI failing here means either a fixture changed without a
 * manifest update, or an entry was added without required provenance fields.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface ManifestFixture {
  id: string;
  path: string;
  sha256: string;
  bytes: number;
  origin: string;
  contributor: string;
  redistribution: string;
  slicer: string;
  targetFamily: string;
  features: string[];
  expectedCapabilities: Record<string, string>;
  sizeTier: string;
  limitations: string;
}

const manifest = JSON.parse(readFileSync(join(repoRoot, 'test-data', 'manifest.json'), 'utf8')) as {
  schemaVersion: number;
  fixtures: ManifestFixture[];
};

const REQUIRED_FIELDS: (keyof ManifestFixture)[] = [
  'id',
  'path',
  'sha256',
  'bytes',
  'origin',
  'contributor',
  'redistribution',
  'slicer',
  'targetFamily',
  'features',
  'expectedCapabilities',
  'sizeTier',
  'limitations'
];
const SIZE_TIERS = ['tiny', 'small', 'medium', 'large', 'adversarial'];

describe('fixture manifest (#17)', () => {
  it('has a schema version and at least one fixture', () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.fixtures.length).toBeGreaterThan(0);
  });

  it('has unique, stable fixture ids', () => {
    const ids = manifest.fixtures.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  for (const fixture of manifest.fixtures) {
    describe(fixture.id, () => {
      it('has every required provenance field', () => {
        for (const field of REQUIRED_FIELDS) {
          expect(fixture[field], `missing field: ${field}`).toBeDefined();
          if (typeof fixture[field] === 'string') expect(fixture[field]).not.toBe('');
        }
        expect(SIZE_TIERS).toContain(fixture.sizeTier);
        expect(Array.isArray(fixture.features)).toBe(true);
      });

      it('references a repo-relative file that exists (no private/absolute paths)', () => {
        expect(isAbsolute(fixture.path)).toBe(false);
        expect(fixture.path).not.toMatch(/ProjectSource/i);
        expect(fixture.path).not.toContain('..');
        expect(existsSync(join(repoRoot, fixture.path))).toBe(true);
      });

      it('matches the actual file bytes and sha256', () => {
        const data = readFileSync(join(repoRoot, fixture.path));
        expect(data.length).toBe(fixture.bytes);
        const digest = createHash('sha256').update(data).digest('hex');
        expect(digest).toBe(fixture.sha256);
      });
    });
  }
});
