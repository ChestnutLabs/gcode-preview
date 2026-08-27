// @vitest-environment happy-dom
/**
 * DD-029 Phase A (core) — core maps the parser's phase to `stage:'parsing'` (real byte fraction) /
 * `stage:'classifying'` (the `finalizing` phase where dialect annotation settles), and forwards the
 * renderer's `building-geometry`/`preparing-gpu`/`ready` stages. Asserts the full ordered vocabulary.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { createPreviewController, type PreviewEvent } from '../index';
import { makeSuiteStubGL } from '../testing';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

function makeIR(): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  for (let i = 0; i < 6; i++) {
    b.addSegment({
      x0: 100 + i,
      y0: 100,
      z0: 0.2,
      x1: 101 + i,
      y1: 100,
      z1: 0.2,
      e: 1,
      kind: MoveKind.Extrude,
      layer: 0,
      srcByte: i * 10
    });
  }
  return b.finalize();
}

/** A stub worker that emits real `progress` messages (parsing then finalizing) before `done`. */
class ProgressWorker {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  postMessage(msg: { type: string; id: number }): void {
    if (msg.type !== 'parse') return;
    queueMicrotask(() => {
      this.onmessage?.({
        data: { v: 1, type: 'progress', id: msg.id, bytesProcessed: 500, totalBytes: 1000, phase: 'parsing' }
      });
      this.onmessage?.({
        data: { v: 1, type: 'progress', id: msg.id, bytesProcessed: 1000, totalBytes: 1000, phase: 'finalizing' }
      });
      this.onmessage?.({ data: { v: 1, type: 'done', id: msg.id, ir: makeIR(), stats: { bytes: 1000, wallMs: 1 } } });
    });
  }
  terminate(): void {}
}

describe('DD-029 staged progress (core: parsing/classifying + forwarded renderer stages)', () => {
  it('emits parsing (real fraction) → classifying, then forwards building-geometry → preparing-gpu → ready', async () => {
    const canvas = document.createElement('canvas');
    const events: PreviewEvent[] = [];
    const controller = createPreviewController({
      createWorker: () => new ProgressWorker() as unknown as Worker,
      renderer: {
        quality: 'lines',
        chunksPerTick: 8,
        createRenderer: () => makeSuiteStubGL(canvas),
        scheduleFrame: (cb) => cb()
      }
    });
    controller.bindCanvas(canvas);
    controller.onEvent((e) => events.push(e));

    await controller.parse(new Uint8Array(1000));
    await settle();

    const stages = events
      .filter((e): e is Extract<PreviewEvent, { type: 'stage' }> => e.type === 'stage')
      .map((e) => e.stage);

    // Core's two stages, from the parser phase.
    expect(stages).toContain('parsing');
    expect(stages).toContain('classifying');
    // Forwarded renderer stages.
    expect(stages).toContain('building-geometry');
    expect(stages[stages.length - 1]).toBe('ready');
    // Ordering: parsing before classifying before building-geometry before ready.
    expect(stages.indexOf('parsing')).toBeLessThan(stages.indexOf('classifying'));
    expect(stages.indexOf('classifying')).toBeLessThan(stages.indexOf('building-geometry'));
    expect(stages.indexOf('building-geometry')).toBeLessThan(stages.lastIndexOf('ready'));

    // parsing carries the real byte fraction; existing parse-progress still flows.
    const parsing = events.find((e) => e.type === 'stage' && (e as { stage: string }).stage === 'parsing') as
      | { progress?: number }
      | undefined;
    expect(parsing?.progress).toBeCloseTo(0.5, 5);
    expect(events.some((e) => e.type === 'parse-progress')).toBe(true);
    expect(events.some((e) => e.type === 'buildComplete')).toBe(true);

    controller.dispose();
  });
});
