import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildOrder, main, planSteps } from './gate.mjs';

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

// main() runs in-process with a recording stub runner, so no test can start a real build: a broken
// argument check shows up as a recorded call, never as a spawned shell that outlives the test.
describe('gate CLI', () => {
  function drive(argv, { env = {}, fail } = {}) {
    const calls = [];
    const out = [];
    const errs = [];
    const status = main(argv, {
      root: repoRoot,
      env,
      run: (cmd) => {
        calls.push(cmd);
        return cmd === fail ? 1 : 0;
      },
      log: (m) => out.push(m),
      err: (m) => errs.push(m)
    });
    return { status, calls, out: out.join('\n'), errs: errs.join('\n') };
  }

  it('rejects an unknown option before running any step', () => {
    const r = drive(['--ci', '--bogus']);
    expect(r.status).toBe(2);
    expect(r.errs).toBe('gate: unknown option --bogus (expected --ci and/or --install)');
    expect(r.calls).toEqual([]);
  });

  it('rejects a worker cap that is not a positive integer before running any step', () => {
    for (const bad of ['0', '-1', '2.5', 'eight']) {
      const r = drive([], { env: { GATE_MAX_WORKERS: bad } });
      expect(r.status).toBe(2);
      expect(r.errs).toBe(`gate: GATE_MAX_WORKERS must be a positive integer, got '${bad}'`);
      expect(r.calls).toEqual([]);
    }
  });

  it('runs every planned step in order and reports green', () => {
    const r = drive([], { env: { GATE_MAX_WORKERS: '3' } });
    expect(r.status).toBe(0);
    expect(r.calls).toHaveLength(21);
    expect(r.calls[0]).toBe('npm run build');
    expect(r.calls[1]).toBe('npm run build -w @chestnutlabs/toolpath-core');
    expect(r.calls).toContain('npm test --workspaces --if-present -- --maxWorkers=3');
    expect(r.calls.at(-1)).toBe('npm run docs:build');
    expect(r.out).toContain('✔ gate GREEN: 21 steps in');
    expect(r.errs).toBe('');
  });

  it('stops at the first failing step and reports it', () => {
    const r = drive([], { fail: 'npm run lint' });
    expect(r.status).toBe(1);
    expect(r.calls.at(-1)).toBe('npm run lint');
    expect(r.calls).not.toContain('npm run typeCheck');
    expect(r.errs).toContain('✖ gate FAILED at lint (exit 1) after');
    expect(r.out).not.toContain('gate GREEN');
  });

  it('treats a step killed by a signal as a failure', () => {
    // spawnStep returns the signal name when a step is killed (status null).
    const calls = [];
    const errs = [];
    const status = main([], {
      root: repoRoot,
      env: {},
      run: (cmd) => {
        calls.push(cmd);
        return cmd === 'npm run lint' ? 'SIGTERM' : 0;
      },
      log: () => {},
      err: (m) => errs.push(m)
    });
    expect(status).toBe(1);
    expect(calls.at(-1)).toBe('npm run lint');
    expect(errs.join('\n')).toContain('✖ gate FAILED at lint (exit SIGTERM) after');
  });

  it('caps test workers at 8 when GATE_MAX_WORKERS is unset', () => {
    const r = drive([], { env: {} });
    expect(r.status).toBe(0);
    expect(r.calls).toContain('npx vitest run --maxWorkers=8');
    expect(r.calls).toContain('npm test --workspaces --if-present -- --maxWorkers=8');
  });

  it('builds only @chestnutlabs/* packages found under packages/, in dependency order', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
    try {
      const write = (dir, manifest) => {
        fs.mkdirSync(path.join(root, 'packages', dir), { recursive: true });
        if (manifest) fs.writeFileSync(path.join(root, 'packages', dir, 'package.json'), JSON.stringify(manifest));
      };
      write('a', { name: '@chestnutlabs/a', dependencies: { '@chestnutlabs/b': '*' } });
      write('b', { name: '@chestnutlabs/b' });
      write('other', { name: '@other/x' });
      write('unnamed', { version: '1.0.0' });
      write('empty', null);
      fs.writeFileSync(path.join(root, 'packages', 'README.md'), 'not a package');
      const calls = [];
      const status = main([], { root, env: {}, run: (cmd) => (calls.push(cmd), 0), log: () => {}, err: () => {} });
      expect(status).toBe(0);
      expect(calls.filter((c) => c.startsWith('npm run build -w '))).toEqual([
        'npm run build -w @chestnutlabs/b',
        'npm run build -w @chestnutlabs/a'
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes --ci and --install through to the plan', () => {
    const r = drive(['--install', '--ci']);
    expect(r.status).toBe(0);
    expect(r.calls[0]).toBe('npm ci');
    expect(r.calls).toContain('npm run pack:check');
  });
});

describe('planSteps', () => {
  const order = ['@chestnutlabs/a', '@chestnutlabs/b'];

  it('runs the default local gate fail-fast (lint and typeCheck before tests) with capped test workers', () => {
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

  it('keeps --ci and --install independent', () => {
    const ciOnly = planSteps({ order, ci: true }).map((s) => s.name);
    expect(ciOnly).not.toContain('install');
    expect(ciOnly).toContain('license:check');
    const installOnly = planSteps({ order, install: true }).map((s) => s.name);
    expect(installOnly[0]).toBe('install');
    for (const ci of [
      'pack:license-check',
      'check:no-runtime-deps',
      'license:check',
      'test:consumer-vue',
      'pack:check'
    ]) {
      expect(installOnly).not.toContain(ci);
    }
  });

  it('passes the worker cap to both test steps', () => {
    const steps = planSteps({ order, maxWorkers: 3 });
    expect(steps.find((s) => s.name === 'test (root)').cmd).toBe('npx vitest run --maxWorkers=3');
    expect(steps.find((s) => s.name === 'test:packages').cmd).toBe(
      'npm test --workspaces --if-present -- --maxWorkers=3'
    );
  });
});
