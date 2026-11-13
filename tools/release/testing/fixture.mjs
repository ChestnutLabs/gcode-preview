// Test-only helpers for the release-tooling suites (tools/release/*.test.mjs).
//
// Every release script resolves the repo root from its own file location (`../..`), so the tests
// copy the real scripts into a throwaway fake repo and run them there: the copy's root is the
// fixture by construction, and nothing ever reads or writes the real repo's files. Temp dirs live
// under os.tmpdir() (point TMP/TEMP at a scratch dir to move them) and are removed by `cleanup()`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const releaseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The release scripts a fixture repo carries (the real files, copied verbatim). */
export const SCRIPTS = [
  'doc-surfaces.mjs',
  'check-release-docs.mjs',
  'stamp-release-docs.mjs',
  'sync-internal-ranges.mjs',
  'publish.mjs'
];

const made = [];

/** A new empty temp dir, tracked for `cleanup()`. */
export function tempDir(prefix = 'release-tools-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/** Removes every temp dir this module made (call from afterEach). */
export function cleanup() {
  while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
}

/** Writes `files` ({ relPath: content }) under `root`, creating directories. */
export function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
  }
}

export function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

export function exists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

/** A fake repo with the release scripts copied in and the given files written. Returns its root. */
export function makeRepo(files = {}) {
  const root = tempDir();
  for (const s of SCRIPTS) {
    fs.mkdirSync(path.join(root, 'tools', 'release'), { recursive: true });
    fs.copyFileSync(path.join(releaseDir, s), path.join(root, 'tools', 'release', s));
  }
  writeFiles(root, files);
  return root;
}

/** Imports the fixture's copy of a release module (a fresh module instance per fixture). */
export function importFrom(root, script) {
  return import(pathToFileURL(path.join(root, 'tools', 'release', script)).href);
}

// ---------------------------------------------------------------------------
// git, hermetic: no global or system config, fixed identity, no signing.
// ---------------------------------------------------------------------------

/** Env for git (and for scripts that call git) that ignores the machine's git config. */
export function gitEnv(root, base = process.env) {
  const empty = path.join(root, '.gitconfig-empty');
  if (!fs.existsSync(empty)) fs.writeFileSync(empty, '');
  return {
    ...base,
    GIT_CONFIG_GLOBAL: empty,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'release-tools-test',
    GIT_AUTHOR_EMAIL: 'release-tools-test@example.invalid',
    GIT_COMMITTER_NAME: 'release-tools-test',
    GIT_COMMITTER_EMAIL: 'release-tools-test@example.invalid'
  };
}

export function git(root, ...args) {
  const r = spawnSync('git', args, { cwd: root, env: gitEnv(root), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

export function gitInit(root) {
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'tag.gpgsign', 'false');
  git(root, 'config', 'core.autocrlf', 'false');
}

export function commitAll(root, message = 'commit') {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--allow-empty', '-m', message);
}

/** Runs a fixture script with node. Returns { status, stdout, stderr }. */
export function runScript(root, script, args = [], env = gitEnv(root)) {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'release', script), ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 60_000
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// ---------------------------------------------------------------------------
// Fixture docs that satisfy every surface, narrative check and review check for `version`.
// ---------------------------------------------------------------------------

export function readmeRoot(v) {
  return `# Fixture\n\nThe packages publish to npm in lockstep (currently **v${v}**) with npm provenance.\n`;
}

export function manualIndex(v) {
  return `# Manual\n\n> **Status:** published — all packages are on npm (latest \`v${v}\`,\n> with provenance).\n`;
}

/** docs/README.md: the wrapped published line, the current-state lead and the history list. */
export function docsReadme(v, { lead = v, history = [v], published = v, sep = '\n' } = {}) {
  return [
    '# Docs',
    '',
    `## Current state (updated 2026-11-12 — **v${lead} shipped to npm** (14 lockstep pkgs): fixture story.)`,
    '',
    `All packages are published to npm at${sep}\`v${published}\`** (lockstep); \`main\` is the release branch,`,
    `publishing from tagged GitHub Releases (${history.map((h) => `\`v${h}\` label`).join(', ')}).`,
    '',
    'Changesets accumulate on `dev` for the next release.',
    ''
  ].join('\n');
}

/** A RELEASE_REVIEW.md body. `rows` are disposition keywords; `markers` override the globals. */
export function review(v, { rows = ['reviewed'], markers = {}, versionLine } = {}) {
  const m = { Product: 'resolved', Docs: 'resolved', Visual: 'resolved', ...markers };
  return [
    '<!-- header: never `Status: pending`; "Product review: resolved" -->',
    '',
    `# Release review — v${v}`,
    '',
    versionLine ?? `**Review version:** v${v}`,
    '',
    '| Package | Changed src files | Changelog summary | Disposition |',
    '|---|--:|---|---|',
    ...rows.map((s, i) => `| \`@chestnutlabs/p${i}\` | 1 | summary | Status: ${s} |`),
    '',
    'Set each **Disposition** to `Status: reviewed` (never `Status: pending`).',
    '',
    ...Object.entries(m)
      .filter(([, val]) => val !== null)
      .map(([k, val]) => `- **${k} review:** ${val} — guidance.`),
    ''
  ].join('\n');
}

/** A package.json for packages/<dir>. */
export function pkg(name, version, extra = {}) {
  return { name, version, ...extra };
}

/** The files of a fake repo that passes check-release-docs for `version`. */
export function passingRepoFiles(version) {
  return {
    'packages/toolpath-core/package.json': pkg('@chestnutlabs/toolpath-core', version),
    'README.md': readmeRoot(version),
    'docs/manual/index.md': manualIndex(version),
    'docs/README.md': docsReadme(version),
    'RELEASE_REVIEW.md': review(version)
  };
}

// ---------------------------------------------------------------------------
// npm stub for publish.mjs. publish.mjs runs `npm` (`npm.cmd` with a shell on Windows); the stub
// goes first on PATH, logs each call, and is proven to be what the child resolves before any spawn.
// ---------------------------------------------------------------------------

const STUB_MARK = 'RELEASE-TOOLS-NPM-STUB';

const STUB_JS = `
import fs from 'node:fs';
import path from 'node:path';
const argv = process.argv.slice(2);
if (argv[0] === '--stub-probe') { process.stdout.write('${STUB_MARK}\\n'); process.exit(0); }
let manifest = {};
try { manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')); } catch {}
fs.appendFileSync(process.env.RELEASE_TOOLS_STUB_LOG, JSON.stringify({
  argv, name: manifest.name ?? null, private: manifest.private === true,
  sawToken: Boolean(process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN),
  registry: process.env.npm_config_registry ?? null,
  npmConfig: Object.keys(process.env).filter((k) => /^npm_config_/i.test(k)).sort()
}) + '\\n');
const list = (k) => (process.env[k] || '').split(',').filter(Boolean);
if (argv[0] === 'view') {
  // "name@version version": print a version for a "published" package, else fail like an E404.
  const published = Object.fromEntries(list('RELEASE_TOOLS_STUB_PUBLISHED').map((e) => e.split('=')));
  const answer = published[manifest.name];
  if (answer === undefined) { process.stderr.write('npm error code E404\\n'); process.exit(1); }
  process.stdout.write((answer || manifest.version) + '\\n');
  process.exit(0);
}
if (list('RELEASE_TOOLS_STUB_FAIL').includes(manifest.name)) { process.stderr.write('stub: failing ' + manifest.name + '\\n'); process.exit(1); }
process.stdout.write('npm notice total files: 3\\nnpm notice package size: 1.5 kB\\n');
`;

function pathKeys(env) {
  return Object.keys(env).filter((k) => k.toUpperCase() === 'PATH');
}

/** Names that must never reach a publish.mjs child (credentials, OIDC, the real-publish switches). */
export function isForbiddenPublishEnv(key) {
  const k = key.toUpperCase();
  return (
    k === 'NPM_TOKEN' ||
    k === 'NODE_AUTH_TOKEN' ||
    /^NPM_CONFIG_.*_AUTHTOKEN$/.test(k) ||
    k.startsWith('NPM_CONFIG_//') ||
    k === 'ACTIONS_ID_TOKEN_REQUEST_URL' ||
    k === 'ACTIONS_ID_TOKEN_REQUEST_TOKEN' ||
    k === 'GITHUB_ACTIONS' ||
    k === 'RELEASE_CONFIRM'
  );
}

/**
 * Fail closed: resolves `npm` exactly the way publish.mjs does (`npm.cmd` through a shell on Windows,
 * `npm` on PATH elsewhere) with `env`, and throws unless the stub answers.
 */
export function assertStubResolves(env) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const probe = spawnSync(npmCmd, ['--stub-probe'], { env, encoding: 'utf8', shell: process.platform === 'win32' });
  if (probe.status !== 0 || !String(probe.stdout).includes(STUB_MARK)) {
    throw new Error(`npm stub is not what the child resolves (status ${probe.status}): ${probe.stdout}${probe.stderr}`);
  }
}

/**
 * Installs the npm stub in a temp dir and returns { env, logFile, calls() } for spawning publish.mjs.
 * The env has the stub first on PATH, a dead registry, and every credential / OIDC / publish switch
 * removed. Throws (fail closed) unless `npm` as publish.mjs runs it resolves to the stub.
 *
 * - `fail`: package names whose `npm publish` exits 1.
 * - `published`: { name: versionOrEmpty } that `npm view` reports as on the registry ('' = the
 *   manifest's own version); every other name gets an E404.
 * - `realBranch`: set ONLY the two workflow switches publish.mjs checks (GITHUB_ACTIONS=true,
 *   RELEASE_CONFIRM=publish), after the credential check, so the non-dry branch runs against the
 *   stub. No token, OIDC variable or .npmrc is ever set or read.
 */
export function npmStub({ fail = [], published = {}, realBranch = false } = {}) {
  const dir = tempDir('release-tools-npm-');
  const stubJs = path.join(dir, 'npm-stub.mjs');
  fs.writeFileSync(stubJs, STUB_JS);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, 'npm.cmd'), `@"${process.execPath}" "${stubJs}" %*\r\n`);
  } else {
    fs.writeFileSync(path.join(dir, 'npm'), `#!/bin/sh\nexec "${process.execPath}" "${stubJs}" "$@"\n`, {
      mode: 0o755
    });
  }
  const logFile = path.join(dir, 'calls.jsonl');

  // Never let the non-dry branch run where the job can mint a publish identity (release-publish.yml
  // has id-token: write). The suite skips those tests there; this is the backstop if a skip is lost.
  if (realBranch && process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    throw new Error('npmStub: refusing realBranch where ACTIONS_ID_TOKEN_REQUEST_URL is set (an OIDC-capable job)');
  }

  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    // Drop credentials and the publish switches, and every npm config var in any case (an uppercase
    // NPM_CONFIG_REGISTRY or NPM_CONFIG_USERCONFIG beats a lowercase one on Windows).
    if (!isForbiddenPublishEnv(k) && !/^npm_config_/i.test(k)) env[k] = v;
  }
  const oldPath = pathKeys(env)
    .map((k) => env[k])
    .find(Boolean);
  for (const k of pathKeys(env)) delete env[k];
  env.PATH = oldPath ? dir + path.delimiter + oldPath : dir;
  // A leak to a real npm would fail here, locally, never at the registry, and read no user or global npmrc.
  const emptyRc = path.join(dir, 'empty.npmrc');
  fs.writeFileSync(emptyRc, '');
  env.npm_config_registry = 'http://127.0.0.1:9';
  env.npm_config_userconfig = emptyRc;
  env.npm_config_globalconfig = emptyRc;
  env.RELEASE_TOOLS_STUB_LOG = logFile;
  if (fail.length) env.RELEASE_TOOLS_STUB_FAIL = fail.join(',');
  const pub = Object.entries(published).map(([n, v]) => `${n}=${v}`);
  if (pub.length) env.RELEASE_TOOLS_STUB_PUBLISHED = pub.join(',');

  assertStubResolves(env);
  for (const k of Object.keys(env)) {
    if (isForbiddenPublishEnv(k)) throw new Error(`forbidden env ${k} reached the publish child`);
  }
  if (realBranch) {
    env.GITHUB_ACTIONS = 'true';
    env.RELEASE_CONFIRM = 'publish';
  }

  return {
    env,
    logFile,
    calls: () =>
      fs.existsSync(logFile)
        ? fs
            .readFileSync(logFile, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l))
        : []
  };
}
