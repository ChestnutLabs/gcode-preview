// @vitest-environment happy-dom
/**
 * `<gcode-preview>` `scrub` / `scrub-time` (#542 review): the core controller throws `RangeError` on `NaN`,
 * so a non-numeric attribute or property value must be ignored by the element (the previous cut stays)
 * rather than thrown from connectedCallback / attributeChangedCallback, which would stop the source from
 * ever parsing. A number (including `Infinity`) still applies; removing the attribute still clears.
 */
import { describe, expect, it } from 'vitest';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { GcodePreviewElement, defineGcodePreview } from '../index';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

/** 12 one-mm extrusion segments at 60000 mm/min (1 ms each): segment i ends at (i + 1) ms. */
function timedIR(): ToolpathIR {
  const b = new ToolpathIRBuilder({
    parserVersion: 'scrub',
    units: 'mm',
    unitsSource: 'known',
    source: { byteLength: 1_000 }
  });
  for (let i = 0; i < 12; i++) {
    b.addSegment({
      x0: 100 + i,
      y0: 100,
      z0: 0.2,
      x1: 101 + i,
      y1: 100,
      z1: 0.2,
      e: 1,
      feedrate: 60_000,
      kind: MoveKind.Extrude,
      layer: 0,
      srcByte: i * 10
    });
  }
  return b.finalize();
}

function makeEl(): GcodePreviewElement {
  defineGcodePreview();
  const canvas = document.createElement('canvas');
  const el = document.createElement('gcode-preview') as GcodePreviewElement;
  el.createWorker = () => new SuiteStubWorker(undefined, () => timedIR());
  el.quality = 'lines';
  el.rendererOptions = { createRenderer: () => makeSuiteStubGL(canvas), scheduleFrame: (cb) => cb(), chunksPerTick: 8 };
  return el;
}

const drawCount = (el: GcodePreviewElement): number => el.raw.renderer()!.chunkMeshes[0].geometry.drawRange.count;

async function parsed(): Promise<GcodePreviewElement> {
  const el = makeEl();
  document.body.appendChild(el);
  await el.parse(new Uint8Array(1000));
  await settle();
  expect(drawCount(el)).toBe(24); // 12 segments, nothing cut
  return el;
}

describe('<gcode-preview> non-numeric scrub / scrub-time', () => {
  it.each([
    ['scrub', 'abc'],
    ['scrub', 'NaN'],
    ['scrub-time', 'abc'],
    ['scrub-time', 'NaN']
  ])('%s=%j at connect: connects without throwing and the source parses', async (attr, bad) => {
    const el = makeEl();
    el.setAttribute(attr, bad);
    el.source = new Uint8Array(1000);
    let ready: unknown = null;
    el.addEventListener('ready', (e) => {
      ready = (e as CustomEvent).detail;
    });
    expect(() => document.body.appendChild(el)).not.toThrow();
    await settle();
    expect(ready).toMatchObject({ segments: 12, complete: true });
    expect(el.state.summary?.segments).toBe(12);
    expect(el.state.error).toBeNull();
    el.remove();
  });

  it('scrub: a valid value applies; a non-numeric one is ignored and the previous cut stays', async () => {
    const el = await parsed();
    el.setAttribute('scrub', '5');
    expect(drawCount(el)).toBe(12);
    for (const bad of ['abc', 'NaN', '5px']) {
      expect(() => el.setAttribute('scrub', bad)).not.toThrow();
      expect(drawCount(el)).toBe(12);
      expect(el.scrub).toBe(5);
    }
    el.setAttribute('scrub', '2');
    expect(drawCount(el)).toBe(6);
    el.setAttribute('scrub', 'Infinity'); // an open end, as the controller accepts
    expect(drawCount(el)).toBe(24);
    expect(el.scrub).toBe(Number.POSITIVE_INFINITY);
    el.removeAttribute('scrub'); // removed still clears
    expect(el.scrub).toBeNull();
    expect(drawCount(el)).toBe(24);
    el.remove();
  });

  it('scrub property: NaN reflects but is ignored; a number still applies; null clears', async () => {
    const el = await parsed();
    el.scrub = 3;
    expect(drawCount(el)).toBe(8);
    expect(() => {
      el.scrub = Number.NaN;
    }).not.toThrow();
    expect(drawCount(el)).toBe(8);
    expect(el.scrub).toBe(3);
    el.scrub = null;
    expect(drawCount(el)).toBe(24);
    el.remove();
  });

  it('scrub-time: setAttribute("scrub-time","abc") after connect does not throw and leaves the previous cut', async () => {
    const el = await parsed();
    el.setAttribute('scrub-time', '5'); // 5 segments have finished at t = 5 ms
    expect(drawCount(el)).toBe(10);
    expect(() => el.setAttribute('scrub-time', 'abc')).not.toThrow();
    expect(drawCount(el)).toBe(10);
    expect(el.scrubTime).toBe(5);
    expect(() => {
      el.scrubTime = Number.NaN;
    }).not.toThrow();
    expect(drawCount(el)).toBe(10);
    expect(el.scrubTime).toBe(5);
    el.setAttribute('scrub-time', '2');
    expect(drawCount(el)).toBe(4);
    el.setAttribute('scrub-time', 'Infinity'); // every segment has finished
    expect(drawCount(el)).toBe(24);
    el.removeAttribute('scrub-time');
    expect(el.scrubTime).toBeNull();
    el.remove();
  });

  it('after removal, a non-numeric value reads as no cut (removal is remembered)', async () => {
    const el = await parsed();
    el.setAttribute('scrub', '5');
    el.setAttribute('scrub-time', '5');
    el.removeAttribute('scrub');
    el.removeAttribute('scrub-time');
    el.setAttribute('scrub', 'abc');
    el.setAttribute('scrub-time', 'abc');
    expect(el.scrub).toBeNull();
    expect(el.scrubTime).toBeNull();
    expect(drawCount(el)).toBe(24);
    el.remove();
  });

  it('a removed attribute reads null even while disconnected', async () => {
    const el = await parsed();
    el.setAttribute('scrub', '5');
    el.setAttribute('scrub-time', '5');
    el.remove();
    el.removeAttribute('scrub');
    el.removeAttribute('scrub-time');
    expect(el.scrub).toBeNull();
    expect(el.scrubTime).toBeNull();
  });

  // On (re)connect the element applies scrub, then scrub-time only if it has a number; a numeric scrub-time
  // before a parse is a controller no-op, so the scrub cut survives and is visible once the new source parses.
  it('a reconnect applies the last numeric scrub over a non-numeric attribute', async () => {
    const el = await parsed();
    el.setAttribute('scrub', '5');
    el.setAttribute('scrub', 'nope');
    el.remove();
    document.body.appendChild(el);
    await el.parse(new Uint8Array(1000));
    await settle();
    expect(el.scrub).toBe(5);
    expect(drawCount(el)).toBe(12);
    el.remove();
  });

  it('a reconnect keeps the last numeric scrub-time over a non-numeric attribute, and it wins after the parse', async () => {
    const el = await parsed();
    el.setAttribute('scrub-time', '5');
    el.setAttribute('scrub-time', 'nope');
    el.setAttribute('scrub', '2');
    el.remove();
    document.body.appendChild(el);
    await el.parse(new Uint8Array(1000));
    await settle();
    expect(el.scrubTime).toBe(5);
    // Connect applies scrub (2), then scrub-time (5 ms) last. Made before the parse, the scrub-time waits for
    // the file and resolves on its axis: 5 segments done, cut after segment 4, 10 vertices.
    expect(drawCount(el)).toBe(10);
    el.remove();
  });
});
