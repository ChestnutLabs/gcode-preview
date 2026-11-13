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
import PreviewHost from './PreviewHost.svelte';
import { ToolpathRenderer } from '@chestnutlabs/gcode-renderer-three';

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

    it('a new parseOptions object with an unchanged source does not re-parse; a changed source does (#435)', async () => {
      const ready = [];
      const parseCalls = [];
      const source = new Uint8Array(1_000);
      const { target, handle } = mountPreview({ source }, { ready: (e) => ready.push(e.detail) });
      await settle();
      expect(ready.length).toBe(1);
      const preview = handle.instance.preview;
      const parse = preview.parse;
      // Count parse calls on the live handle's controller path: the component calls `preview.parse`.
      preview.parse = (...args) => {
        parseCalls.push(args[1]);
        return parse(...args);
      };
      handle.setProps({ parseOptions: { maxSegments: 5 } });
      await settle();
      handle.setProps({ parseOptions: { maxSegments: 5 } });
      await settle();
      expect(parseCalls.length).toBe(0);
      expect(ready.length).toBe(1);
      // A changed source re-parses, with the CURRENT parseOptions (not a stale one).
      handle.setProps({ source: new Uint8Array(2_000) });
      await settle();
      expect(parseCalls.length).toBe(1);
      expect(JSON.stringify(parseCalls[0])).toBe('{"maxSegments":5}');
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

  // #520: the mount pass for the four 3D-only construction props. 2D applies a non-default value once (and
  // the 2D renderer reports it); 3D was built with them and must not re-apply (a re-applied quality rebuilds).
  describe(`${label}: 3D-only props at mount (#520)`, () => {
    const QUALITY = 'quality Quality/geometry modes apply only to the 3D renderer; the 2D view has none.';
    const CAMERA = 'camera Camera projection applies only to the 3D renderer; the 2D view is flat top-down.';
    const mountP = (props) => {
      const log = [];
      const target = document.body.appendChild(document.createElement('div'));
      const base = {
        createWorker: () => new SuiteStubWorker(),
        rendererOptions: { createRenderer: (canvas) => makeSuiteStubGL(canvas), scheduleFrame: (f) => f() }
      };
      const handle = mountComponent(svelte, PreviewHost, {
        target,
        props: {
          props: { ...base, ...props },
          handlers: { rendererunsupported: (e) => log.push(`${e.detail.feature} ${e.detail.message}`) }
        }
      });
      return {
        log,
        set: (patch) => handle.setProps({ props: { ...base, ...props, ...patch } }),
        unmount: () => {
          handle.destroy();
          target.remove();
        }
      };
    };

    it('2D: explicit defaults report nothing', async () => {
      const m = mountP({ renderer: '2d', quality: 'auto', cameraMode: 'perspective', cameraFov: 50 });
      await settle();
      expect(JSON.stringify(m.log)).toBe('[]');
      m.unmount();
    });

    it('2D: a non-default quality and camera mode report once at mount, then once per change', async () => {
      const m = mountP({ renderer: '2d', quality: 'tubes', cameraMode: 'orthographic' });
      await settle();
      expect(JSON.stringify(m.log)).toBe(JSON.stringify([QUALITY, CAMERA]));
      // Back to the defaults is a change too: each is applied (and reported) once more.
      m.set({ quality: 'auto', cameraMode: 'perspective' });
      await settle();
      expect(JSON.stringify(m.log)).toBe(JSON.stringify([QUALITY, CAMERA, QUALITY, CAMERA]));
      m.unmount();
    });

    it('3D: the mount pass re-applies none of the construction props (no extra build)', async () => {
      const calls = [];
      const keys = ['setQuality', 'setCameraMode', 'setCameraFov', 'setPixelRatio'];
      const saved = keys.map((k) => ToolpathRenderer.prototype[k]);
      for (const k of keys) {
        ToolpathRenderer.prototype[k] = () => {
          calls.push(k);
        };
      }
      try {
        const m = mountP({ quality: 'lines', cameraMode: 'orthographic', cameraFov: 32, pixelRatio: 2 });
        await settle();
        expect(JSON.stringify(calls)).toBe('[]');
        m.unmount();
      } finally {
        keys.forEach((k, i) => {
          ToolpathRenderer.prototype[k] = saved[i];
        });
      }
    });
  });

  // The portable component conformance case (#502): event -> callback wiring through the compiled component.
  // Mounted through a parent template (PreviewHost) so `on:` listeners attach before the child mounts, as in
  // an app; mount-time events (#520) are otherwise dispatched inside Svelte 4's constructor, before `$on`.
  runComponentConformanceSuite(
    `svelte ${expectedMajor} <GcodePreview>`,
    { describe, it, expect },
    {
      mount(cb, opts = {}) {
        const target = document.body.appendChild(document.createElement('div'));
        const base = {
          renderer: opts.renderer,
          quality: 'lines',
          cameraFov: opts.cameraFov,
          pixelRatio: opts.pixelRatio,
          scrub: opts.scrub,
          scrubTime: opts.scrubTime,
          layerRange: opts.layerRange,
          createWorker: () => new SuiteStubWorker(undefined, opts.ir),
          rendererOptions: {
            createRenderer: (canvas) => makeSuiteStubGL(canvas),
            scheduleFrame: (f) => f(),
            chunksPerTick: 8
          }
        };
        const handle = mountComponent(svelte, PreviewHost, {
          target,
          props: {
            props: base,
            handlers: {
              ready: (e) => cb.onReady(e.detail.segments),
              buildcomplete: (e) => cb.onBuildComplete(e.detail.segments),
              disclosure: (e) => cb.onDisclosure(e.detail),
              rendererunsupported: (e) => cb.onRendererUnsupported?.(e.detail.feature, e.detail.message)
            }
          }
        });
        svelte.flushSync?.(); // Svelte 5 assigns the host's bind:this in an effect (Svelte 4: done already)
        const preview = handle.instance.getPreview(); // Svelte 4 clears the instance's exports on $destroy()
        return {
          emitBuild: (decimation, segments) => emitSuiteBuild(preview.raw.renderer(), decimation, segments),
          parse: (bytes) => preview.parse(bytes),
          setCameraMode: (mode) => preview.controls.setCameraMode(mode),
          setSource: (bytes) => handle.setProps({ props: { ...base, source: bytes } }),
          firstChunkDrawCount: () => preview.raw.renderer().chunkMeshes[0].geometry.drawRange.count,
          controls: () => preview.controls,
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
