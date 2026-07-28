/**
 * AnnotationSink implementation (DD-005 §4.1).
 *
 * Writes are BUFFERED as ops during the parse (the IR's final channels don't
 * exist until `finish()`), then applied to the finished IR in one validated
 * pass. Bounds are clamped, budgets enforced, and the sink physically cannot
 * reach geometry — it only ever touches `feature`, `object`, header
 * capabilities/warnings, the metadata object beside the IR, and (DD-016 §4.2)
 * an ADDITIVE allow-listed move-kind bit (`Wipe`/`Seam`) that never clears or
 * reclassifies a move.
 */
import {
  MoveKind,
  type Confidence,
  type DialectMetadata,
  type FilamentInfo,
  type FilamentUsage,
  type MachineGeometry,
  type PrintEstimate,
  type ThumbnailData,
  type ToolpathIR,
  type Warning
} from '@chestnutlabs/toolpath-core';
import type { AnnotationSink } from './contracts.js';

/** The only move-kind bits an adapter may add (DD-016 §4.2/D6) — additive annotation kinds, never motion. */
const ALLOWED_ANNOTATION_KINDS = MoveKind.Wipe | MoveKind.Seam;

const MAX_RANGE_OPS = 1_000_000;
const MAX_OBJECTS = 10_000;
const MAX_RAW_ENTRIES = 512;
const MAX_RAW_VALUE = 4_096;
const MAX_WARNINGS = 100;
const MAX_THUMBNAILS = 8;

type RangeOp = { channel: 'feature' | 'object' | 'kind'; start: number; end: number; value: number };

export class BufferedAnnotationSink implements AnnotationSink {
  private ops: RangeOp[] = [];
  private objects = new Map<number, string>();
  private machine: MachineGeometry | null = null;
  private filaments: FilamentInfo[] = [];
  private filamentUsage: FilamentUsage | null = null;
  private printEstimate: PrintEstimate | null = null;
  private toolInfos = new Map<number, { material?: string; colorHex?: string }>();
  private thumbnails: ThumbnailData[] = [];
  private raw = new Map<string, string>();
  private capabilities = new Map<string, Confidence>();
  private warnings: Warning[] = [];
  private overflow = false;

  constructor(private readonly adapterId: string) {}

  private pushOp(op: RangeOp): void {
    if (this.ops.length >= MAX_RANGE_OPS) {
      if (!this.overflow) {
        this.overflow = true;
        this.warn('dialect-annotation-truncated', `adapter '${this.adapterId}' exceeded the annotation op budget`);
      }
      return;
    }
    if (op.end < op.start || op.start < 0) return;
    this.ops.push(op);
  }

  setFeature(segStart: number, segEnd: number, role: number): void {
    this.pushOp({ channel: 'feature', start: segStart, end: segEnd, value: role & 0xff });
  }

  setObject(segStart: number, segEnd: number, objectId: number): void {
    this.pushOp({ channel: 'object', start: segStart, end: segEnd, value: objectId >>> 0 });
  }

  addMoveKind(segStart: number, segEnd: number, kindBits: number): void {
    // Allow-list guard (DD-016 D6): only additive Wipe/Seam bits; anything else is a contract
    // violation, dropped with a bounded warning rather than corrupting the kind channel.
    const bits = kindBits & ALLOWED_ANNOTATION_KINDS;
    if (bits === 0 || (kindBits & ~ALLOWED_ANNOTATION_KINDS) !== 0) {
      this.warn(
        'dialect-kind-not-allowlisted',
        `adapter '${this.adapterId}' tried to set non-allow-listed move-kind bits 0x${(kindBits >>> 0).toString(16)}`
      );
      return;
    }
    this.pushOp({ channel: 'kind', start: segStart, end: segEnd, value: bits });
  }

  defineObject(id: number, name: string): void {
    if (this.objects.size < MAX_OBJECTS) this.objects.set(id, name.slice(0, 256));
  }

  setMachine(machine: MachineGeometry): void {
    this.machine = machine;
  }

  setFilament(info: FilamentInfo): void {
    if (this.filaments.length < 64) this.filaments.push(info);
  }

  setFilamentUsage(usage: FilamentUsage): void {
    // Merge non-undefined fields (a slicer emits length/volume/weight on separate comment lines).
    const prev = this.filamentUsage;
    this.filamentUsage = {
      lengthMm: usage.lengthMm ?? prev?.lengthMm,
      volumeCm3: usage.volumeCm3 ?? prev?.volumeCm3,
      weightG: usage.weightG ?? prev?.weightG,
      source: prev?.source ?? usage.source
    };
  }

  setPrintEstimate(estimate: PrintEstimate): void {
    // First estimate wins (adapters send the default/'normal' mode first; ignore later silent-mode).
    if (this.printEstimate === null) this.printEstimate = estimate;
  }

  setToolInfo(tool: number, info: { material?: string; colorHex?: string }): void {
    if (this.toolInfos.size < 64) this.toolInfos.set(tool, info);
  }

  addThumbnail(thumb: ThumbnailData): void {
    if (this.thumbnails.length < MAX_THUMBNAILS) this.thumbnails.push(thumb);
  }

  setRaw(key: string, value: string): void {
    if (this.raw.size < MAX_RAW_ENTRIES) this.raw.set(key.slice(0, 128), value.slice(0, MAX_RAW_VALUE));
  }

  upgradeCapability(key: string, confidence: Confidence): void {
    this.capabilities.set(key, confidence);
  }

  warn(code: string, message: string, srcByte?: number): void {
    const existing = this.warnings.find((w) => w.code === code);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
    } else if (this.warnings.length < MAX_WARNINGS) {
      this.warnings.push({ code, message, severity: 'warn', srcByte, count: 1 });
    }
  }

  /**
   * Apply buffered annotations to the finished IR (channels + header) and merge
   * this adapter's contribution into the shared metadata object. Range ops are
   * clamped to the real segment count — a lying adapter cannot write outside
   * the buffers, and geometry channels are unreachable by construction.
   */
  apply(ir: ToolpathIR, metadata: DialectMetadata, conflictWarn: (code: string, message: string) => void): void {
    const count = ir.segments.count;
    const touched = { feature: false, object: false };
    for (const op of this.ops) {
      const start = Math.min(op.start, count);
      const end = Math.min(op.end + 1, count);
      if (end <= start) continue;
      if (op.channel === 'kind') {
        // DD-016: additive OR — preserve the base Extrude/Travel classification, never overwrite it.
        const kind = ir.segments.kind;
        for (let i = start; i < end; i++) kind[i] |= op.value;
        continue;
      }
      ir.segments[op.channel].fill(op.value, start, end);
      touched[op.channel] = true;
    }
    // Object channel semantics (DD-001): value v > 0 indexes ir.objects[v-1].
    for (const [channelValue, name] of [...this.objects.entries()].sort((a, b) => a[0] - b[0])) {
      if (channelValue < 1) continue;
      while (ir.objects.length < channelValue) {
        ir.objects.push({ id: String(ir.objects.length + 1) });
      }
      ir.objects[channelValue - 1] = { id: String(channelValue), name };
    }
    for (const [toolId, info] of this.toolInfos) {
      let entry = ir.tools.find((t) => t.id === toolId);
      if (entry === undefined) {
        entry = { id: toolId };
        ir.tools.push(entry);
        ir.tools.sort((a, b) => a.id - b.id);
      }
      if (info.material !== undefined) entry.material = info.material;
      if (info.colorHex !== undefined) {
        const m = /^#?([0-9a-f]{6})$/i.exec(info.colorHex.trim());
        if (m !== null) {
          const v = parseInt(m[1], 16);
          entry.color = { r: ((v >> 16) & 0xff) / 255, g: ((v >> 8) & 0xff) / 255, b: (v & 0xff) / 255, a: 1 };
        }
      }
    }
    for (const [key, confidence] of this.capabilities) {
      ir.header.capabilities[key] = confidence;
    }
    for (const w of this.warnings) {
      ir.header.warnings.push(w);
    }
    if (this.machine !== null) {
      if (metadata.machine !== undefined) {
        conflictWarn('dialect-conflict', `adapter '${this.adapterId}' overwrote machine geometry`);
      }
      metadata.machine = this.machine;
    }
    if (this.filaments.length > 0) {
      metadata.filaments = [...(metadata.filaments ?? []), ...this.filaments];
    }
    if (this.filamentUsage !== null && metadata.filamentUsage === undefined) {
      metadata.filamentUsage = this.filamentUsage;
    }
    if (this.printEstimate !== null && metadata.printEstimate === undefined) {
      metadata.printEstimate = this.printEstimate;
    }
    if (this.thumbnails.length > 0) {
      metadata.thumbnails = [...(metadata.thumbnails ?? []), ...this.thumbnails];
    }
    if (this.raw.size > 0) {
      metadata.raw = { ...(metadata.raw ?? {}), ...Object.fromEntries(this.raw) };
    }
  }
}
