// @vitest-environment happy-dom
/**
 * `<gcode-preview>`: assigning the same `source` again is no change and does not re-parse (as in the React, Vue
 * and Svelte adapters). A new array, or `parse()`, does. Parses are counted on the `ready` event.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { GcodePreviewElement, defineGcodePreview } from '../index';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

afterEach(() => {
  document.body.innerHTML = '';
});

function make(): { el: GcodePreviewElement; ready: () => number } {
  defineGcodePreview();
  const canvas = document.createElement('canvas');
  const el = document.createElement('gcode-preview') as GcodePreviewElement;
  el.createWorker = () => new SuiteStubWorker();
  el.quality = 'lines';
  el.rendererOptions = { createRenderer: () => makeSuiteStubGL(canvas), scheduleFrame: (f) => f(), chunksPerTick: 8 };
  let n = 0;
  el.addEventListener('ready', () => n++);
  return { el, ready: () => n };
}

describe('<gcode-preview> source identity', () => {
  it('the same array again does not re-parse; a new array does', async () => {
    const { el, ready } = make();
    document.body.appendChild(el);
    await settle();
    const bytes = new Uint8Array(1_000);
    el.source = bytes;
    await settle();
    expect(ready()).toBe(1);
    el.source = bytes;
    await settle();
    expect(ready()).toBe(1);
    expect(el.source).toBe(bytes);
    el.source = new Uint8Array(1_000);
    await settle();
    expect(ready()).toBe(2);
  });

  it('a source set before connect parses once at connect, and setting it again after does not', async () => {
    const { el, ready } = make();
    const bytes = new Uint8Array(1_000);
    el.source = bytes;
    document.body.appendChild(el);
    await settle();
    expect(ready()).toBe(1);
    el.source = bytes;
    await settle();
    expect(ready()).toBe(1);
  });

  it('parse() still reloads the same bytes on request', async () => {
    const { el, ready } = make();
    document.body.appendChild(el);
    const bytes = new Uint8Array(1_000);
    el.source = bytes;
    await settle();
    await el.parse(bytes.slice());
    await settle();
    expect(ready()).toBe(2);
  });

  it('null after a source is a change: setting the source back parses again', async () => {
    const { el, ready } = make();
    document.body.appendChild(el);
    const bytes = new Uint8Array(1_000);
    el.source = bytes;
    await settle();
    el.source = null;
    el.source = bytes;
    await settle();
    expect(ready()).toBe(2);
  });
});
