// @vitest-environment node
// The dev -> main docs gate, run as a child process against a fixture repo.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  docsReadme,
  makeRepo,
  passingRepoFiles,
  readmeRoot,
  review,
  runScript,
  writeFiles
} from './testing/fixture.mjs';

// Child processes and git are slow on Windows runners; the default 5 s is too tight.
vi.setConfig({ testTimeout: 60_000 });
afterEach(cleanup);

const V = '2.3.4';

function check(overrides = {}, { drop = [] } = {}) {
  const files = { ...passingRepoFiles(V), ...overrides };
  for (const f of drop) delete files[f];
  const root = makeRepo(files);
  return runScript(root, 'check-release-docs.mjs');
}

/** The failure lines the gate printed (the "  - " list). */
function failures(r) {
  return r.stderr
    .split('\n')
    .filter((l) => l.startsWith('  - '))
    .map((l) => l.slice(4));
}

describe('check-release-docs', () => {
  it('passes a repo whose docs all name the release', () => {
    const r = check();
    expect(r.stderr).toContain(`docs-release-check: PASS — all version surfaces agree with v${V}.`);
    expect(r.stderr).not.toContain('FAIL');
    expect(r.status).toBe(0);
  });

  it('fails a surface that names another version', () => {
    const r = check({ 'README.md': readmeRoot('2.3.3') });
    expect(r.status).toBe(1);
    expect(failures(r)).toEqual([`README.md: lockstep-version note says v2.3.3, release is v${V}`]);
  });

  it('fails a surface whose anchor is gone', () => {
    const r = check({ 'docs/manual/index.md': '# Manual\n\nno version here\n' });
    expect(r.status).toBe(1);
    expect(failures(r)).toEqual([
      'docs/manual/index.md: anchor for published-status line not found (doc structure drifted)'
    ]);
  });

  it('fails a second, stale copy of a surface even when the first is current', () => {
    const r = check({ 'README.md': readmeRoot(V) + '\nAlso (currently **v2.3.3**).\n' });
    expect(r.status).toBe(1);
    expect(failures(r)).toEqual([`README.md: lockstep-version note says v2.3.3, release is v${V}`]);
  });

  it('fails when the narrative names the previous version', () => {
    const r = check({ 'docs/README.md': docsReadme(V, { lead: '2.3.3', history: ['2.3.3'] }) });
    expect(r.status).toBe(1);
    expect(failures(r)).toEqual([
      `docs/README.md: Current-state block leads with v2.3.3 (expected v${V})`,
      `docs/README.md: Release-history list is MISSING \`v${V}\``
    ]);
  });

  it('fails while the notes draft is still present', () => {
    const r = check({ 'RELEASE_NOTES_DRAFT.md': '# draft\n' });
    expect(r.status).toBe(1);
    expect(failures(r)).toEqual([
      "RELEASE_NOTES_DRAFT.md still present — fold it into docs/README.md's current-state + history, then delete it"
    ]);
  });

  it('fails when the review is missing', () => {
    const r = check({}, { drop: ['RELEASE_REVIEW.md'] });
    expect(r.status).toBe(1);
    expect(failures(r)).toEqual([
      'RELEASE_REVIEW.md missing — run `node tools/release/stamp-release-docs.mjs` to seed it, then resolve every disposition'
    ]);
  });

  it('fails each unresolved review check', () => {
    const r = check({ 'RELEASE_REVIEW.md': review(V, { rows: ['pending'], markers: { Visual: 'pending' } }) });
    expect(r.status).toBe(1);
    expect(failures(r)).toEqual([
      'RELEASE_REVIEW.md: unresolved package disposition(s): pending (allowed: reviewed / no-change-needed / not-applicable)',
      'RELEASE_REVIEW.md: Visual review: pending (expected resolved)'
    ]);
  });

  it('fails a review whose package table was deleted', () => {
    const r = check({ 'RELEASE_REVIEW.md': review(V, { rows: [] }) });
    expect(r.status).toBe(1);
    expect(failures(r)).toEqual([
      'RELEASE_REVIEW.md: no package disposition rows found (expected at least one `| Status: <keyword> |` cell)'
    ]);
  });

  it('reports every failure at once, then exits 1', () => {
    const r = check(
      { 'README.md': readmeRoot('1.0.0'), 'RELEASE_NOTES_DRAFT.md': 'x' },
      { drop: ['RELEASE_REVIEW.md'] }
    );
    expect(r.status).toBe(1);
    expect(failures(r)).toHaveLength(3);
    expect(r.stderr).toContain(`docs-release-check: FAIL — docs do not match v${V}:`);
    expect(r.stderr).not.toContain('PASS');
  });

  it('echoes the packages whose changelog has this version', () => {
    const root = makeRepo(passingRepoFiles(V));
    writeFiles(root, { 'packages/toolpath-core/CHANGELOG.md': `# C\n\n## ${V}\n\n- abc1234: A change\n` });
    const r = runScript(root, 'check-release-docs.mjs');
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('  packages changed this release: @chestnutlabs/toolpath-core\n');
  });
});
