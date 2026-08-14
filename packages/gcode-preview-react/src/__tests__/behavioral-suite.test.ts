// @vitest-environment happy-dom
/**
 * The framework-portable behavioral suite through the REACT adapter (DD-007 §4.6):
 * the same parity contract Vue passes — proving the hook is a faithful bridge over
 * the shared controller. Rendered with react-dom under act(), no testing library.
 */
import { describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  SuiteStubWorker,
  makeSuiteStubGL,
  runBehavioralSuite,
  type AdapterInstance
} from '@chestnutlabs/gcode-preview-core/testing';
import { useGcodePreview, type GcodePreviewHandle, type UseGcodePreviewOptions } from '../index';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function Probe(props: { options: UseGcodePreviewOptions; grab: (h: GcodePreviewHandle) => void }) {
  const preview = useGcodePreview(props.options);
  props.grab(preview); // re-grabbed every render — the harness always reads the latest handle
  return createElement('canvas', { ref: preview.canvasRef });
}

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

runBehavioralSuite(
  'react useGcodePreview',
  { describe, it, expect },
  {
    async create(opts = {}) {
      const canvas = document.createElement('canvas');
      let handle: GcodePreviewHandle | null = null;
      const latest = (): GcodePreviewHandle => handle as GcodePreviewHandle;
      const options: UseGcodePreviewOptions = {
        createWorker: () => new SuiteStubWorker(opts.machine),
        renderer: {
          buildVolume: opts.consumerVolume === true ? { x: 220, y: 220, z: 250 } : undefined,
          quality: 'lines',
          chunksPerTick: 8,
          createRenderer: () => makeSuiteStubGL(canvas),
          scheduleFrame: (cb) => cb()
        }
      };
      const host = document.createElement('div');
      document.body.appendChild(host);
      let root: Root | null = null;
      await act(async () => {
        root = createRoot(host);
        root.render(
          createElement(Probe, {
            options,
            grab: (h) => {
              handle = h;
            }
          })
        );
      });
      const instance: AdapterInstance = {
        parse: async (bytes) => {
          let out: unknown;
          await act(async () => {
            out = await latest().parse(bytes);
          });
          return out;
        },
        getState: () => latest().state,
        // Controls delegate through the latest handle (the controller beneath is stable).
        controls: {
          setLayerRange: (a, b) => latest().controls.setLayerRange(a, b),
          setScrubPosition: (s) => latest().controls.setScrubPosition(s),
          setKindVisible: (k, v) => latest().controls.setKindVisible(k, v),
          setColorMode: (m) => latest().controls.setColorMode(m),
          setQuality: (q) => latest().controls.setQuality(q),
          setBuildVolume: (d) => latest().controls.setBuildVolume(d),
          setView: (v) => latest().controls.setView(v),
          getCameraState: () => latest().controls.getCameraState(),
          setCameraState: (s) => latest().controls.setCameraState(s),
          frame: () => latest().controls.frame()
        },
        observeProgress: (obs) => latest().observeProgress(obs),
        clearProgress: () => latest().clearProgress(),
        onEvent: (cb) => latest().onEvent(cb),
        firstChunkDrawCount: () => latest().raw.renderer()!.chunkMeshes[0].geometry.drawRange.count,
        dispose: async () => {
          await act(async () => {
            root?.unmount();
          });
          host.remove();
        },
        settle
      };
      return instance;
    }
  }
);
