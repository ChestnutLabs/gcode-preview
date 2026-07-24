// @vitest-environment happy-dom
/*
 * Component/composable contract from the INSTALLED tarballs (DD-007 §4.5): mount,
 * parse (stub protocol worker — the real worker is covered by real-worker.test.mjs),
 * prop→engine effects, dispose accounting over repeated cycles (leak check).
 */
import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, effectScope, h, nextTick, shallowRef } from 'vue';
import { GcodePreview, useGcodePreview } from '@chestnutlabs/gcode-preview-vue';
import { MoveKind, ToolpathIRBuilder } from '@chestnutlabs/toolpath-core';

function makeIR() {
  const b = new ToolpathIRBuilder({ parserVersion: 'fixture', units: 'mm', unitsSource: 'known' });
  for (let i = 0; i < 12; i++) {
    b.addSegment({
      x0: i,
      y0: 0,
      z0: 0.2,
      x1: i + 1,
      y1: 0,
      z1: 0.2,
      e: 1,
      kind: MoveKind.Extrude,
      layer: Math.floor(i / 6),
      srcByte: i * 10
    });
  }
  return b.finalize();
}

class StubWorker {
  static created = 0;
  static terminated = 0;
  onmessage = null;
  onerror = null;
  constructor() {
    StubWorker.created++;
  }
  postMessage(msg) {
    if (msg.type === 'parse') {
      queueMicrotask(() => {
        this.onmessage?.({
          data: { v: 1, type: 'done', id: msg.id, ir: makeIR(), stats: { bytes: 120, wallMs: 1 } }
        });
      });
    }
  }
  terminate() {
    StubWorker.terminated++;
  }
}

const stubGL = (canvas) => ({
  render: () => undefined,
  setSize: () => undefined,
  dispose: () => undefined,
  domElement: canvas
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('consumer fixture — packaged Vue surfaces', () => {
  it('composable parses and exposes engine state', async () => {
    const scope = effectScope();
    const preview = scope.run(() =>
      useGcodePreview({
        createWorker: () => new StubWorker(),
        renderer: { quality: 'lines', chunksPerTick: 8, createRenderer: stubGL, scheduleFrame: (cb) => cb() }
      })
    );
    preview.canvasRef.value = document.createElement('canvas');
    await nextTick();
    const outcome = await preview.parse(new Uint8Array(120));
    expect(outcome.ok).toBe(true);
    expect(preview.state.summary?.segments).toBe(12);
    scope.stop();
  });

  it('component mounts, parses via :source, and 10 mount cycles leak nothing', async () => {
    const created0 = StubWorker.created;
    const terminated0 = StubWorker.terminated;
    for (let cycle = 0; cycle < 10; cycle++) {
      const source = shallowRef(null);
      let ready = null;
      const Parent = defineComponent({
        setup: () => () =>
          h(GcodePreview, {
            source: source.value,
            quality: 'lines',
            createWorker: () => new StubWorker(),
            rendererOptions: { createRenderer: stubGL, scheduleFrame: (cb) => cb(), chunksPerTick: 8 },
            onReady: (s) => {
              ready = s;
            }
          })
      });
      const host = document.createElement('div');
      const app = createApp(Parent);
      app.mount(host);
      source.value = new Uint8Array(120);
      await settle();
      expect(ready).toMatchObject({ segments: 12, layers: 2 });
      app.unmount();
    }
    expect(StubWorker.created - created0).toBe(10);
    expect(StubWorker.terminated - terminated0).toBe(10);
  });
});
