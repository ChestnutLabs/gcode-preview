// @vitest-environment happy-dom
/** The portable component conformance case (#502) through `<gcode-preview>` (DOM CustomEvents). */
import { describe, expect, it } from 'vitest';
import {
  SuiteStubWorker,
  emitSuiteBuild,
  makeSuiteStubGL,
  runComponentConformanceSuite
} from '@chestnutlabs/gcode-preview-core/testing';
import { type GcodePreviewElement, defineGcodePreview } from '../index';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

runComponentConformanceSuite(
  'element <gcode-preview>',
  { describe, it, expect },
  {
    async mount(cb) {
      defineGcodePreview();
      const canvas = document.createElement('canvas');
      const el = document.createElement('gcode-preview') as GcodePreviewElement;
      el.createWorker = () => new SuiteStubWorker();
      el.quality = 'lines';
      el.rendererOptions = {
        createRenderer: () => makeSuiteStubGL(canvas),
        scheduleFrame: (f) => f(),
        chunksPerTick: 8
      };
      el.addEventListener('build-complete', (e) =>
        cb.onBuildComplete((e as CustomEvent<{ segments: number }>).detail.segments)
      );
      el.addEventListener('disclosure', (e) => cb.onDisclosure((e as CustomEvent<{ text: string }>).detail.text));
      document.body.appendChild(el);
      await settle();
      return {
        emitBuild: (decimation, segments) => emitSuiteBuild(el.raw.renderer(), decimation, segments),
        settle,
        unmount: () => el.remove()
      };
    }
  }
);
