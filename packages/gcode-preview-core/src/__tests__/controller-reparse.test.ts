// @vitest-environment happy-dom
/**
 * Regression (#453) at the consumer surface: parsing the same Uint8Array twice. The first parse
 * transfers the bytes' buffer to the worker; the second used to wedge the controller's session, so
 * every later parse — even of fresh bytes — failed with E_BUSY. It must now fail cleanly with
 * E_POST_FAILED and leave the preview usable.
 */
import { describe, expect, it } from 'vitest';
import { createPreviewController, type PreviewEvent } from '../index';
import { SuiteStubWorker, makeSuiteStubGL } from '../testing';

/** The suite stub, behind a real structured-clone + transfer boundary (detaches like a Worker). */
class TransferringStubWorker extends SuiteStubWorker {
  override postMessage(msg: { type: string; id: number }, transfer?: unknown[]): void {
    super.postMessage(structuredClone(msg, { transfer: (transfer ?? []) as Transferable[] }));
  }
}

describe('controller re-parse of transferred bytes (#453)', () => {
  it('fails the second parse with E_POST_FAILED, then parses a copy normally', async () => {
    const canvas = document.createElement('canvas');
    const controller = createPreviewController({
      createWorker: () => new TransferringStubWorker(),
      renderer: {
        quality: 'lines',
        createRenderer: () => makeSuiteStubGL(canvas),
        scheduleFrame: (cb) => cb()
      }
    });
    controller.bindCanvas(canvas);
    const errors: string[] = [];
    controller.onEvent((e: PreviewEvent) => {
      if (e.type === 'parse-error') errors.push(e.code);
    });

    const bytes = new Uint8Array(1_000);
    const copy = bytes.slice();
    expect((await controller.parse(bytes)).ok).toBe(true);
    expect(bytes.byteLength).toBe(0);

    const again = await controller.parse(bytes);
    expect(again).toMatchObject({ ok: false, error: { code: 'E_POST_FAILED' } });
    expect(controller.getState().parsing).toBe(false);
    expect(errors).toEqual(['E_POST_FAILED']);

    expect((await controller.parse(copy)).ok).toBe(true); // pre-fix: E_BUSY
    expect(controller.getState().error).toBeNull();
    controller.dispose();
  });
});
