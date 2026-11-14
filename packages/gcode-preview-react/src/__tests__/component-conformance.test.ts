// @vitest-environment happy-dom
/** The portable component conformance case (#502) through React's `<GcodePreview>` (callback props). */
import { describe, expect, it } from 'vitest';
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  SuiteStubWorker,
  emitSuiteBuild,
  makeSuiteStubGL,
  runComponentConformanceSuite,
  type MountedComponent
} from '@chestnutlabs/gcode-preview-core/testing';
import { GcodePreview, type GcodePreviewHandle } from '../index';

type ParseOptions = Parameters<NonNullable<MountedComponent['setParseOptions']>>[0];

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

runComponentConformanceSuite(
  'react <GcodePreview>',
  { describe, it, expect },
  {
    async mount(cb, opts = {}) {
      const canvas = document.createElement('canvas');
      const ref = createRef<GcodePreviewHandle>();
      const host = document.body.appendChild(document.createElement('div'));
      let root: Root | null = null;
      let source: Uint8Array | null = null;
      let parseOptions: ParseOptions;
      const el = () =>
        createElement(GcodePreview, {
          ref,
          source,
          parseOptions,
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
          onReady: (e) => cb.onReady(e.segments),
          onBuildComplete: (e) => cb.onBuildComplete(e.segments),
          onDisclosure: (text) => cb.onDisclosure(text),
          onRendererUnsupported: (e) => cb.onRendererUnsupported?.(e.feature, e.message),
          onError: (e) => cb.onError?.(e),
          onParseError: (e) => cb.onParseError?.(e)
        });
      await act(async () => {
        root = createRoot(host);
        root.render(el());
      });
      return {
        emitBuild: async (decimation, segments) => {
          // Inside act, so React may re-render (and its render snapshot lag) around the callback.
          await act(async () => emitSuiteBuild(ref.current?.raw.renderer() ?? null, decimation, segments));
        },
        parse: async (bytes) => {
          let out: unknown;
          await act(async () => {
            out = await ref.current?.parse(bytes);
          });
          return out;
        },
        setCameraMode: async (mode) => {
          await act(async () => ref.current?.controls.setCameraMode(mode));
        },
        setSource: async (bytes) => {
          source = bytes;
          await act(async () => root?.render(el()));
        },
        setParseOptions: async (o) => {
          parseOptions = o;
          await act(async () => root?.render(el()));
        },
        firstChunkDrawCount: () => ref.current!.raw.renderer()!.chunkMeshes[0].geometry.drawRange.count,
        controls: () => ref.current!.controls,
        settle,
        unmount: async () => {
          await act(async () => root?.unmount());
          host.remove();
        }
      };
    }
  }
);
