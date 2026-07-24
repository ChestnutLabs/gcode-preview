// @vitest-environment happy-dom
/**
 * The framework-portable behavioral suite through the CUSTOM-ELEMENT adapter (DD-007 §4.6,
 * DD-009 §15 gate): the same parity contract Vue/React/Svelte pass — proving the element is a
 * faithful shell over the shared controller. connectedCallback binds synchronously, so (like
 * Svelte) the harness is a plain sync create() with a microtask settle, no framework act().
 */
import { describe, expect, it } from 'vitest';
import {
  SuiteStubWorker,
  makeSuiteStubGL,
  runBehavioralSuite,
  type AdapterInstance
} from '@chestnutlabs/gcode-preview-core/testing';
import { GcodePreviewElement, defineGcodePreview } from '../index';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

runBehavioralSuite(
  'gcode-preview custom element',
  { describe, it, expect },
  {
    create(opts = {}) {
      defineGcodePreview();
      const canvas = document.createElement('canvas');
      const el = document.createElement('gcode-preview') as GcodePreviewElement;
      // Injectables the suite needs are JS properties (they can't be HTML attributes).
      el.createWorker = () => new SuiteStubWorker(opts.machine);
      el.quality = 'lines';
      el.rendererOptions = {
        createRenderer: () => makeSuiteStubGL(canvas),
        scheduleFrame: (cb) => cb(),
        chunksPerTick: 8
      };
      if (opts.consumerVolume === true) el.buildVolume = { x: 220, y: 220, z: 250 };
      document.body.appendChild(el); // connectedCallback creates the controller + binds synchronously

      const instance: AdapterInstance = {
        parse: (bytes) => el.parse(bytes),
        getState: () => el.state,
        controls: el.controls,
        observeProgress: (obs) => el.observeProgress(obs),
        clearProgress: () => el.clearProgress(),
        onEvent: (cb) => el.onEvent(cb),
        firstChunkDrawCount: () => el.raw.renderer()!.chunkMeshes[0].geometry.drawRange.count,
        dispose: () => el.remove(), // disconnectedCallback disposes the controller + terminates the worker
        settle
      };
      return instance;
    }
  }
);
