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
    async mount(cb, opts = {}) {
      defineGcodePreview();
      const canvas = document.createElement('canvas');
      const el = document.createElement('gcode-preview') as GcodePreviewElement;
      el.createWorker = () => new SuiteStubWorker(undefined, opts.ir);
      if (opts.renderer !== undefined) el.renderer = opts.renderer;
      el.quality = 'lines';
      if (opts.cameraFov !== undefined) el.cameraFov = opts.cameraFov;
      if (opts.pixelRatio !== undefined) el.pixelRatio = opts.pixelRatio;
      if (opts.scrub !== undefined) el.scrub = opts.scrub;
      if (opts.scrubTime !== undefined) el.scrubTime = opts.scrubTime;
      if (opts.layerRange !== undefined) el.layerRange = opts.layerRange;
      el.rendererOptions = {
        createRenderer: opts.createGL ?? (() => makeSuiteStubGL(canvas)),
        scheduleFrame: (f) => f(),
        chunksPerTick: 8
      };
      el.addEventListener('ready', (e) => cb.onReady((e as CustomEvent<{ segments: number }>).detail.segments));
      el.addEventListener('build-complete', (e) =>
        cb.onBuildComplete((e as CustomEvent<{ segments: number }>).detail.segments)
      );
      el.addEventListener('disclosure', (e) => cb.onDisclosure((e as CustomEvent<{ text: string }>).detail.text));
      el.addEventListener('renderer-unsupported', (e) => {
        const d = (e as CustomEvent<{ feature: string; message: string }>).detail;
        cb.onRendererUnsupported?.(d.feature, d.message);
      });
      el.addEventListener('error', (e) => cb.onError?.((e as CustomEvent).detail));
      el.addEventListener('parse-error', (e) => cb.onParseError?.((e as CustomEvent).detail));
      document.body.appendChild(el);
      await settle();
      return {
        emitBuild: (decimation, segments) => emitSuiteBuild(el.raw.renderer(), decimation, segments),
        parse: (bytes) => el.parse(bytes),
        setCameraMode: (mode) => el.controls.setCameraMode(mode),
        setSource: (bytes) => {
          el.source = bytes;
        },
        setParseOptions: (o) => {
          el.parseOptions = o;
        },
        firstChunkDrawCount: () => el.raw.renderer()!.chunkMeshes[0].geometry.drawRange.count,
        controls: () => el.controls,
        settle,
        unmount: () => el.remove()
      };
    }
  }
);
