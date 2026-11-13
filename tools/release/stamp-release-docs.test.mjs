// @vitest-environment node
// The Version-PR stamper, run as a child process against a git fixture repo.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  commitAll,
  docsReadme,
  exists,
  git,
  gitInit,
  makeRepo,
  manualIndex,
  pkg,
  read,
  readmeRoot,
  runScript,
  writeFiles
} from './testing/fixture.mjs';

// Child processes and git are slow on Windows runners; the default 5 s is too tight.
vi.setConfig({ testTimeout: 60_000 });
afterEach(cleanup);

const OLD = '1.4.0';
const NEW = '1.5.0';

/** A repo at OLD, tagged, then bumped to NEW with `changes` committed on top. */
function bumpedRepo(changes = {}, { tag = true } = {}) {
  const root = makeRepo({
    'packages/toolpath-core/package.json': pkg('@chestnutlabs/toolpath-core', OLD),
    'packages/toolpath-core/src/index.ts': 'export {};\n',
    'packages/gcode-colors/package.json': pkg('@chestnutlabs/gcode-colors', OLD),
    'packages/gcode-colors/src/index.ts': 'export {};\n',
    'README.md': readmeRoot(OLD),
    'docs/manual/index.md': manualIndex(OLD),
    'docs/README.md': docsReadme(OLD)
  });
  gitInit(root);
  commitAll(root, 'base');
  if (tag) git(root, 'tag', `v${OLD}`);
  writeFiles(root, { 'packages/toolpath-core/package.json': pkg('@chestnutlabs/toolpath-core', NEW), ...changes });
  commitAll(root, 'bump');
  return root;
}

const stamp = (root, args = []) => runScript(root, 'stamp-release-docs.mjs', args);

describe('stamp-release-docs: surfaces', () => {
  it('stamps all three surfaces to the new version and reports each', () => {
    const root = bumpedRepo();
    const r = stamp(root);
    expect(r.status).toBe(0);
    expect(read(root, 'README.md')).toBe(readmeRoot(NEW));
    expect(read(root, 'docs/manual/index.md')).toBe(manualIndex(NEW));
    // Only the published line moves; the curated narrative (lead, history) is left for the author.
    expect(read(root, 'docs/README.md')).toBe(docsReadme(OLD, { published: NEW }));
    expect(r.stderr).toContain(`stamp-release-docs: README.md lockstep-version note v${OLD} -> v${NEW}\n`);
    expect(r.stderr).toContain(`stamp-release-docs: stamped 3 surface(s) to v${NEW}\n`);
  });

  it('counts only the surfaces that changed', () => {
    const root = bumpedRepo({ 'README.md': readmeRoot(NEW) });
    const r = stamp(root);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(`stamped 2 surface(s) to v${NEW}`);
    expect(r.stderr).not.toContain('README.md lockstep-version note');
  });

  it('exits 1 when an anchor is missing and writes no draft or review', () => {
    const root = bumpedRepo({ 'docs/manual/index.md': '# Manual\n' });
    const r = stamp(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('stamp-release-docs: ANCHOR MISSING in docs/manual/index.md (published-status line)\n');
    expect(r.stderr).toContain('1 anchor(s) missing');
    expect(exists(root, 'RELEASE_NOTES_DRAFT.md')).toBe(false);
    expect(exists(root, 'RELEASE_REVIEW.md')).toBe(false);
  });

  it('writes nothing with --dry-run', () => {
    const root = bumpedRepo();
    const r = stamp(root, ['--dry-run']);
    expect(r.status).toBe(0);
    expect(read(root, 'README.md')).toBe(readmeRoot(OLD));
    expect(read(root, 'docs/manual/index.md')).toBe(manualIndex(OLD));
    expect(read(root, 'docs/README.md')).toBe(docsReadme(OLD));
    expect(exists(root, 'RELEASE_NOTES_DRAFT.md')).toBe(false);
    expect(exists(root, 'RELEASE_REVIEW.md')).toBe(false);
    expect(r.stderr).toContain('[dry-run] would write RELEASE_NOTES_DRAFT.md');
    expect(r.stderr).toContain('[dry-run] RELEASE_REVIEW.md: would create (0 changed pkg(s) vs `v1.4.0`)');
  });

  it('says what --dry-run would do with an existing review', () => {
    const same = bumpedRepo({ 'RELEASE_REVIEW.md': `**Review version:** v${NEW}\n` });
    expect(stamp(same, ['--dry-run']).stderr).toContain('would keep existing (same version)');
    const stale = bumpedRepo({ 'RELEASE_REVIEW.md': `**Review version:** v${OLD}\n` });
    expect(stamp(stale, ['--dry-run']).stderr).toContain('would overwrite (stale version)');
  });
});

describe('stamp-release-docs: notes draft', () => {
  it('proposes the new version, the changelog points and the changed packages', () => {
    const root = bumpedRepo({
      'packages/toolpath-core/CHANGELOG.md': `# C\n\n## ${NEW}\n\n- abc1234: Faster parse\n- Updated dependencies\n`
    });
    expect(stamp(root).status).toBe(0);
    const draft = read(root, 'RELEASE_NOTES_DRAFT.md');
    expect(draft).toContain(`# Release notes draft — v${NEW}\n`);
    expect(draft).toContain(`**v${NEW} shipped to npm**`);
    expect(draft).toContain(`Append: \`\` \`v${NEW}\` <short label> \`\``);
    expect(draft).toContain('## Proposed points (deduped from this release\'s changelogs)\n- Faster parse\n');
    expect(draft).toContain('## Packages changed this release\n- @chestnutlabs/toolpath-core\n');
  });

  it('says so when there are no changelog points', () => {
    const root = bumpedRepo();
    expect(stamp(root).status).toBe(0);
    const draft = read(root, 'RELEASE_NOTES_DRAFT.md');
    expect(draft).toContain('- (no non-dependency changelog entries found — confirm this is intentional)');
    expect(draft).toContain('## Packages changed this release\n- (none detected)\n');
  });
});

describe('stamp-release-docs: review', () => {
  it('seeds one pending row per package whose src changed since the previous tag', () => {
    const long = 'x'.repeat(200);
    const root = bumpedRepo({
      'packages/toolpath-core/src/a.ts': 'a\n',
      'packages/toolpath-core/src/index.ts': 'export const x = 1;\n',
      'packages/toolpath-core/CHANGELOG.md': `# C\n\n## ${NEW}\n\n- abc1234: Pipes | in | text ${long}\n`
    });
    expect(stamp(root).status).toBe(0);
    const text = read(root, 'RELEASE_REVIEW.md');
    expect(text).toContain(`**Review version:** v${NEW}\n`);
    expect(text).toContain('**Changed-capability inventory diffed against:** `v1.4.0`\n');
    const summary = `Pipes \\| in \\| text ${long}`.slice(0, 140);
    expect(text).toContain(`| \`@chestnutlabs/toolpath-core\` | 2 | ${summary} | Status: pending |\n`);
    expect(text).not.toContain('gcode-colors');
    for (const label of ['Product', 'Docs', 'Visual']) expect(text).toContain(`- **${label} review:** pending — `);
  });

  it('marks a changed package with no changelog summary as a version bump', () => {
    const root = bumpedRepo({ 'packages/gcode-colors/src/index.ts': 'export const y = 2;\n' });
    expect(stamp(root).status).toBe(0);
    expect(read(root, 'RELEASE_REVIEW.md')).toContain(
      '| `@chestnutlabs/gcode-colors` | 1 | _(version bump only — no src changelog summary)_ | Status: pending |\n'
    );
  });

  it('writes a single not-applicable row when no package src changed', () => {
    const root = bumpedRepo();
    expect(stamp(root).status).toBe(0);
    expect(read(root, 'RELEASE_REVIEW.md')).toContain(
      '| _(no package `src/` changed since the previous tag)_ | 0 | — | Status: not-applicable |\n'
    );
  });

  it('treats every package as changed on the first release', () => {
    const root = bumpedRepo({}, { tag: false });
    expect(stamp(root).status).toBe(0);
    const text = read(root, 'RELEASE_REVIEW.md');
    expect(text).toContain('**Changed-capability inventory diffed against:** _(no previous tag — treated all packages as changed)_\n');
    expect(text).toContain('| `@chestnutlabs/gcode-colors` | 0 |');
    expect(text).toContain('| `@chestnutlabs/toolpath-core` | 0 |');
  });

  it('keeps a review already started for this version', () => {
    const mine = `# Mine\n\n**Review version:** v${NEW}\n\n| x | 1 | y | Status: reviewed |\n`;
    const root = bumpedRepo({ 'RELEASE_REVIEW.md': mine });
    const r = stamp(root);
    expect(r.status).toBe(0);
    expect(read(root, 'RELEASE_REVIEW.md')).toBe(mine);
    expect(r.stderr).toContain(`RELEASE_REVIEW.md already at v${NEW} — keeping human edits`);
  });

  it('replaces a review left over from another version', () => {
    const root = bumpedRepo({ 'RELEASE_REVIEW.md': `**Review version:** v${OLD}\n\n| x | 1 | y | Status: reviewed |\n` });
    const r = stamp(root);
    expect(r.status).toBe(0);
    expect(read(root, 'RELEASE_REVIEW.md')).toContain(`**Review version:** v${NEW}\n`);
    expect(r.stderr).toContain(`refreshed RELEASE_REVIEW.md for v${NEW}`);
  });

  it('a fresh stamp fails the gate until the review is resolved', () => {
    const root = bumpedRepo({ 'packages/gcode-colors/src/index.ts': 'export const y = 2;\n' });
    expect(stamp(root).status).toBe(0);
    const r = runScript(root, 'check-release-docs.mjs');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('RELEASE_REVIEW.md: unresolved package disposition(s): pending');
    expect(r.stderr).toContain('RELEASE_NOTES_DRAFT.md still present');
  });
});
