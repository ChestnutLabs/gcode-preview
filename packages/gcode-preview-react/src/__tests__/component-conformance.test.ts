// @vitest-environment happy-dom
/** The portable component conformance case (#502) through React's `<GcodePreview>` (callback props). */
import { describe, expect, it } from 'vitest';
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  SuiteStubWorker,
  emitSuiteBuild,
  makeSuiteStubGL,
  runComponentConformanceSuite
} from '@chestnutlabs/gcode-preview-core/testing';
import { GcodePreview, type GcodePreviewHandle } from '../index';

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
      await act(async () => {
        root = createRoot(host);
        root.render(
          createElement(GcodePreview, {
            ref,
            source: null,
            renderer: opts.renderer,
            quality: 'lines',
            createWorker: () => new SuiteStubWorker(undefined, opts.ir),
            rendererOptions: {
              createRenderer: () => makeSuiteStubGL(canvas),
              scheduleFrame: (f: () => void) => f(),
              chunksPerTick: 8
            },
            onBuildComplete: (e) => cb.onBuildComplete(e.segments),
            onDisclosure: (text) => cb.onDisclosure(text)
          })
        );
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
        settle,
        unmount: async () => {
          await act(async () => root?.unmount());
          host.remove();
        }
      };
    }
  }
);
