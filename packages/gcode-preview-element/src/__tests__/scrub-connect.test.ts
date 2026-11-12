// @vitest-environment happy-dom
/**
 * `<gcode-preview>` initial `scrub` / `scrub-time` at connect (#542 review). The controller maps
 * `setScrubTime(null)` to a scrub clear, so the element must not call it when `scrub-time` has no number,
 * or `<gcode-preview scrub="5">` would lose its initial cut. When both are set, scrub-time is applied last.
 * The controller's scrub controls are wrapped to record the call order; the 3D renderer is spied for effect.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { ToolpathRenderer } from '@chestnutlabs/gcode-renderer-three';
import { GcodePreviewElement, defineGcodePreview } from '../index';

const rec = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('@chestnutlabs/gcode-preview-core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@chestnutlabs/gcode-preview-core')>();
  return {
    ...mod,
    createPreviewController: (opts: Parameters<typeof mod.createPreviewController>[0]) => {
      const controller = mod.createPreviewController(opts);
      const c = controller.controls;
      const pos = c.setScrubPosition.bind(c);
      const time = c.setScrubTime.bind(c);
      c.setScrubPosition = (s) => {
        rec.calls.push(`pos:${String(s)}`);
        pos(s);
      };
      c.setScrubTime = (ms) => {
        rec.calls.push(`time:${String(ms)}`);
        time(ms);
      };
      return controller;
    }
  };
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

function makeEl(attrs: Record<string, string>): GcodePreviewElement {
  defineGcodePreview();
  const canvas = document.createElement('canvas');
  const el = document.createElement('gcode-preview') as GcodePreviewElement;
  el.createWorker = () => new SuiteStubWorker();
  el.quality = 'lines';
  el.rendererOptions = { createRenderer: () => makeSuiteStubGL(canvas), scheduleFrame: (cb) => cb(), chunksPerTick: 8 };
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

const drawCount = (el: GcodePreviewElement): number => el.raw.renderer()!.chunkMeshes[0].geometry.drawRange.count;

async function connectAndParse(el: GcodePreviewElement): Promise<void> {
  document.body.appendChild(el);
  await el.parse(new Uint8Array(1000));
  await settle();
}

afterEach(() => {
  rec.calls.length = 0;
  vi.restoreAllMocks();
});

describe('<gcode-preview> initial scrub at connect', () => {
  it('scrub="5" with no scrub-time keeps its cut: no scrub-time call, the renderer ends at 5', async () => {
    const onRenderer = vi.spyOn(ToolpathRenderer.prototype, 'setScrubPosition');
    const el = makeEl({ scrub: '5' });
    await connectAndParse(el);
    expect(rec.calls).toEqual(['pos:5']);
    expect(onRenderer.mock.calls.at(-1)).toEqual([5]);
    expect(drawCount(el)).toBe(12); // 12 segments x 2 vertices, cut after index 5
    el.remove();
  });

  it('a reconnect keeps the initial scrub cut', async () => {
    const el = makeEl({ scrub: '5' });
    await connectAndParse(el);
    el.remove();
    rec.calls.length = 0;
    const onRenderer = vi.spyOn(ToolpathRenderer.prototype, 'setScrubPosition');
    await connectAndParse(el);
    expect(rec.calls).toEqual(['pos:5']);
    expect(onRenderer.mock.calls.at(-1)).toEqual([5]);
    expect(drawCount(el)).toBe(12);
    el.remove();
  });

  it('with both set, scrub-time is applied last (it wins)', async () => {
    const el = makeEl({ scrub: '5', 'scrub-time': '3' });
    await connectAndParse(el);
    expect(rec.calls).toEqual(['pos:5', 'time:3']);
    el.remove();
  });

  it('a reconnect re-applies the last numeric scrub-time over a non-numeric attribute', async () => {
    const el = makeEl({ 'scrub-time': '7' });
    await connectAndParse(el);
    el.setAttribute('scrub-time', 'nope');
    el.remove();
    rec.calls.length = 0;
    await connectAndParse(el);
    expect(rec.calls).toEqual(['pos:null', 'time:7']);
    el.remove();
  });

  it('removing scrub-time after connect still clears the cut (unchanged semantics)', async () => {
    const el = makeEl({});
    await connectAndParse(el);
    el.setAttribute('scrub-time', '100');
    el.setAttribute('scrub', '5');
    expect(drawCount(el)).toBe(12);
    el.removeAttribute('scrub-time');
    expect(rec.calls.at(-1)).toBe('time:null');
    expect(drawCount(el)).toBe(24);
    el.remove();
  });
});
