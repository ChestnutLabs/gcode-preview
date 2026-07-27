// @vitest-environment happy-dom
/**
 * Controller tests (DD-007 §4.6, phase 5, issue #112): the portable behavioral suite
 * runs against the controller DIRECTLY (the reference harness every adapter mirrors),
 * plus the snapshot state-model guarantees the framework bridges rely on.
 */
import { describe, expect, it } from 'vitest';
import type { MachineGeometry } from '@chestnutlabs/toolpath-core';
import { createPreviewController, type PreviewEvent } from '../index';
import { SuiteStubWorker, makeSuiteStubGL, runBehavioralSuite, type AdapterInstance } from '../testing';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

function makeController(opts: { machine?: MachineGeometry; consumerVolume?: boolean } = {}) {
  const canvas = document.createElement('canvas');
  const controller = createPreviewController({
    createWorker: () => new SuiteStubWorker(opts.machine),
    renderer: {
      buildVolume: opts.consumerVolume === true ? { x: 220, y: 220, z: 250 } : undefined,
      quality: 'lines',
      chunksPerTick: 8,
      createRenderer: () => makeSuiteStubGL(canvas),
      scheduleFrame: (cb) => cb()
    }
  });
  controller.bindCanvas(canvas);
  return controller;
}

runBehavioralSuite(
  'preview-core controller',
  { describe, it, expect },
  {
    create(opts = {}) {
      const controller = makeController(opts);
      const instance: AdapterInstance = {
        parse: (bytes) => controller.parse(bytes),
        getState: () => controller.getState(),
        controls: controller.controls,
        observeProgress: (obs) => controller.observeProgress(obs),
        clearProgress: () => controller.clearProgress(),
        onEvent: (cb) => controller.onEvent(cb),
        firstChunkDrawCount: () => controller.raw.renderer()!.chunkMeshes[0].geometry.drawRange.count,
        dispose: () => controller.dispose(),
        settle
      };
      return instance;
    }
  }
);

describe('controller state model (bridge guarantees)', () => {
  it('replaces the snapshot identity on every change and notifies subscribers', async () => {
    const controller = makeController();
    const before = controller.getState();
    const seen: unknown[] = [];
    controller.onStateChange((s) => seen.push(s));
    await controller.parse(new Uint8Array(1_000));
    await settle();
    const after = controller.getState();
    expect(after).not.toBe(before); // identity change — useSyncExternalStore contract
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(after); // last notification IS the current snapshot
    // Old snapshots are frozen history: the pre-parse snapshot still says parsing:false/summary:null.
    expect(before.summary).toBeNull();
    expect(after.summary).not.toBeNull();
    controller.dispose();
  });

  it('unbinding the canvas keeps IR state; rebinding restores the scene', async () => {
    const controller = makeController();
    await controller.parse(new Uint8Array(1_000));
    await settle();
    controller.bindCanvas(null);
    expect(controller.raw.renderer()).toBeNull();
    expect(controller.getState().summary?.segments).toBe(12);
    const canvas2 = document.createElement('canvas');
    controller.bindCanvas(canvas2);
    await settle();
    expect(controller.raw.renderer()?.segmentCount).toBe(12);
    controller.dispose();
  });
});

describe('renderer.mode selection (DD-014 D5)', () => {
  it('mode "2d" binds synchronously (no Three.js load) and discloses 3D-only requests', async () => {
    const canvas = document.createElement('canvas');
    const controller = createPreviewController({
      createWorker: () => new SuiteStubWorker(),
      renderer: { mode: '2d' }
    });
    controller.bindCanvas(canvas);
    // The 2D renderer is a static, three-free import — ready on the same tick, no settle needed.
    expect(controller.raw.renderer()).not.toBeNull();

    const events: PreviewEvent[] = [];
    controller.onEvent((e) => events.push(e));
    controller.controls.setCameraMode('orthographic'); // 3D-only
    controller.controls.setQuality('high'); // 3D-only
    const disclosed = events
      .filter((e): e is Extract<PreviewEvent, { type: 'renderer-unsupported' }> => e.type === 'renderer-unsupported')
      .map((e) => e.feature)
      .sort();
    expect(disclosed).toEqual(['camera', 'quality']);

    const outcome = await controller.parse(new Uint8Array(1_000));
    expect(outcome.ok).toBe(true);
    expect(controller.getState().summary?.segments).toBe(12);
    controller.dispose();
  });

  it('mode "3d" (default) resolves the renderer asynchronously (Three.js loaded on demand)', async () => {
    const canvas = document.createElement('canvas');
    const controller = createPreviewController({
      createWorker: () => new SuiteStubWorker(),
      renderer: { quality: 'lines', createRenderer: () => makeSuiteStubGL(canvas), scheduleFrame: (cb) => cb() }
    });
    controller.bindCanvas(canvas);
    expect(controller.raw.renderer()).toBeNull(); // dynamic import → not ready this tick
    await settle();
    expect(controller.raw.renderer()).not.toBeNull();
    controller.dispose();
  });
});
