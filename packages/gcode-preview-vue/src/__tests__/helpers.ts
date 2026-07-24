/** Shared test harness: protocol-v1 stub worker, synthetic IR, stub GL (issues #104/#105). */
import { MoveKind, ToolpathIRBuilder, type MachineGeometry, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import type { GLRendererLike } from '@chestnutlabs/gcode-renderer-three';

export function makeIR(layers = 2, perLayer = 6): ToolpathIR {
  const b = new ToolpathIRBuilder({
    parserVersion: 'test',
    units: 'mm',
    unitsSource: 'known',
    source: { byteLength: 1_000 }
  });
  let src = 0;
  for (let l = 0; l < layers; l++) {
    for (let s = 0; s < perLayer; s++) {
      b.addSegment({
        x0: 100 + s,
        y0: 100,
        z0: 0.2 * (l + 1),
        x1: 101 + s,
        y1: 100,
        z1: 0.2 * (l + 1),
        e: 1,
        kind: MoveKind.Extrude,
        layer: l,
        srcByte: src++ * 10
      });
    }
  }
  return b.finalize();
}

/** Protocol-v1-shaped stub worker: parse → done (optionally with metadata), cancel → cancelled. */
export class StubWorker {
  static created = 0;
  static terminated = 0;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  constructor(private readonly machine?: MachineGeometry) {
    StubWorker.created++;
  }
  postMessage(msg: { type: string; id: number }): void {
    if (msg.type === 'parse') {
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            v: 1,
            type: 'done',
            id: msg.id,
            ir: makeIR(),
            stats: { bytes: 1_000, wallMs: 1, stopReason: undefined },
            metadata: this.machine === undefined ? undefined : { machine: this.machine }
          }
        });
      });
    } else if (msg.type === 'cancel') {
      queueMicrotask(() => {
        this.onmessage?.({ data: { v: 1, type: 'cancelled', id: msg.id } });
      });
    }
  }
  terminate(): void {
    StubWorker.terminated++;
  }
}

export const MACHINE: MachineGeometry = {
  bed: { kind: 'rect', min: { x: 0, y: 0 }, max: { x: 256, y: 256 } },
  heightMm: 256,
  origin: { x: 0, y: 0 },
  confidence: 'known',
  source: { adapterId: 'test', evidence: 'stub' }
};

export function makeStubGL(): { gl: GLRendererLike; calls: { dispose: number } } {
  const calls = { dispose: 0 };
  const gl: GLRendererLike = {
    render: () => undefined,
    setSize: () => undefined,
    dispose: () => {
      calls.dispose++;
    },
    domElement: document.createElement('canvas')
  };
  return { gl, calls };
}

/** Settle the stub-worker microtask round-trips + Vue effects. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
}
