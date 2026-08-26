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

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The lockstep version every package shares — read from one representative package. */
export function readVersion() {
  const p = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages', 'toolpath-core', 'package.json'), 'utf8'));
  return p.version;
}

export const DRAFT_FILE = 'RELEASE_NOTES_DRAFT.md';

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
