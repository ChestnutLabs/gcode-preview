// Compile + mount check of the shipped Svelte adapter components under ONE svelte major (issue #444).
//
// The package build is tsc + a raw copy of the .svelte files and its tests read them as text, so until
// this harness neither Svelte 4 nor Svelte 5 ever compiled or ran the components CI ships. `vitest`,
// `svelte` and the leg's compiler are injected by the leg's compat.test.mjs so every one of them is the
// leg's own install (this directory has no node_modules).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SuiteStubWorker,
  emitSuiteBuild,
  makeSuiteStubGL,
  runComponentConformanceSuite
} from '@chestnutlabs/gcode-preview-core/testing';
import { MODEL_STUB_CONTROLS, MODEL_STUB_GL, makeStlModelSource } from '@chestnutlabs/gcode-model-renderer/testing';
import GcodePreview from '../../../packages/gcode-preview-svelte/src/GcodePreview.svelte';
import ModelViewer from '../../../packages/gcode-preview-svelte/src/model/ModelViewer.svelte';
import { mountComponent } from './mount-api.mjs';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/gcode-preview-svelte');

/** Every .svelte the package ships, derived from its exports map (dist/X -> src/X). */
function shippedComponents() {
  const pkg = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8'));
  const dist = Object.values(pkg.exports)
    .map((e) => e.import)
    .filter((p) => typeof p === 'string' && p.endsWith('.svelte'));
  return dist.map((p) => ({ name: p, file: resolve(PKG_DIR, p.replace('./dist/', './src/')) }));
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

export function registerCompat({ describe, it, expect, svelte, compiler, expectedMajor }) {
  const label = `svelte ${expectedMajor}`;

  describe(`${label}: toolchain identity`, () => {
    it('the compiler AND the runtime are the expected major (not a hoisted root svelte)', () => {
      expect(Number(compiler.VERSION.split('.')[0])).toBe(expectedMajor);
      // Runtime fingerprint: only Svelte 5 exports mount().
      expect(typeof svelte.mount === 'function').toBe(expectedMajor === 5);
    });

    it('components compiled by this leg run on this leg runtime', () => {
      // A compiled component discloses the runtime that executed it. If the packages/ components resolved
      // `svelte` to the root node_modules (Svelte 5) while the leg compiles with Svelte 4, the runtime
      // majors would be mixed here.
      const target = document.body.appendChild(document.createElement('div'));
      const handle = mountComponent(svelte, ModelViewer, {
        target,
        props: { createRenderer: MODEL_STUB_GL, createControls: MODEL_STUB_CONTROLS }
      });
      const majors = [...(globalThis.window?.__svelte?.v ?? [])].map((v) => Number(String(v).split('.')[0]));
      expect(majors.length).toBeGreaterThan(0);
      expect(majors.every((m) => m === expectedMajor)).toBe(true);
      handle.destroy();
      target.remove();
    });
  });

  describe(`${label}: compile every shipped .svelte`, () => {
    const components = shippedComponents();

    it('finds the shipped components (guards against an empty glob)', () => {
      expect(components.map((c) => c.name).sort()).toEqual([
        './dist/GcodePreview.svelte',
        './dist/model/ModelViewer.svelte'
      ]);
      for (const c of components) expect(existsSync(c.file)).toBe(true);
    });

    for (const target of expectedMajor === 5 ? ['client', 'server'] : ['dom', 'ssr']) {
      it(`compiles for ${target} without errors (warnings are reported)`, () => {
        for (const c of components) {
          const result = compiler.compile(readFileSync(c.file, 'utf8'), { filename: c.file, generate: target });
          expect(result.js.code.length).toBeGreaterThan(0);
          for (const w of result.warnings) {
            console.warn(`[${label} ${target}] ${c.name}: ${w.code}: ${w.message}`);
          }
        }
      });
    }

    it('the compile step can fail (a syntax error throws)', () => {
      expect(() => compiler.compile('<script>let = ;</script><div>', { filename: 'broken.svelte' })).toThrow();
    });
  });

  describe(`${label}: mount GcodePreview`, () => {
    const mountPreview = (props = {}, events = {}) => {
      const target = document.body.appendChild(document.createElement('div'));
      const handle = mountComponent(svelte, GcodePreview, {
        target,
        props: {
          quality: 'lines',
          createWorker: () => new SuiteStubWorker(),
          rendererOptions: {
            createRenderer: (canvas) => makeSuiteStubGL(canvas),
            scheduleFrame: (cb) => cb(),
            chunksPerTick: 8
          },
          ...props
        },
        events
      });
      return { target, handle };
    };

    it('renders the focusable canvas', () => {
      const { target, handle } = mountPreview();
      const canvas = target.querySelector('canvas');
      expect(canvas?.getAttribute('aria-label')).toBe('3D G-code toolpath preview');
      expect(canvas?.getAttribute('tabindex')).toBe('0');
      handle.destroy();
      target.remove();
    });

    it('fires `ready` after parsing `source`, and again when the `source` prop changes', async () => {
      const ready = [];
      const { target, handle } = mountPreview(
        { source: new Uint8Array(1_000) },
        { ready: (e) => ready.push(e.detail) }
      );
      await settle();
      expect(ready.length).toBe(1);
      expect(typeof ready[0].segments).toBe('number');
      handle.setProps({ source: new Uint8Array(2_000) });
      await settle();
      expect(ready.length).toBe(2);
      handle.destroy();
      target.remove();
    });

    it('exposes the preview handle and its state reflects the parse', async () => {
      const { target, handle } = mountPreview({ source: new Uint8Array(1_000) });
      await settle();
      let state;
      handle.instance.preview.state.subscribe((s) => (state = s))();
      expect(state.summary?.segments).toBeGreaterThan(0);
      handle.destroy();
      target.remove();
    });

    it('unmount removes the canvas and disposes the preview (worker terminated)', async () => {
      const terminated0 = SuiteStubWorker.terminated;
      const { target, handle } = mountPreview({ source: new Uint8Array(1_000) });
      await settle();
      expect(target.querySelector('canvas')).not.toBeNull();
      handle.destroy();
      await settle();
      expect(target.querySelector('canvas')).toBeNull();
      expect(SuiteStubWorker.terminated - terminated0).toBe(1);
      target.remove();
    });
  });

  // The portable component conformance case (#502): event -> callback wiring through the compiled component.
  runComponentConformanceSuite(
    `svelte ${expectedMajor} <GcodePreview>`,
    { describe, it, expect },
    {
      mount(cb) {
        const target = document.body.appendChild(document.createElement('div'));
        const handle = mountComponent(svelte, GcodePreview, {
          target,
          props: {
            quality: 'lines',
            createWorker: () => new SuiteStubWorker(),
            rendererOptions: {
              createRenderer: (canvas) => makeSuiteStubGL(canvas),
              scheduleFrame: (f) => f(),
              chunksPerTick: 8
            }
          },
          events: {
            buildcomplete: (e) => cb.onBuildComplete(e.detail.segments),
            disclosure: (e) => cb.onDisclosure(e.detail)
          }
        });
        const preview = handle.instance.preview; // Svelte 4 clears the instance's exports on $destroy()
        return {
          emitBuild: (decimation, segments) => emitSuiteBuild(preview.raw.renderer(), decimation, segments),
          settle,
          unmount: () => {
            handle.destroy();
            target.remove();
          }
        };
      }
    }
  );

  describe(`${label}: mount ModelViewer`, () => {
    it('renders the canvas, fires `ready` for a source, and unmount disposes the renderer', async () => {
      const target = document.body.appendChild(document.createElement('div'));
      const ready = [];
      let rendererDisposed = 0;
      let renderersCreated = 0;
      const handle = mountComponent(svelte, ModelViewer, {
        target,
        props: {
          source: makeStlModelSource(),
          createRenderer: (canvas) => {
            renderersCreated++;
            const gl = MODEL_STUB_GL(canvas);
            return { ...gl, dispose: () => rendererDisposed++ };
          },
          createControls: MODEL_STUB_CONTROLS
        },
        events: { ready: (e) => ready.push(e.detail) }
      });
      expect(target.querySelector('canvas')?.getAttribute('aria-label')).toBe('3D source-model preview');
      await settle();
      expect(ready.length).toBe(1);
      handle.setProps({ source: makeStlModelSource() });
      await settle();
      expect(ready.length).toBe(2);
      const viewer = handle.instance.viewer; // Svelte 4 clears the instance's exports on $destroy()
      handle.destroy();
      await settle();
      expect(target.querySelector('canvas')).toBeNull();
      expect(rendererDisposed).toBeGreaterThan(0);
      // onDestroy -> viewer.dispose(): a disposed handle ignores any later canvas bind. (The canvas action's own
      // teardown already disposes the renderer, so the line above cannot tell dispose() ran.)
      const created = renderersCreated;
      viewer.canvas(document.createElement('canvas'));
      expect(renderersCreated).toBe(created);
      target.remove();
    });
  });
}
