/*
 * DD-008 §9 / #129: internal link check over the PUBLIC docs set. Verifies that
 * every relative markdown link resolves to a tracked file (anchors stripped,
 * external URLs skipped). Historical records (docs/design, docs/research,
 * docs/adr, benchmark reports) are point-in-time documents and are exempt.
 *
 * Usage: node tools/link-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tracked = execFileSync('git', ['ls-files', '*.md'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .map((f) => f.replace(/\\/g, '/'));

// Public docs set: everything a release consumer or contributor is pointed at.
const INCLUDE = [
  /^README\.md$/,
  /^NOTICE\.md$/,
  /^CONTRIBUTING\.md$/,
  /^SECURITY\.md$/,
  /^CODE_OF_CONDUCT\.md$/,
  /^PROJECT_SETUP\.md$/,
  /^THIRD_PARTY_NOTICES\.md$/,
  /^docs\/README\.md$/,
  /^docs\/reference\//,
  /^docs\/compatibility\//,
  /^packages\/[^/]+\/README\.md$/,
  /^tools\/[^/]+\/README\.md$/
];

const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

let failed = false;
let checked = 0;

for (const rel of tracked) {
  if (!INCLUDE.some((re) => re.test(rel))) continue;
  const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
  for (const m of text.matchAll(LINK_RE)) {
    let target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    target = target.split('#')[0];
    if (target === '') continue;
    const resolved = path.resolve(repoRoot, path.dirname(rel), decodeURI(target));
    checked++;
    if (!fs.existsSync(resolved)) {
      process.stderr.write(`✗ ${rel}: broken link → ${m[1]}\n`);
      failed = true;
    }
  }
}

if (failed) {
  process.stderr.write('\nlink-check: FAILED\n');
  process.exit(1);
}
process.stderr.write(`link-check: OK (${checked} internal links verified)\n`);
