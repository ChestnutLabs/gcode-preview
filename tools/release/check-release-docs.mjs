/*
 * Doc-freshness gate — the blocking check that keeps the docs honest AT release time.
 * Runs in CI on promotion PRs to `main` (the last stop before a tag/publish) so a release
 * can never be cut while the user-facing docs still name the previous version.
 *
 * FAILS (exit 1) when, for the lockstep version being cut:
 *   - any deterministic surface (SURFACES) declares a different version or its anchor is gone;
 *   - the docs/README "Current state" block does not LEAD with this version;
 *   - the release-history list does not include this version;
 *   - RELEASE_NOTES_DRAFT.md still exists (the narrative draft was never folded in + removed).
 *
 * WARNS (non-fatal) with a screenshots/guides review reminder — that judgment call is
 * surfaced here and enforced by the promotion PR-template checkbox, not hard-failed.
 *
 * Usage: node tools/release/check-release-docs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  repoRoot,
  readVersion,
  SURFACES,
  DRAFT_FILE,
  currentVersionOf,
  narrativeChecks,
  aggregateChangelog
} from './doc-surfaces.mjs';

const version = readVersion();
const failures = [];

// 1) Deterministic surfaces.
for (const surface of SURFACES) {
  const content = fs.readFileSync(path.join(repoRoot, surface.file), 'utf8');
  const current = currentVersionOf(surface, content);
  if (current === null) {
    failures.push(`${surface.file}: anchor for ${surface.label} not found (doc structure drifted)`);
  } else if (current !== version) {
    failures.push(`${surface.file}: ${surface.label} says v${current}, release is v${version}`);
  }
}

// 2) Narrative surfaces (docs/README.md).
const readmeDocs = fs.readFileSync(path.join(repoRoot, 'docs', 'README.md'), 'utf8');
for (const r of narrativeChecks(readmeDocs, version)) {
  if (!r.ok) failures.push(`docs/README.md: ${r.detail}`);
}

// 3) The narrative draft must have been folded in and removed.
if (fs.existsSync(path.join(repoRoot, DRAFT_FILE))) {
  failures.push(`${DRAFT_FILE} still present — fold it into docs/README.md's current-state + history, then delete it`);
}

// --- Non-fatal: surface the screenshots/guides judgment call. ---
const { changedPackages } = aggregateChangelog(version);
process.stderr.write(`\ndocs-release-check: v${version}\n`);
process.stderr.write('REVIEW (not auto-checked): does this release need README/guide edits or a screenshot refresh?\n');
if (changedPackages.length) {
  process.stderr.write(`  packages changed this release: ${changedPackages.join(', ')}\n`);
}
process.stderr.write('  see CLAUDE.md "Public-docs completion check"; confirm via the promotion PR checkbox.\n\n');

if (failures.length) {
  process.stderr.write(`docs-release-check: FAIL — docs do not match v${version}:\n`);
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.stderr.write(
    '\nRun `node tools/release/stamp-release-docs.mjs` and finish the narrative, or fix the surfaces above.\n'
  );
  process.exit(1);
}

process.stderr.write(`docs-release-check: PASS — all version surfaces agree with v${version}.\n`);
