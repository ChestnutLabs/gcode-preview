// @vitest-environment happy-dom
/**
 * <GcodePreview> component tests (DD-007 §4.1 D1/D4, phase 2, issue #105).
 *
 * The component is a shell over useGcodePreview: these tests drive it purely through
 * props (the D4 template-only path) and assert emits + engine effects, plus the D1
 * shell rule (the exposed handle IS the composable handle).
 */
import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, ref, shallowRef, type App } from 'vue';
import type { ProgressObservation } from '@chestnutlabs/toolpath-core';
import { GcodePreview, type GcodePreviewHandle } from '../index';
import { MACHINE, StubWorker, makeStubGL, settle } from './helpers';

interface Mounted {
  app: App;
  container: HTMLElement;
  handle: () => GcodePreviewHandle;
  emitted: Record<string, unknown[]>;
  glCalls: { dispose: number };
  props: {
    source: ReturnType<typeof shallowRef<Uint8Array | null>>;
    scrub: ReturnType<typeof ref<number | null>>;
    layerRange: ReturnType<typeof shallowRef<[number, number] | null>>;
    showTravel: ReturnType<typeof ref<boolean>>;
    progress: ReturnType<typeof shallowRef<ProgressObservation | null>>;
    buildVolume: ReturnType<typeof shallowRef<{ x: number; y: number; z: number } | undefined>>;
  };
}

function mountPreview(opts: { machine?: typeof MACHINE; consumerVolume?: boolean } = {}): Mounted {
  const { gl, calls } = makeStubGL();
  const ticks: (() => void)[] = [];
  const emitted: Record<string, unknown[]> = {};
  const record = (name: string) => (payload?: unknown) => {
    (emitted[name] ??= []).push(payload);
  };
  let exposed: unknown = null;
  const props: Mounted['props'] = {
    source: shallowRef<Uint8Array | null>(null),
    scrub: ref<number | null>(null),
    layerRange: shallowRef<[number, number] | null>(null),
    showTravel: ref(true),
    progress: shallowRef<ProgressObservation | null>(null),
    buildVolume: shallowRef(opts.consumerVolume === true ? { x: 220, y: 220, z: 250 } : undefined)
  };
  const Parent = defineComponent({
    setup() {
      return () =>
        h(GcodePreview, {
          ref: (i) => {
            exposed = i;
          },
          source: props.source.value,
          scrub: props.scrub.value,
          layerRange: props.layerRange.value,
          showTravel: props.showTravel.value,
          progress: props.progress.value,
          buildVolume: props.buildVolume.value,
          quality: 'lines',
          createWorker: () => new StubWorker(opts.machine),
          rendererOptions: {
            createRenderer: () => gl,
            scheduleFrame: (cb: () => void) => {
              ticks.push(cb);
              // Drain synchronously-ish: component tests don't need tick control.
              queueMicrotask(() => ticks.shift()?.());
            },
            chunksPerTick: 8
          },
          onReady: record('ready'),
          'onParse-error': record('parse-error'),
          'onBuild-complete': record('build-complete'),
          'onMachine-geometry-discovered': record('machine-geometry-discovered'),
          'onProgress-presentation-changed': record('progress-presentation-changed'),
          onDisclosure: record('disclosure')
        });
    }
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(Parent);
  app.mount(container);
  return {
    app,
    container,
    handle: () => (exposed as { preview: GcodePreviewHandle }).preview,
    emitted,
    glCalls: calls,
    props
  };
}

describe('<GcodePreview> — the :source-only thin path (D4)', () => {
  it('renders a canvas, parses on source, and emits ready + build-complete', async () => {
    const m = mountPreview();
    expect(m.container.querySelector('canvas')).not.toBeNull();
    m.props.source.value = new Uint8Array(1_000);
    await settle();
    expect(m.emitted['ready']?.[0]).toMatchObject({ segments: 12, layers: 2, complete: true });
    expect(m.emitted['build-complete']?.[0]).toMatchObject({ quality: 'lines' });
    m.app.unmount();
  });

  it('source change re-parses; unmount disposes worker and GL', async () => {
    const created0 = StubWorker.created;
    const terminated0 = StubWorker.terminated;
    const m = mountPreview();
    m.props.source.value = new Uint8Array(1_000);
    await settle();
    m.props.source.value = new Uint8Array(1_000);
    await settle();
    expect(m.emitted['ready']?.length).toBe(2);
    m.app.unmount();
    expect(StubWorker.created - created0).toBe(1); // one session, reused worker
    expect(StubWorker.terminated - terminated0).toBe(1);
    expect(m.glCalls.dispose).toBe(1);
  });
});

describe('<GcodePreview> — full prop surface (D4)', () => {
  it('scrub / layerRange / showTravel props reach the renderer', async () => {
    const m = mountPreview();
    m.props.source.value = new Uint8Array(1_000);
    await settle();
    const renderer = m.handle().raw.renderer()!;
    const mesh = renderer.chunkMeshes[0];
    expect(mesh.geometry.drawRange.count).toBe(24);
    m.props.scrub.value = 5;
    await settle();
    expect(mesh.geometry.drawRange.count).toBe(12);
    m.props.scrub.value = null;
    m.props.layerRange.value = [1, 1];
    await settle();
    expect(mesh.geometry.drawRange).toMatchObject({ start: 12, count: 12 });
    m.props.layerRange.value = null;
    m.props.showTravel.value = false;
    await settle();
    expect(mesh.geometry.drawRange.count).toBe(24); // extrude-only IR: travel toggle is a no-op here
    m.app.unmount();
  });

  it('progress prop drives the DD-006 chain; null clears it', async () => {
    const m = mountPreview();
    m.props.source.value = new Uint8Array(1_000);
    await settle();
    m.props.progress.value = { v: 1, timestampMs: 1_000, position: { byte: 55 } };
    await settle();
    expect(m.handle().state.presentation).toBe('exact');
    expect(m.emitted['progress-presentation-changed']?.[0]).toMatchObject({ mode: 'exact' });
    m.props.progress.value = null;
    await settle();
    expect(m.handle().state.presentation).toBe('hidden');
    m.app.unmount();
  });

  it('consumer buildVolume prop wins: discovery emitted, not applied (DD-005)', async () => {
    const m = mountPreview({ machine: MACHINE, consumerVolume: true });
    m.props.source.value = new Uint8Array(1_000);
    await settle();
    expect(m.emitted['machine-geometry-discovered']?.[0]).toMatchObject({ confidence: 'known' });
    m.app.unmount();
  });
});

describe('<GcodePreview> — D1 shell rule', () => {
  it('the exposed handle IS the composable handle (no parallel implementation)', async () => {
    const m = mountPreview();
    m.props.source.value = new Uint8Array(1_000);
    await settle();
    const handle = m.handle();
    // Composable-shaped surface, engine reachable, state coherent with emits.
    expect(typeof handle.parse).toBe('function');
    expect(typeof handle.observeProgress).toBe('function');
    expect(handle.state.summary?.segments).toBe(12);
    expect(handle.raw.renderer()).not.toBeNull();
    m.app.unmount();
  });
});
