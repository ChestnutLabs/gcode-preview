import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildOrder, planSteps } from './gate.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('buildOrder', () => {
  it('puts every package after the siblings it depends on, through any dependency field', () => {
    const order = buildOrder({
      '@chestnutlabs/c': { peerDependencies: { '@chestnutlabs/b': '1' } },
      '@chestnutlabs/b': { devDependencies: { '@chestnutlabs/a': '1' } },
      '@chestnutlabs/a': { dependencies: { three: '1' } }
    });
    expect(order).toEqual(['@chestnutlabs/a', '@chestnutlabs/b', '@chestnutlabs/c']);
  });

  it('keeps the input order for independent packages and ignores outside and self dependencies', () => {
    const order = buildOrder({
      '@chestnutlabs/y': { dependencies: { '@chestnutlabs/y': '1', vue: '3' } },
      '@chestnutlabs/x': {},
      '@chestnutlabs/z': { dependencies: { '@chestnutlabs/x': '1' } }
    });
    expect(order).toEqual(['@chestnutlabs/y', '@chestnutlabs/x', '@chestnutlabs/z']);
  });

  it('throws on a cycle and names the packages in it', () => {
    expect(() =>
      buildOrder({
        '@chestnutlabs/ok': {},
        '@chestnutlabs/p': { dependencies: { '@chestnutlabs/q': '1' } },
        '@chestnutlabs/q': { dependencies: { '@chestnutlabs/p': '1' } }
      })
    ).toThrow('gate: dependency cycle among @chestnutlabs/p, @chestnutlabs/q');
  });

  it('orders the real workspace: all 14 packages, toolpath-core first, each after its siblings', () => {
    const manifests = {};
    for (const dir of fs.readdirSync(path.join(repoRoot, 'packages'))) {
      const file = path.join(repoRoot, 'packages', dir, 'package.json');
      if (!fs.existsSync(file)) continue;
      const m = JSON.parse(fs.readFileSync(file, 'utf8'));
      manifests[m.name] = m;
    }
    const order = buildOrder(manifests);
    expect(order).toHaveLength(14);
    expect(order[0]).toBe('@chestnutlabs/toolpath-core');
    expect(order.indexOf('@chestnutlabs/gcode-parser')).toBeLessThan(order.indexOf('@chestnutlabs/gcode-preview-core'));
    expect(order.indexOf('@chestnutlabs/gcode-preview-core')).toBeLessThan(
      order.indexOf('@chestnutlabs/gcode-preview-element')
    );
    for (const name of order) {
      const m = manifests[name];
      const deps = Object.keys({ ...m.dependencies, ...m.peerDependencies, ...m.devDependencies });
      for (const d of deps) {
        if (d in manifests && d !== name) expect(order.indexOf(d)).toBeLessThan(order.indexOf(name));
      }
    }
  });
});

describe('gate CLI', () => {
  const script = path.join(repoRoot, 'tools', 'gate.mjs');
  const run = (args, env = {}) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      timeout: 30000
    });

  it('rejects an unknown option before running any step', () => {
    const r = run(['--bogus']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('gate: unknown option --bogus (expected --ci and/or --install)');
    expect(r.stdout).not.toContain('▶ gate');
  });

  it('rejects a worker cap that is not a positive integer before running any step', () => {
    for (const bad of ['0', '-1', '2.5', 'eight']) {
      const r = run([], { GATE_MAX_WORKERS: bad });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`gate: GATE_MAX_WORKERS must be a positive integer, got '${bad}'`);
      expect(r.stdout).not.toContain('▶ gate');
    }
  });
});

describe('planSteps', () => {
  const order = ['@chestnutlabs/a', '@chestnutlabs/b'];

  it('runs the default local gate in CI order with capped test workers', () => {
    expect(planSteps({ order })).toEqual([
      { name: 'build (root bundle)', cmd: 'npm run build' },
      { name: 'build @chestnutlabs/a', cmd: 'npm run build -w @chestnutlabs/a' },
      { name: 'build @chestnutlabs/b', cmd: 'npm run build -w @chestnutlabs/b' },
      { name: 'lint', cmd: 'npm run lint' },
      { name: 'typeCheck', cmd: 'npm run typeCheck' },
      { name: 'test (root)', cmd: 'npx vitest run --maxWorkers=8' },
      { name: 'test:packages', cmd: 'npm test --workspaces --if-present -- --maxWorkers=8' },
      { name: 'docs:links', cmd: 'npm run docs:links' },
      { name: 'docs:build', cmd: 'npm run docs:build' }
    ]);
  });

  it('adds the rest of the CI build job with --ci, and npm ci first with --install', () => {
    const names = planSteps({ order: ['@chestnutlabs/a'], ci: true, install: true, maxWorkers: 3 }).map((s) => s.name);
    expect(names).toEqual([
      'install',
      'pack:license-check',
      'check:no-runtime-deps',
      'build (root bundle)',
      'build @chestnutlabs/a',
      'lint',
      'typeCheck',
      'test (root)',
      'test:packages',
      'license:check',
      'docs:links',
      'test:consumer-vue',
      'pack:check',
      'docs:build'
    ]);
  });

  it('passes the worker cap to both test steps', () => {
    const steps = planSteps({ order, maxWorkers: 3 });
    expect(steps.find((s) => s.name === 'test (root)').cmd).toBe('npx vitest run --maxWorkers=3');
    expect(steps.find((s) => s.name === 'test:packages').cmd).toBe(
      'npm test --workspaces --if-present -- --maxWorkers=3'
    );
  });
});
