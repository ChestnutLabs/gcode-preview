// @vitest-environment happy-dom
/** The portable component conformance case (#502) through Vue's `<GcodePreview>` (emits). */
import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import {
  SuiteStubWorker,
  emitSuiteBuild,
  makeSuiteStubGL,
  runComponentConformanceSuite,
  type MountedComponent
} from '@chestnutlabs/gcode-preview-core/testing';
import type { GcodePreviewControls } from '@chestnutlabs/gcode-preview-core';
import { GcodePreview } from '../index';

type ParseOptions = Parameters<NonNullable<MountedComponent['setParseOptions']>>[0];

type Drawn = { chunkMeshes: { geometry: { drawRange: { count: number } } }[] };

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  await nextTick();
};

runComponentConformanceSuite(
  'vue <GcodePreview>',
  { describe, it, expect },
  {
    mount(cb, opts = {}) {
      const canvas = document.createElement('canvas');
      const comp = ref<{
        preview: {
          raw: { renderer(): unknown };
          controls: GcodePreviewControls;
          parse(bytes: Uint8Array): Promise<unknown>;
        };
      } | null>(null);
      const source = ref<Uint8Array | null>(null);
      const parseOptions = ref<ParseOptions>(undefined);
      const container = document.body.appendChild(document.createElement('div'));
      const app = createApp(
        defineComponent({
          setup: () => () =>
            h(GcodePreview, {
              ref: comp,
              source: source.value,
              parseOptions: parseOptions.value,
              renderer: opts.renderer,
              quality: 'lines',
              cameraFov: opts.cameraFov,
              pixelRatio: opts.pixelRatio,
              scrub: opts.scrub,
              scrubTime: opts.scrubTime,
              layerRange: opts.layerRange,
              createWorker: () => new SuiteStubWorker(undefined, opts.ir),
              rendererOptions: {
                createRenderer: opts.createGL ?? (() => makeSuiteStubGL(canvas)),
                scheduleFrame: (f: () => void) => f(),
                chunksPerTick: 8
              },
              onReady: (e: { segments: number }) => cb.onReady(e.segments),
              onBuildComplete: (e: { segments: number }) => cb.onBuildComplete(e.segments),
              onDisclosure: (text: string) => cb.onDisclosure(text),
              onRendererUnsupported: (e: { feature: string; message: string }) =>
                cb.onRendererUnsupported?.(e.feature, e.message),
              onError: (e: unknown) => cb.onError?.(e),
              onParseError: (e: unknown) => cb.onParseError?.(e)
            })
        })
      );
      app.mount(container);
      return {
        emitBuild: (decimation, segments) =>
          emitSuiteBuild(comp.value?.preview.raw.renderer() ?? null, decimation, segments),
        parse: async (bytes) => {
          const out = await comp.value?.preview.parse(bytes);
          await nextTick();
          return out;
        },
        setCameraMode: async (mode) => {
          comp.value?.preview.controls.setCameraMode(mode);
          await nextTick();
        },
        setSource: async (bytes) => {
          source.value = bytes;
          await nextTick();
        },
        setParseOptions: async (o) => {
          parseOptions.value = o;
          await nextTick();
        },
        firstChunkDrawCount: () =>
          (comp.value!.preview.raw.renderer() as Drawn).chunkMeshes[0].geometry.drawRange.count,
        controls: () => comp.value!.preview.controls,
        settle,
        unmount: () => {
          app.unmount();
          container.remove();
        }
      };
    }
  }
);
