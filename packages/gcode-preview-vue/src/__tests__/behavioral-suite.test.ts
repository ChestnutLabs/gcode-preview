// @vitest-environment happy-dom
/**
 * The framework-portable behavioral suite through the VUE adapter (DD-007 §4.6):
 * the same parity contract React and Svelte will run — proving the composable is a
 * faithful bridge over the shared controller.
 */
import { describe, expect, it } from 'vitest';
import { effectScope, nextTick } from 'vue';
import {
  SuiteStubWorker,
  makeSuiteStubGL,
  runBehavioralSuite,
  type AdapterInstance
} from '@chestnutlabs/gcode-preview-core/testing';
import { useGcodePreview } from '../index';

const settle = async (): Promise<void> => {
  await nextTick();
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

runBehavioralSuite(
  'vue useGcodePreview',
  { describe, it, expect },
  {
    async create(opts = {}) {
      const canvas = document.createElement('canvas');
      const scope = effectScope();
      const preview = scope.run(() =>
        useGcodePreview({
          createWorker: () => new SuiteStubWorker(opts.machine),
          renderer: {
            buildVolume: opts.consumerVolume === true ? { x: 220, y: 220, z: 250 } : undefined,
            quality: 'lines',
            chunksPerTick: 8,
            createRenderer: () => makeSuiteStubGL(canvas),
            scheduleFrame: (cb) => cb()
          }
        })
      )!;
      preview.canvasRef.value = canvas;
      await nextTick();
      const instance: AdapterInstance = {
        parse: (bytes) => preview.parse(bytes),
        getState: () => preview.state,
        controls: preview.controls,
        observeProgress: (obs) => preview.observeProgress(obs),
        clearProgress: () => preview.clearProgress(),
        onEvent: (cb) => preview.onEvent(cb),
        firstChunkDrawCount: () => preview.raw.renderer()!.chunkMeshes[0].geometry.drawRange.count,
        dispose: () => {
          scope.stop();
        },
        settle
      };
      return instance;
    }
  }
);
