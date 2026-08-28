/*
 * Doc-freshness: the single source of truth for the user-facing "what version is live"
 * surfaces, shared by the stamper (tools/release/stamp-release-docs.mjs, run inside
 * `npm run version`) and the release gate (tools/release/check-release-docs.mjs, run on
 * promotion PRs to `main`). Keeping both on one description means a stamp and its gate can
 * never disagree about where the version lives.
 *
 * Two tiers, matching the release-docs policy:
 *   - DETERMINISTIC surfaces: pure "vX.Y.Z is on npm" strings. Stamped automatically in the
 *     Version PR; the gate asserts they equal the version being cut.
 *   - NARRATIVE surfaces: the curated docs/README "Current state" story + release-history
 *     list. NOT auto-written (kept human-reviewed); the gate only asserts they name the
 *     version being cut, forcing the story to land WITH the release, not after it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The lockstep version every package shares — read from one representative package. */
export function readVersion() {
  const p = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages', 'toolpath-core', 'package.json'), 'utf8'));
  return p.version;
}

export const DRAFT_FILE = 'RELEASE_NOTES_DRAFT.md';

/**
 * The per-release Public Product + Docs + Visual review artifact (repo root). Mirrors
 * DRAFT_FILE but INVERTED: the draft must be ABSENT to promote, this must be PRESENT and
 * fully RESOLVED. The stamper seeds it (Status: pending) inside the Version PR; the gate
 * (reviewChecks) blocks promotion until every disposition is resolved for the version cut.
 */
export const REVIEW_FILE = 'RELEASE_REVIEW.md';

/** The disposition keywords a per-package review row may carry (NOT `pending`). */
export const REVIEW_STATUSES = ['reviewed', 'no-change-needed', 'not-applicable'];

const SEMVER = String.raw`\d+\.\d+\.\d+`;

/**
 * Deterministic version-string surfaces. Each entry:
 *   file    — repo-relative path
 *   label   — human description for messages
 *   re      — global RegExp matching the whole version token (exactly one occurrence expected)
 *   format  — (version) => the token's replacement text
 * `re` must contain a `vX.Y.Z` so the current version can be read back for the gate.
 */
export const SURFACES = [
  {
    file: 'README.md',
    label: 'lockstep-version note',
    re: new RegExp(String.raw`\(currently \*\*v${SEMVER}\*\*\)`, 'g'),
    format: (v) => `(currently **v${v}**)`
  },
  {
    file: 'docs/manual/index.md',
    label: 'published-status line',
    re: new RegExp('latest `v' + SEMVER + '`', 'g'),
    format: (v) => 'latest `v' + v + '`'
  },
  {
    file: 'docs/README.md',
    label: 'published-to-npm line',
    // Spans a line wrap ("...published to npm at\n`v0.14.0`"): keep the author's separator.
    re: new RegExp('(published to npm at\\s+`v)' + SEMVER + '(`)', 'g'),
    format: null, // custom: preserve captured separator (see applySurface)
    replace: (content, v) =>
      content.replace(
        new RegExp('(published to npm at\\s+`v)' + SEMVER + '(`)', 'g'),
        (_m, pre, post) => pre + v + post
      )
  }
];

const VERSION_IN_TOKEN = new RegExp('v(' + SEMVER + ')');

/**
 * Read the version a deterministic surface currently declares (null if the anchor is
 * missing — a structural drift the caller should treat as an error).
 */
export function currentVersionOf(surface, content) {
  const m = content.match(surface.re);
  if (!m || m.length === 0) return null;
  return m[0].match(VERSION_IN_TOKEN)?.[1] ?? null;
}

/** Rewrite one deterministic surface's content to `version`. Returns the new content. */
export function applySurface(surface, content, version) {
  if (surface.replace) return surface.replace(content, version);
  return content.replace(surface.re, () => surface.format(version));
}

/**
 * Narrative assertions on docs/README.md. Returns an array of { ok, detail } — the gate
 * fails if any is not ok. These force the curated story to name the version being cut.
 */
export function narrativeChecks(content, version) {
  const results = [];

  // 1) The "Current state" block must LEAD with the version being shipped.
  const lead = content.match(/## Current state \(updated \d{4}-\d{2}-\d{2} — \*\*v(\d+\.\d+\.\d+) shipped/);
  results.push({
    ok: lead?.[1] === version,
    detail: lead
      ? `Current-state block leads with v${lead[1]} (expected v${version})`
      : `Current-state heading not found or malformed (expected "## Current state (updated <date> — **v${version} shipped …")`
  });

  // 2) The release-history list must include the version being shipped.
  const histStart = content.indexOf('publishing from tagged');
  const histEnd = content.indexOf('Changesets accumulate');
  const history = histStart >= 0 && histEnd > histStart ? content.slice(histStart, histEnd) : '';
  results.push({
    ok: history.includes('`v' + version + '`'),
    detail: history
      ? `Release-history list ${history.includes('`v' + version + '`') ? 'includes' : 'is MISSING'} \`v${version}\``
      : 'Release-history list region not found (anchors "publishing from tagged" … "Changesets accumulate")'
  });

  return results;
}

/**
 * Aggregate the just-generated CHANGELOG bullets for `version` across all packages,
 * de-duplicated, dropping changelog-github's internal "Updated dependencies" noise.
 * Used to seed the human-reviewed narrative draft.
 */
export function aggregateChangelog(version) {
  const pkgsDir = path.join(repoRoot, 'packages');
  const dirs = fs.existsSync(pkgsDir)
    ? fs.readdirSync(pkgsDir).filter((d) => fs.existsSync(path.join(pkgsDir, d, 'CHANGELOG.md')))
    : [];
  const seen = new Set();
  const bullets = [];
  const changed = [];
  for (const d of dirs) {
    const cl = fs.readFileSync(path.join(pkgsDir, d, 'CHANGELOG.md'), 'utf8');
    const start = cl.indexOf(`\n## ${version}\n`);
    if (start < 0) continue;
    const rest = cl.slice(start + 1);
    const next = rest.indexOf('\n## ');
    const section = next >= 0 ? rest.slice(0, next) : rest;
    let pkgTouched = false;
    for (const raw of section.split('\n')) {
      const line = raw.trim();
      if (!line.startsWith('- ')) continue;
      if (/^- Updated dependencies/i.test(line)) continue;
      if (/^- @chestnutlabs\//.test(line)) continue; // dependency echo lines
      // Strip changelog-github's leading commit hash ("- abc1234: text" / "- abc1234 text").
      const text = line.replace(/^- [0-9a-f]{7,40}:?\s*/i, '- ').replace(/^-\s+/, '');
      if (!text) continue;
      pkgTouched = true;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      bullets.push(text);
    }
    if (pkgTouched) changed.push('@chestnutlabs/' + d);
  }
  return { bullets, changedPackages: changed };
}

// ---------------------------------------------------------------------------
// Release Public Product + Docs + Visual review (RELEASE_REVIEW.md) — the
// changed-capability inventory that seeds it, and the gate that resolves it.
// ---------------------------------------------------------------------------

/** Numeric [major, minor, patch] for a clean `vX.Y.Z` tag, or null for anything else. */
function parseReleaseTag(tag) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function cmpSemver(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * The previous published tag RELATIVE to `version`: the greatest clean `vX.Y.Z` tag whose
 * version is strictly LESS than `version`. Deliberately compares by version rather than by
 * commit date, and ignores non-`vX.Y.Z` tags (pre-release/upstream-legacy noise), so an
 * unrelated higher-numbered tag in the namespace can never be mistaken for "previous".
 * Returns null when there is no earlier release (first release, or git unavailable).
 */
export function previousReleaseTag(version) {
  const cur = parseReleaseTag('v' + version);
  if (!cur) return null;
  let raw = '';
  try {
    raw = execFileSync('git', ['tag', '--list', 'v*'], { cwd: repoRoot, encoding: 'utf8' });
  } catch {
    return null;
  }
  const earlier = raw
    .split('\n')
    .filter(Boolean)
    .map((t) => ({ tag: t.trim(), v: parseReleaseTag(t.trim()) }))
    .filter((e) => e.v && cmpSemver(e.v, cur) < 0)
    .sort((a, b) => cmpSemver(a.v, b.v));
  return earlier.length ? earlier[earlier.length - 1].tag : null;
}

/** Top-level changelog summary lines for one package's `version` section (deduped, hash-stripped). */
function packageChangelogBullets(pkgDir, version) {
  const clPath = path.join(repoRoot, 'packages', pkgDir, 'CHANGELOG.md');
  if (!fs.existsSync(clPath)) return [];
  const cl = fs.readFileSync(clPath, 'utf8');
  const start = cl.indexOf(`\n## ${version}\n`);
  if (start < 0) return [];
  const rest = cl.slice(start + 1);
  const next = rest.indexOf('\n## ');
  const section = next >= 0 ? rest.slice(0, next) : rest;
  const bullets = [];
  const seen = new Set();
  for (const raw of section.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('- ')) continue;
    if (/^- Updated dependencies/i.test(line)) continue;
    if (/^- @chestnutlabs\//.test(line)) continue;
    // Prefer the changeset summary (the text after "! - "); else strip the leading hash.
    let text = line.replace(/^-\s+/, '');
    const bang = text.indexOf('! - ');
    text = bang >= 0 ? text.slice(bang + 4) : text.replace(/^\[?[0-9a-f]{7,40}\]?:?\s*/i, '');
    text = text.trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    bullets.push(text);
  }
  return bullets;
}

/**
 * The changed-capability inventory that seeds RELEASE_REVIEW.md: every package whose
 * `src/` changed since the previous release tag, with its changed files and its own
 * changelog summary lines for this version. Also reuses aggregateChangelog() for the
 * de-duped cross-package bullet list.
 *
 * Returns { prevTag, packages, aggregatedBullets } where `packages` is the structured list
 *   { package, changedFiles, changelogBullets }
 * requested by the review contract, and `prevTag` (null on the first release) lets callers
 * explain what the inventory was diffed against.
 *
 * No-previous-tag case: every package directory is treated as changed (empty changedFiles).
 */
export function changedCapabilityInventory(version) {
  const prevTag = previousReleaseTag(version);
  const pkgsDir = path.join(repoRoot, 'packages');
  const allPkgs = fs.existsSync(pkgsDir)
    ? fs.readdirSync(pkgsDir).filter((d) => fs.existsSync(path.join(pkgsDir, d, 'package.json')))
    : [];

  const filesByPkg = new Map();
  if (prevTag) {
    let out = '';
    try {
      out = execFileSync('git', ['diff', '--name-only', `${prevTag}..HEAD`, '--', 'packages'], {
        cwd: repoRoot,
        encoding: 'utf8'
      });
    } catch {
      out = '';
    }
    for (const f of out.split('\n').filter(Boolean)) {
      const rel = f.replace(/\\/g, '/');
      const m = /^packages\/([^/]+)\/src\//.exec(rel);
      if (!m) continue; // only src changes count as a changed capability
      if (!filesByPkg.has(m[1])) filesByPkg.set(m[1], []);
      filesByPkg.get(m[1]).push(rel);
    }
  } else {
    for (const d of allPkgs) filesByPkg.set(d, []);
  }

  const { bullets: aggregatedBullets } = aggregateChangelog(version);
  const packages = [...filesByPkg.keys()].sort().map((name) => ({
    package: '@chestnutlabs/' + name,
    changedFiles: filesByPkg.get(name).slice().sort(),
    changelogBullets: packageChangelogBullets(name, version)
  }));

  return { prevTag, packages, aggregatedBullets };
}

/**
 * Machine-checkable assertions on RELEASE_REVIEW.md content. Returns an array of
 * { ok, message } — the gate fails if any is not ok. Purely content-based (no git), so the
 * gate is deterministic regardless of tag history. It fails when:
 *   - the file does not declare the exact `version` (the "Review version:" anchor);
 *   - any per-package row's `Status:` is still `pending` (or an unrecognized keyword);
 *   - any of the three global markers (Product/Docs/Visual review) is missing or `pending`.
 * The greppable conventions are documented in the file's own header comment.
 */
export function reviewChecks(content, version) {
  const results = [];

  // 1) Version anchor: "**Review version:** v0.18.0" (bold optional, leading v optional).
  const vm = content.match(/Review version:[\s*]*v?(\d+\.\d+\.\d+)/i);
  results.push({
    ok: vm?.[1] === version,
    message: vm
      ? `declares review version v${vm[1]} (expected v${version})`
      : `missing the "Review version: vX.Y.Z" anchor (expected v${version})`
  });

  // 2) Per-package dispositions: no row may remain `pending` (or carry an unknown keyword).
  //    A disposition is a table cell `| Status: <keyword> |` — anchoring to the cell delimiters
  //    keeps prose mentions of "Status: pending" (in the header comment / guidance) from matching.
  const statusRe = /\|\s*Status:\s*([A-Za-z-]+)\s*\|/g;
  let m;
  let rows = 0;
  const unresolved = [];
  while ((m = statusRe.exec(content)) !== null) {
    rows++;
    const kw = m[1].toLowerCase();
    if (!REVIEW_STATUSES.includes(kw)) unresolved.push(kw);
  }
  results.push({
    ok: unresolved.length === 0,
    message:
      unresolved.length === 0
        ? `all ${rows} package disposition(s) resolved`
        : `unresolved package disposition(s): ${unresolved.join(', ')} (allowed: ${REVIEW_STATUSES.join(' / ')})`
  });

  // 3) Global disposition markers — all three bold list items must say `resolved`. Anchored to
  //    the bold `**<X> review:**` syntax so the header comment's quoted example never matches.
  for (const label of ['Product review', 'Docs review', 'Visual review']) {
    const rm = content.match(new RegExp('\\*\\*' + label + ':\\*\\*\\s*([A-Za-z-]+)', 'i'));
    const kw = rm?.[1]?.toLowerCase() ?? null;
    results.push({
      ok: kw === 'resolved',
      message: rm
        ? `${label}: ${kw} (expected resolved)`
        : `${label}: marker not found (expected "**${label}:** resolved")`
    });
  }

  return results;
}
