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
    mount(cb) {
      const canvas = document.createElement('canvas');
      const comp = ref<{ preview: { raw: { renderer(): unknown } } } | null>(null);
      const container = document.body.appendChild(document.createElement('div'));
      const app = createApp(
        defineComponent({
          setup: () => () =>
            h(GcodePreview, {
              ref: comp,
              quality: 'lines',
              createWorker: () => new SuiteStubWorker(),
              rendererOptions: {
                createRenderer: () => makeSuiteStubGL(canvas),
                scheduleFrame: (f: () => void) => f(),
                chunksPerTick: 8
              },
              onBuildComplete: (e: { segments: number }) => cb.onBuildComplete(e.segments),
              onDisclosure: (text: string) => cb.onDisclosure(text)
            })
        })
      );
      app.mount(container);
      return {
        emitBuild: (decimation, segments) =>
          emitSuiteBuild(comp.value?.preview.raw.renderer() ?? null, decimation, segments),
        settle,
        unmount: () => {
          app.unmount();
          container.remove();
        }
      };
    }
  }
);
