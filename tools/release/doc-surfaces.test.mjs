// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REVIEW_STATUSES,
  SURFACES,
  applySurface,
  currentVersionOf,
  narrativeChecks,
  reviewChecks
} from './doc-surfaces.mjs';
import {
  cleanup,
  commitAll,
  docsReadme,
  git,
  gitEnv,
  gitInit,
  importFrom,
  makeRepo,
  manualIndex,
  pkg,
  readmeRoot,
  review,
  tempDir,
  writeFiles
} from './testing/fixture.mjs';

// Child processes and git are slow on Windows runners; the default 5 s is too tight.
vi.setConfig({ testTimeout: 60_000 });
afterEach(cleanup);

const byFile = Object.fromEntries(SURFACES.map((s) => [s.file, s]));

describe('deterministic surfaces', () => {
  it('lists exactly the three version strings, by file', () => {
    expect(SURFACES.map((s) => s.file)).toEqual(['README.md', 'docs/manual/index.md', 'docs/README.md']);
  });

  it('reads the version each surface declares', () => {
    expect(currentVersionOf(byFile['README.md'], readmeRoot('1.2.3'))).toBe('1.2.3');
    expect(currentVersionOf(byFile['docs/manual/index.md'], manualIndex('0.10.4'))).toBe('0.10.4');
    expect(currentVersionOf(byFile['docs/README.md'], docsReadme('7.0.12'))).toBe('7.0.12');
  });

  it('reads the docs/README published line across a line wrap or a space', () => {
    const s = byFile['docs/README.md'];
    expect(currentVersionOf(s, 'published to npm at\n`v3.4.5`')).toBe('3.4.5');
    expect(currentVersionOf(s, 'published to npm at `v3.4.5`')).toBe('3.4.5');
  });

  it('returns null when the anchor is gone or reshaped', () => {
    expect(currentVersionOf(byFile['README.md'], 'currently v1.2.3')).toBeNull();
    expect(currentVersionOf(byFile['README.md'], '(currently **1.2.3**)')).toBeNull();
    expect(currentVersionOf(byFile['docs/manual/index.md'], 'latest v1.2.3')).toBeNull();
    expect(currentVersionOf(byFile['docs/README.md'], 'published to npm at v1.2.3')).toBeNull();
    expect(currentVersionOf(byFile['docs/README.md'], 'published at `v1.2.3`')).toBeNull();
  });

  it('rewrites the root README token and nothing else', () => {
    const before = 'x (currently **v0.1.0**) y\nv0.1.0 elsewhere\n';
    expect(applySurface(byFile['README.md'], before, '0.2.0')).toBe(
      'x (currently **v0.2.0**) y\nv0.1.0 elsewhere\n'
    );
  });

  it('rewrites the manual token', () => {
    expect(applySurface(byFile['docs/manual/index.md'], 'on npm (latest `v0.1.0`,', '0.2.0')).toBe(
      'on npm (latest `v0.2.0`,'
    );
  });

  it('rewrites the docs/README token and keeps the author line wrap', () => {
    const s = byFile['docs/README.md'];
    expect(applySurface(s, 'published to npm at\n`v0.1.0`** (x)', '0.2.0')).toBe(
      'published to npm at\n`v0.2.0`** (x)'
    );
    expect(applySurface(s, 'published to npm at  `v0.1.0`', '0.2.0')).toBe('published to npm at  `v0.2.0`');
  });

  it('rewrites every occurrence of a token', () => {
    const before = '(currently **v0.1.0**) and (currently **v0.0.9**)';
    expect(applySurface(byFile['README.md'], before, '1.0.0')).toBe(
      '(currently **v1.0.0**) and (currently **v1.0.0**)'
    );
  });

  it('is stable on repeated use (global regexes keep no state between calls)', () => {
    const s = byFile['README.md'];
    for (let i = 0; i < 3; i++) expect(currentVersionOf(s, readmeRoot('2.0.0'))).toBe('2.0.0');
  });
});

describe('narrativeChecks', () => {
  it('passes when the current state leads with the version and the history lists it', () => {
    expect(narrativeChecks(docsReadme('1.2.0', { history: ['1.1.0', '1.2.0'] }), '1.2.0')).toEqual([
      { ok: true, detail: 'Current-state block leads with v1.2.0 (expected v1.2.0)' },
      { ok: true, detail: 'Release-history list includes `v1.2.0`' }
    ]);
  });

  it('fails a current state that leads with the previous version', () => {
    const [lead] = narrativeChecks(docsReadme('1.2.0', { lead: '1.1.0' }), '1.2.0');
    expect(lead).toEqual({ ok: false, detail: 'Current-state block leads with v1.1.0 (expected v1.2.0)' });
  });

  it('fails a malformed or missing current-state heading', () => {
    const content = docsReadme('1.2.0').replace('## Current state (updated 2026-11-12', '## Current state (2026');
    const [lead] = narrativeChecks(content, '1.2.0');
    expect(lead.ok).toBe(false);
    expect(lead.detail).toBe(
      'Current-state heading not found or malformed (expected "## Current state (updated <date> — **v1.2.0 shipped …")'
    );
  });

  it('fails a history list that is missing the version', () => {
    const [, hist] = narrativeChecks(docsReadme('1.2.0', { history: ['1.1.0'] }), '1.2.0');
    expect(hist).toEqual({ ok: false, detail: 'Release-history list is MISSING `v1.2.0`' });
  });

  it('does not take a longer version for the one being cut', () => {
    const [, hist] = narrativeChecks(docsReadme('1.2.0', { history: ['1.2.01', '11.2.0'] }), '1.2.0');
    expect(hist.ok).toBe(false);
  });

  it('only searches the history region between its two anchors', () => {
    const regionMissing = 'region not found (anchors "publishing from tagged" … "Changesets accumulate")';
    const base = docsReadme('1.2.0', { history: ['1.1.0'] });
    // The version appears only after the end anchor: not in the history.
    const after = base + '\nLater: `v1.2.0` mention.\n';
    expect(narrativeChecks(after, '1.2.0')[1].ok).toBe(false);
    // The version appears only before the start anchor: not in the history.
    const before = '`v1.2.0` early mention\n' + base;
    expect(narrativeChecks(before, '1.2.0')[1].ok).toBe(false);
    // Either anchor missing, or the end before the start.
    const noStart = base.replace('publishing from tagged', 'publishing');
    expect(narrativeChecks(noStart, '1.2.0')[1]).toEqual({ ok: false, detail: `Release-history list ${regionMissing}` });
    const noEnd = base.replace('Changesets accumulate', 'Changesets');
    expect(narrativeChecks(noEnd, '1.2.0')[1]).toEqual({ ok: false, detail: `Release-history list ${regionMissing}` });
    const swapped = 'Changesets accumulate first. publishing from tagged `v1.2.0`';
    expect(narrativeChecks(swapped, '1.2.0')[1]).toEqual({
      ok: false,
      detail: `Release-history list ${regionMissing}`
    });
  });
});

describe('reviewChecks', () => {
  const failing = (content, v = '1.0.0') => reviewChecks(content, v).filter((r) => !r.ok).map((r) => r.message);

  it('passes a fully resolved review for the version', () => {
    expect(reviewChecks(review('1.0.0', { rows: ['reviewed', 'no-change-needed', 'not-applicable'] }), '1.0.0')).toEqual(
      [
        { ok: true, message: 'declares review version v1.0.0 (expected v1.0.0)' },
        { ok: true, message: 'all 3 package disposition(s) resolved' },
        { ok: true, message: 'Product review: resolved (expected resolved)' },
        { ok: true, message: 'Docs review: resolved (expected resolved)' },
        { ok: true, message: 'Visual review: resolved (expected resolved)' }
      ]
    );
  });

  it('allows exactly three disposition keywords', () => {
    expect(REVIEW_STATUSES).toEqual(['reviewed', 'no-change-needed', 'not-applicable']);
  });

  it('fails a review for another version, or with no version anchor', () => {
    expect(failing(review('0.9.0'))).toEqual(['declares review version v0.9.0 (expected v1.0.0)']);
    expect(failing(review('1.0.0', { versionLine: 'Version: v1.0.0' }))).toEqual([
      'missing the "Review version: vX.Y.Z" anchor (expected v1.0.0)'
    ]);
  });

  it('reads the version line with or without bold and the leading v, in any case', () => {
    for (const line of ['Review version: 1.0.0', '**Review version:** 1.0.0', 'review VERSION: v1.0.0']) {
      expect(failing(review('1.0.0', { versionLine: line }))).toEqual([]);
    }
  });

  it('fails a pending or unknown package disposition, listing each', () => {
    expect(failing(review('1.0.0', { rows: ['reviewed', 'pending', 'Done'] }))).toEqual([
      'unresolved package disposition(s): pending, done (allowed: reviewed / no-change-needed / not-applicable)'
    ]);
  });

  it('accepts a disposition keyword in any case', () => {
    expect(failing(review('1.0.0', { rows: ['Reviewed', 'NOT-APPLICABLE'] }))).toEqual([]);
  });

  it('ignores "Status: pending" in prose, outside a table cell', () => {
    // The fixture header and guidance both mention `Status: pending`; a resolved table still passes.
    const content = review('1.0.0');
    expect(content).toContain('`Status: pending`');
    expect(failing(content)).toEqual([]);
  });

  it('fails a review with no package disposition rows at all', () => {
    // The stamper always writes at least one row (a not-applicable row when nothing changed), so an
    // empty table means the inventory was deleted, not reconciled.
    expect(failing(review('1.0.0', { rows: [] }))).toEqual([
      'no package disposition rows found (expected at least one `| Status: <keyword> |` cell)'
    ]);
  });

  it('fails each global marker that is pending or missing', () => {
    expect(failing(review('1.0.0', { markers: { Product: 'pending' } }))).toEqual([
      'Product review: pending (expected resolved)'
    ]);
    expect(failing(review('1.0.0', { markers: { Docs: 'unresolved' } }))).toEqual([
      'Docs review: unresolved (expected resolved)'
    ]);
    expect(failing(review('1.0.0', { markers: { Visual: null } }))).toEqual([
      'Visual review: marker not found (expected "**Visual review:** resolved")'
    ]);
  });

  it('reads the markers in any case, but only in their bold form', () => {
    expect(failing(review('1.0.0', { markers: { Product: 'RESOLVED' } }))).toEqual([]);
    const plain = review('1.0.0').replace('- **Docs review:** resolved', '- Docs review: resolved');
    expect(failing(plain)).toEqual(['Docs review: marker not found (expected "**Docs review:** resolved")']);
  });
});

// ---------------------------------------------------------------------------
// The fs/git helpers read the repo root, so they run against a fixture repo's copy of the module.
// ---------------------------------------------------------------------------

describe('aggregateChangelog', () => {
  const cl = (sections) => '# Changelog\n' + sections.map(([v, lines]) => `\n## ${v}\n\n${lines.join('\n')}\n`).join('');

  it('collects this version’s bullets across packages, deduped, without dependency noise', async () => {
    const root = makeRepo({
      'packages/a/CHANGELOG.md': cl([
        ['1.1.0', ['### Minor', '', '- abc1234: Add a thing', '- Updated dependencies [abc1234]', '  - @chestnutlabs/b@1.1.0']],
        ['1.0.0', ['- Old entry']]
      ]),
      'packages/b/CHANGELOG.md': cl([['1.1.0', ['- 0123456789abcdef0123456789abcdef01234567 Fix a bug', '- ADD A THING']]]),
      'packages/c/CHANGELOG.md': cl([['1.1.0', ['- Updated dependencies', '- @chestnutlabs/a@1.1.0']]]),
      'packages/d/CHANGELOG.md': cl([['1.0.0', ['- Only old']]]),
      'packages/e/README.md': 'no changelog'
    });
    const { aggregateChangelog } = await importFrom(root, 'doc-surfaces.mjs');
    expect(aggregateChangelog('1.1.0')).toEqual({
      bullets: ['Add a thing', 'Fix a bug'],
      changedPackages: ['@chestnutlabs/a', '@chestnutlabs/b']
    });
  });

  it('reads the last section to the end of the file and skips a version that only prefixes another', async () => {
    const root = makeRepo({
      'packages/a/CHANGELOG.md': cl([
        ['1.1.0', ['- In 1.1.0']],
        ['1.1.0-beta.1', ['- In the beta']]
      ])
    });
    const { aggregateChangelog } = await importFrom(root, 'doc-surfaces.mjs');
    expect(aggregateChangelog('1.1.0').bullets).toEqual(['In 1.1.0']);
    expect(aggregateChangelog('1.1.0-beta.1').bullets).toEqual(['In the beta']);
    expect(aggregateChangelog('1.1').bullets).toEqual([]);
  });

  it('returns nothing when there is no packages directory', async () => {
    const root = makeRepo({});
    const { aggregateChangelog } = await importFrom(root, 'doc-surfaces.mjs');
    expect(aggregateChangelog('1.0.0')).toEqual({ bullets: [], changedPackages: [] });
  });
});

describe('readVersion', () => {
  it('reads the lockstep version from toolpath-core', async () => {
    const root = makeRepo({
      'packages/toolpath-core/package.json': pkg('@chestnutlabs/toolpath-core', '4.5.6'),
      'packages/aaa/package.json': pkg('@chestnutlabs/aaa', '9.9.9')
    });
    const { readVersion } = await importFrom(root, 'doc-surfaces.mjs');
    expect(readVersion()).toBe('4.5.6');
  });
});

describe('previousReleaseTag and changedCapabilityInventory', () => {
  // These helpers shell out to git in the repo root; give the in-process calls a hermetic git config.
  const saved = {};
  function hermeticGit(root) {
    const env = gitEnv(root, {});
    for (const k of Object.keys(env)) {
      if (!(k in saved)) saved[k] = process.env[k];
      process.env[k] = env[k];
    }
  }
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
      delete saved[k];
    }
  });

  function repoWithTags(tags) {
    const root = makeRepo({ 'packages/a/package.json': pkg('@chestnutlabs/a', '0.0.0') });
    gitInit(root);
    commitAll(root, 'base');
    for (const t of tags) git(root, 'tag', t);
    hermeticGit(root);
    return root;
  }

  it('picks the greatest clean vX.Y.Z tag strictly below the version, by number', async () => {
    const root = repoWithTags(['v0.9.0', 'v0.10.0', 'v0.11.0', 'v0.12.0', 'v0.11.0-beta.1', 'v0.11.1', 'v2', 'legacy-v0.11.0']);
    const { previousReleaseTag } = await importFrom(root, 'doc-surfaces.mjs');
    expect(previousReleaseTag('0.11.1')).toBe('v0.11.0');
    expect(previousReleaseTag('0.12.0')).toBe('v0.11.1');
    expect(previousReleaseTag('0.10.5')).toBe('v0.10.0');
    expect(previousReleaseTag('1.0.0')).toBe('v0.12.0');
    expect(previousReleaseTag('0.9.0')).toBeNull();
  });

  it('compares minor and patch numerically, never as text', async () => {
    const root = repoWithTags(['v1.2.9', 'v1.2.10', 'v1.9.0', 'v1.10.0']);
    const { previousReleaseTag } = await importFrom(root, 'doc-surfaces.mjs');
    expect(previousReleaseTag('1.2.11')).toBe('v1.2.10');
    expect(previousReleaseTag('1.11.0')).toBe('v1.10.0');
    expect(previousReleaseTag('2.0.0')).toBe('v1.10.0');
  });

  it('returns null for a version that is not X.Y.Z, and outside a git repo', async () => {
    const root = repoWithTags(['v0.1.0']);
    const { previousReleaseTag } = await importFrom(root, 'doc-surfaces.mjs');
    expect(previousReleaseTag('0.2.0-beta.1')).toBeNull();
    expect(previousReleaseTag('0.2')).toBeNull();

    const bare = makeRepo({});
    const outside = tempDir();
    // A copy outside any repo: git fails, the helper says "no earlier release".
    fs.cpSync(path.join(bare, 'tools'), path.join(outside, 'tools'), { recursive: true });
    hermeticGit(outside);
    if (!('GIT_CEILING_DIRECTORIES' in saved)) saved.GIT_CEILING_DIRECTORIES = process.env.GIT_CEILING_DIRECTORIES;
    process.env.GIT_CEILING_DIRECTORIES = path.dirname(outside);
    const mod = await importFrom(outside, 'doc-surfaces.mjs');
    expect(mod.previousReleaseTag('1.0.0')).toBeNull();
    expect(mod.changedCapabilityInventory('1.0.0').prevTag).toBeNull();
  });

  it('inventories only packages whose src/ changed since the previous tag, sorted', async () => {
    const root = makeRepo({
      'packages/zeta/package.json': pkg('@chestnutlabs/zeta', '1.0.0'),
      'packages/zeta/src/a.ts': 'a',
      'packages/alpha/package.json': pkg('@chestnutlabs/alpha', '1.0.0'),
      'packages/alpha/src/a.ts': 'a',
      'packages/docsonly/package.json': pkg('@chestnutlabs/docsonly', '1.0.0'),
      'packages/docsonly/README.md': 'a'
    });
    gitInit(root);
    commitAll(root, 'base');
    git(root, 'tag', 'v1.0.0');
    writeFiles(root, {
      'packages/zeta/src/b.ts': 'b',
      'packages/zeta/src/a.ts': 'a2',
      'packages/alpha/src/nested/x.ts': 'x',
      'packages/docsonly/README.md': 'changed',
      'packages/docsonly/test/src/t.ts': 'not top-level src',
      'packages/alpha/CHANGELOG.md': '# C\n\n## 1.1.0\n\n- abc1234: Alpha changed\n- [def5678]: Alpha again\n- [#9](https://x/pull/9) [`1a2b3c4`](https://x/commit/1a2b3c4) Thanks [@dev](https://x/dev)! - Summary wins\n'
    });
    commitAll(root, 'change');
    hermeticGit(root);
    const { changedCapabilityInventory } = await importFrom(root, 'doc-surfaces.mjs');
    const inv = changedCapabilityInventory('1.1.0');
    expect(inv.prevTag).toBe('v1.0.0');
    expect(inv.packages).toEqual([
      {
        package: '@chestnutlabs/alpha',
        changedFiles: ['packages/alpha/src/nested/x.ts'],
        changelogBullets: ['Alpha changed', 'Alpha again', 'Summary wins']
      },
      {
        package: '@chestnutlabs/zeta',
        changedFiles: ['packages/zeta/src/a.ts', 'packages/zeta/src/b.ts'],
        changelogBullets: []
      }
    ]);
    // The cross-package draft list keeps changelog-github's link prefix (the draft is rewritten by hand);
    // the per-package review summary takes the text after "! - ".
    expect(inv.aggregatedBullets).toEqual([
      'Alpha changed',
      '[def5678]: Alpha again',
      '[#9](https://x/pull/9) [`1a2b3c4`](https://x/commit/1a2b3c4) Thanks [@dev](https://x/dev)! - Summary wins'
    ]);
  });

  it('treats every package as changed when there is no previous tag', async () => {
    const root = makeRepo({
      'packages/b/package.json': pkg('@chestnutlabs/b', '1.0.0'),
      'packages/a/package.json': pkg('@chestnutlabs/a', '1.0.0'),
      'packages/not-a-package/README.md': 'x'
    });
    gitInit(root);
    commitAll(root, 'base');
    hermeticGit(root);
    const { changedCapabilityInventory } = await importFrom(root, 'doc-surfaces.mjs');
    const inv = changedCapabilityInventory('1.0.0');
    expect(inv.prevTag).toBeNull();
    expect(inv.packages.map((p) => [p.package, p.changedFiles])).toEqual([
      ['@chestnutlabs/a', []],
      ['@chestnutlabs/b', []]
    ]);
  });

  it('dedupes a package’s changelog bullets and skips dependency lines', async () => {
    const root = makeRepo({
      'packages/a/package.json': pkg('@chestnutlabs/a', '1.0.0'),
      'packages/a/CHANGELOG.md':
        '# C\n\n## 2.0.0\n\n- abc1234: Same\n- def5678: same\n- Updated dependencies [x]\n- @chestnutlabs/b@2.0.0\n- ok\n\n## 1.0.0\n\n- old\n'
    });
    gitInit(root);
    commitAll(root, 'base');
    hermeticGit(root);
    const { changedCapabilityInventory } = await importFrom(root, 'doc-surfaces.mjs');
    expect(changedCapabilityInventory('2.0.0').packages[0].changelogBullets).toEqual(['Same', 'ok']);
  });
});
