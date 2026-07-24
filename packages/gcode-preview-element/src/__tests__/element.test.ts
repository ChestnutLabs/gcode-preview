// @vitest-environment happy-dom
/**
 * Element-specific DOM behavior for <gcode-preview> (#149): registration, source-property
 * parse → CustomEvent, attribute reflection into controls, pre-connect property buffering,
 * and leak-free reconnect. The cross-adapter parity contract is covered by behavioral-suite.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { GcodePreviewElement, defineGcodePreview } from '../index';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

function makeEl(canvas: HTMLCanvasElement): GcodePreviewElement {
  const el = document.createElement('gcode-preview') as GcodePreviewElement;
  el.createWorker = () => new SuiteStubWorker();
  el.quality = 'lines';
  el.rendererOptions = {
    createRenderer: () => makeSuiteStubGL(canvas),
    scheduleFrame: (cb) => cb(),
    chunksPerTick: 8
  };
  return el;
}

describe('gcode-preview custom element (#149)', () => {
  it('registers the tag idempotently', () => {
    defineGcodePreview();
    defineGcodePreview(); // a second call must not throw
    expect(customElements.get('gcode-preview')).toBe(GcodePreviewElement);
  });

  it('parses a source property and dispatches a "ready" CustomEvent', async () => {
    defineGcodePreview();
    const el = makeEl(document.createElement('canvas'));
    document.body.appendChild(el);
    let readyDetail: unknown = null;
    el.addEventListener('ready', (e) => {
      readyDetail = (e as CustomEvent).detail;
    });
    el.source = new Uint8Array(1000);
    await settle();
    expect(readyDetail).toMatchObject({ segments: 12, layers: 2, complete: true });
    el.remove();
  });

  it('reflects boolean/number attributes into controls', async () => {
    defineGcodePreview();
    const el = makeEl(document.createElement('canvas'));
    document.body.appendChild(el);
    await el.parse(new Uint8Array(1000));
    await settle();
    const drawCount = (): number => el.raw.renderer()!.chunkMeshes[0].geometry.drawRange.count;
    expect(drawCount()).toBe(24);
    el.setAttribute('scrub', '5');
    expect(drawCount()).toBe(12);
    el.removeAttribute('scrub');
    expect(drawCount()).toBe(24);
    el.remove();
  });

  it('applies a property set BEFORE connect, and leaks no workers across reconnect', async () => {
    defineGcodePreview();
    const created0 = SuiteStubWorker.created;
    const terminated0 = SuiteStubWorker.terminated;
    const el = makeEl(document.createElement('canvas'));
    el.source = new Uint8Array(1000); // set before the element is connected
    document.body.appendChild(el);
    await settle();
    expect(el.state.summary).toMatchObject({ segments: 12 });

    el.remove();
    document.body.appendChild(el); // reconnect: a fresh controller re-parses the buffered source
    await settle();
    expect(el.state.summary).toMatchObject({ segments: 12 });
    el.remove();

    expect(SuiteStubWorker.created - created0).toBe(2);
    expect(SuiteStubWorker.terminated - terminated0).toBe(2);
  });
});
