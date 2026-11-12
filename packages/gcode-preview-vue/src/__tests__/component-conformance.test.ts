// @vitest-environment happy-dom
/** The portable component conformance case (#502) through Vue's `<GcodePreview>` (emits). */
import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import {
  SuiteStubWorker,
  emitSuiteBuild,
  makeSuiteStubGL,
  runComponentConformanceSuite
} from '@chestnutlabs/gcode-preview-core/testing';
import { GcodePreview } from '../index';

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
        preview: { raw: { renderer(): unknown }; parse(bytes: Uint8Array): Promise<unknown> };
      } | null>(null);
      const container = document.body.appendChild(document.createElement('div'));
      const app = createApp(
        defineComponent({
          setup: () => () =>
            h(GcodePreview, {
              ref: comp,
              renderer: opts.renderer,
              quality: 'lines',
              createWorker: () => new SuiteStubWorker(undefined, opts.ir),
              rendererOptions: {
                createRenderer: () => makeSuiteStubGL(canvas),
                scheduleFrame: (f: () => void) => f(),
                chunksPerTick: 8
              },
              onReady: (e: { segments: number }) => cb.onReady(e.segments),
              onBuildComplete: (e: { segments: number }) => cb.onBuildComplete(e.segments),
              onDisclosure: (text: string) => cb.onDisclosure(text)
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
        settle,
        unmount: () => {
          app.unmount();
          container.remove();
        }
      };
    }
  }
);
