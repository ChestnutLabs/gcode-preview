#!/usr/bin/env node
// Local pre-push gate: one command that runs the same checks CI runs, in the order CI runs them,
// and stops at the first failure.
//
//   npm run gate               # build + package dists + lint + typeCheck + root and package tests
//                              # + docs links + typedoc
//   npm run gate -- --ci       # also the rest of CI's `build` job: license gates, no-runtime-deps,
//                              # the tarball consumer fixture, and pack:check
//   npm run gate -- --install  # run `npm ci` first (after a lockfile or branch change)
//
// Test workers are capped (default 8; GATE_MAX_WORKERS overrides) because the gate often runs on a
// shared machine. The package dists build in dependency order, derived from each package's
// `@chestnutlabs/*` dependencies, so a new package or a new sibling dependency needs no edit here.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCOPE = '@chestnutlabs/';

/**
 * Dependency order for the workspace packages: every package comes after the siblings it depends on.
 * `manifests` maps a package name to its package.json. Ties keep the input order, so the result is
 * deterministic. Throws on a dependency cycle.
 */
export function buildOrder(manifests) {
  const names = Object.keys(manifests);
  const known = new Set(names);
  const deps = new Map(
    names.map((name) => {
      const m = manifests[name];
      const all = { ...m.dependencies, ...m.peerDependencies, ...m.devDependencies };
      return [name, Object.keys(all).filter((d) => d !== name && known.has(d))];
    })
  );
  const order = [];
  const done = new Set();
  while (order.length < names.length) {
    const next = names.find((n) => !done.has(n) && deps.get(n).every((d) => done.has(d)));
    if (next === undefined) {
      const stuck = names.filter((n) => !done.has(n));
      throw new Error(`gate: dependency cycle among ${stuck.join(', ')}`);
    }
    order.push(next);
    done.add(next);
  }
  return order;
}

/** The ordered steps the gate runs. Each step is `{ name, cmd }`, where `cmd` is a shell command line. */
export function planSteps({ order, ci = false, install = false, maxWorkers = 8 }) {
  const w = `--maxWorkers=${maxWorkers}`;
  const steps = [];
  if (install) steps.push({ name: 'install', cmd: 'npm ci' });
  if (ci) {
    steps.push({ name: 'pack:license-check', cmd: 'npm run pack:license-check' });
    steps.push({ name: 'check:no-runtime-deps', cmd: 'npm run check:no-runtime-deps' });
  }
  steps.push({ name: 'build (root bundle)', cmd: 'npm run build' });
  for (const pkg of order) steps.push({ name: `build ${pkg}`, cmd: `npm run build -w ${pkg}` });
  steps.push({ name: 'lint', cmd: 'npm run lint' });
  steps.push({ name: 'typeCheck', cmd: 'npm run typeCheck' });
  steps.push({ name: 'test (root)', cmd: `npx vitest run ${w}` });
  // `npm test --workspaces -- <flag>` forwards the flag to each package's vitest. Through
  // `npm run test:packages` it would need two `--`; with one, npm swallows it and vitest runs uncapped.
  steps.push({ name: 'test:packages', cmd: `npm test --workspaces --if-present -- ${w}` });
  if (ci) {
    steps.push({ name: 'license:check', cmd: 'npm run license:check' });
  }
  steps.push({ name: 'docs:links', cmd: 'npm run docs:links' });
  if (ci) {
    steps.push({ name: 'test:consumer-vue', cmd: 'npm run test:consumer-vue' });
    steps.push({ name: 'pack:check', cmd: 'npm run pack:check' });
  }
  steps.push({ name: 'docs:build', cmd: 'npm run docs:build' });
  return steps;
}

function readManifests(root) {
  const dir = path.join(root, 'packages');
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name, 'package.json');
    if (!entry.isDirectory() || !fs.existsSync(file)) continue;
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof m.name === 'string' && m.name.startsWith(SCOPE)) out[m.name] = m;
  }
  return out;
}

function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const known = new Set(['--ci', '--install']);
  const bad = argv.filter((a) => !known.has(a));
  if (bad.length > 0) {
    console.error(`gate: unknown option ${bad.join(' ')} (expected --ci and/or --install)`);
    return 2;
  }
  const raw = process.env.GATE_MAX_WORKERS ?? '8';
  const maxWorkers = Number(raw);
  if (!Number.isInteger(maxWorkers) || maxWorkers < 1) {
    console.error(`gate: GATE_MAX_WORKERS must be a positive integer, got '${raw}'`);
    return 2;
  }
  const steps = planSteps({
    order: buildOrder(readManifests(root)),
    ci: argv.includes('--ci'),
    install: argv.includes('--install'),
    maxWorkers
  });
  const started = Date.now();
  for (const [i, step] of steps.entries()) {
    console.log(`\n▶ gate ${i + 1}/${steps.length}: ${step.name}  (${step.cmd})`);
    const t = Date.now();
    const r = spawnSync(step.cmd, { cwd: root, stdio: 'inherit', shell: true });
    if (r.status !== 0) {
      console.error(`\n✖ gate FAILED at ${step.name} (exit ${r.status ?? r.signal}) after ${secs(started)}`);
      return 1;
    }
    console.log(`✔ ${step.name} (${secs(t)})`);
  }
  console.log(`\n✔ gate GREEN: ${steps.length} steps in ${secs(started)}`);
  return 0;
}

function secs(since) {
  return `${((Date.now() - since) / 1000).toFixed(0)}s`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
