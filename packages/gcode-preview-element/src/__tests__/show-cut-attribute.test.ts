// @vitest-environment happy-dom
/**
 * `<gcode-preview>` `show-cut` / `showCut` (#584): CNC/laser cutting moves are their own toggleable chunk.
 * Default visible; `show-cut="false"` (or `showCut = false`) hides only the cut chunk, also at connect time.
 */
import { describe, expect, it } from 'vitest';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { GcodePreviewElement, defineGcodePreview } from '../index';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

function cutIR(): ToolpathIR {
  const b = new ToolpathIRBuilder({
    parserVersion: 'cut',
    units: 'mm',
    unitsSource: 'known',
    source: { byteLength: 100 }
  });
  b.addSegment({ x0: 0, y0: 0, z0: 0, x1: 5, y1: 0, z1: 0, kind: MoveKind.Cut, layer: 0, srcByte: 0 });
  b.addSegment({ x0: 5, y0: 0, z0: 0, x1: 9, y1: 0, z1: 0, kind: MoveKind.Travel, layer: 0, srcByte: 10 });
  return b.finalize();
}

async function connected(attrs: Record<string, string> = {}): Promise<GcodePreviewElement> {
  defineGcodePreview();
  const canvas = document.createElement('canvas');
  const el = document.createElement('gcode-preview') as GcodePreviewElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.createWorker = () => new SuiteStubWorker(undefined, () => cutIR());
  el.quality = 'lines';
  el.rendererOptions = { createRenderer: () => makeSuiteStubGL(canvas), scheduleFrame: (cb) => cb(), chunksPerTick: 8 };
  document.body.appendChild(el);
  await el.parse(new Uint8Array(100));
  await settle();
  return el;
}

const cutVisible = (el: GcodePreviewElement): boolean[] =>
  el.raw
    .renderer()!
    .chunkMeshes.filter((m) => (m.userData.chunk as { kind: string }).kind === 'cut')
    .map((m) => m.visible);

describe('<gcode-preview> show-cut', () => {
  it('defaults to true and reflects the attribute', () => {
    defineGcodePreview();
    const el = document.createElement('gcode-preview') as GcodePreviewElement;
    expect(el.showCut).toBe(true);
    el.showCut = false;
    expect(el.getAttribute('show-cut')).toBe('false');
    expect(el.showCut).toBe(false);
    el.showCut = true;
    expect(el.getAttribute('show-cut')).toBe('true');
  });

  it('shows cuts by default and toggles only the cut chunk at runtime', async () => {
    const el = await connected();
    expect(cutVisible(el)).toEqual([true]);
    el.setAttribute('show-cut', 'false');
    expect(cutVisible(el)).toEqual([false]);
    el.showCut = true;
    expect(cutVisible(el)).toEqual([true]);
    el.remove();
  });

  it('applies show-cut="false" given in markup at connect', async () => {
    const el = await connected({ 'show-cut': 'false' });
    expect(cutVisible(el)).toEqual([false]);
    el.remove();
  });
});
