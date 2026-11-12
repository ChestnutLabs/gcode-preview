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
import { INVALID_VALUE_WARNING } from './annotate.js';

/** The only move-kind bits an adapter may add (DD-016 §4.2/D6) — additive annotation kinds, never motion. */
const ALLOWED_ANNOTATION_KINDS = MoveKind.Wipe | MoveKind.Seam;

const MAX_RANGE_OPS = 1_000_000;
/** Object-name budget, and the highest object-channel value a name may be defined for (DD-001: v → ir.objects[v-1]). */
const MAX_OBJECTS = 10_000;
const MAX_RAW_ENTRIES = 512;
const MAX_RAW_VALUE = 4_096;
const MAX_WARNINGS = 100;
const MAX_THUMBNAILS = 8;
const MAX_FILAMENTS = 64;
const MAX_TOOL_INFOS = 64;

/** Warning code for an annotation budget that ran out (extra entries dropped). */
const TRUNCATED_WARNING = 'dialect-annotation-truncated';

/** `#RRGGBB` or `#RRGGBBAA` (the `#` optional). The alpha is dropped: a tool colour is a display hue. */
const TOOL_COLOR = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i;

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
  /** Budgets that already reported running out (each is reported once, not once per dropped entry). */
  private exhausted = new Set<string>();

  constructor(private readonly adapterId: string) {}

  /** Report, once per budget, that `budget` is full and further entries are dropped. */
  private truncated(budget: string, limit: number): void {
    if (this.exhausted.has(budget)) return;
    this.exhausted.add(budget);
    this.warn(
      TRUNCATED_WARNING,
      `adapter '${this.adapterId}' exceeded the ${budget} budget (${limit}); further entries dropped`
    );
  }

  private pushOp(op: RangeOp): void {
    if (this.ops.length >= MAX_RANGE_OPS) {
      this.truncated('annotation op', MAX_RANGE_OPS);
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
    // `apply` pads ir.objects up to the value, so the value is bounded by the name budget: an
    // unbounded one (50,000,000) ran the worker out of memory. Built-in adapters assign 1..N in order.
    if (!Number.isInteger(id) || id < 1 || id > MAX_OBJECTS || typeof name !== 'string') {
      this.warn(
        INVALID_VALUE_WARNING,
        `adapter '${this.adapterId}' defined an object with an unusable value or name; dropped`
      );
      return;
    }
    if (this.objects.size < MAX_OBJECTS) this.objects.set(id, name.slice(0, 256));
    else this.truncated('object name', MAX_OBJECTS);
  }

  setMachine(machine: MachineGeometry): void {
    this.machine = machine;
  }

  setFilament(info: FilamentInfo): void {
    if (this.filaments.length < MAX_FILAMENTS) this.filaments.push(info);
    else this.truncated('filament', MAX_FILAMENTS);
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
    // Validated (and copied) here, inside the adapter's containment: `apply` must not be the first
    // place a non-string colour throws (it failed the whole parse).
    const { material, colorHex } = info;
    if (
      !Number.isInteger(tool) ||
      tool < 0 ||
      (material !== undefined && typeof material !== 'string') ||
      (colorHex !== undefined && typeof colorHex !== 'string')
    ) {
      this.warn(INVALID_VALUE_WARNING, `adapter '${this.adapterId}' gave unusable tool info; dropped`);
      return;
    }
    if (this.toolInfos.size < MAX_TOOL_INFOS) this.toolInfos.set(tool, { material, colorHex });
    else this.truncated('tool info', MAX_TOOL_INFOS);
  }

  addThumbnail(thumb: ThumbnailData): void {
    if (this.thumbnails.length < MAX_THUMBNAILS) this.thumbnails.push(thumb);
    else this.truncated('thumbnail', MAX_THUMBNAILS);
  }

  setRaw(key: string, value: string): void {
    if (this.raw.size < MAX_RAW_ENTRIES) this.raw.set(key.slice(0, 128), value.slice(0, MAX_RAW_VALUE));
    else this.truncated('raw metadata', MAX_RAW_ENTRIES);
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
   *
   * All or nothing: if anything throws part-way, every IR and metadata field this pass touched is
   * restored before the error propagates (the registry then reports `adapter-failed`), so a failed
   * adapter never leaves half its objects, tools or channel ranges behind.
   */
  apply(ir: ToolpathIR, metadata: DialectMetadata, conflictWarn: (code: string, message: string) => void): void {
    const channels = new Set<RangeOp['channel']>();
    for (const op of this.ops) channels.add(op.channel);
    const restore = snapshot(ir, metadata, channels);
    const conflicts: [string, string][] = [];
    try {
      this.write(ir, metadata, (code, message) => conflicts.push([code, message]));
    } catch (err) {
      restore();
      throw err;
    }
    for (const [code, message] of conflicts) conflictWarn(code, message);
  }

  private write(
    ir: ToolpathIR,
    metadata: DialectMetadata,
    conflictWarn: (code: string, message: string) => void
  ): void {
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
    // `objectBounds` was computed by the parse core before any object labels existed (empty then). Now
    // that this adapter has populated the object channel, refresh the object-only bounds so
    // `frameContent:'object'` (#306/#6) frames the printed object rather than falling back to `'all'`.
    // Mirrors toolpath-core's parse-time objectBounds pass (extruded segments with object != 0), in
    // absolute coordinates; empty (Infinity) stays empty when nothing qualifies — the honest default.
    if (touched.object) {
      const seg = ir.segments;
      const o = ir.header.originOffset;
      const b = ir.objectBounds;
      b.min.x = b.min.y = b.min.z = Infinity;
      b.max.x = b.max.y = b.max.z = -Infinity;
      for (let i = 0; i < count; i++) {
        if ((seg.kind[i] & MoveKind.Extrude) === 0 || seg.object[i] === 0) continue;
        const sx = o.x + seg.x0[i];
        const sy = o.y + seg.y0[i];
        const sz = o.z + seg.z0[i];
        const ex = o.x + seg.x1[i];
        const ey = o.y + seg.y1[i];
        const ez = o.z + seg.z1[i];
        if (sx < b.min.x) b.min.x = sx;
        if (sy < b.min.y) b.min.y = sy;
        if (sz < b.min.z) b.min.z = sz;
        if (sx > b.max.x) b.max.x = sx;
        if (sy > b.max.y) b.max.y = sy;
        if (sz > b.max.z) b.max.z = sz;
        if (ex < b.min.x) b.min.x = ex;
        if (ey < b.min.y) b.min.y = ey;
        if (ez < b.min.z) b.min.z = ez;
        if (ex > b.max.x) b.max.x = ex;
        if (ey > b.max.y) b.max.y = ey;
        if (ez > b.max.z) b.max.z = ez;
      }
    }
    // Object channel semantics (DD-001): value v > 0 indexes ir.objects[v-1]. Order does not matter:
    // the padding gives every gap its placeholder, and each value then writes its own index.
    // (defineObject admits only integers 1..10,000, so every value here is a real index.)
    for (const [channelValue, name] of this.objects) {
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
        const m = TOOL_COLOR.exec(info.colorHex.trim());
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

/**
 * Capture every IR / metadata field `BufferedAnnotationSink.write` can touch, and return a function
 * that puts them back IN PLACE (the arrays and objects keep their identity). Only the segment channels
 * this sink has ops for are copied.
 */
function snapshot(ir: ToolpathIR, metadata: DialectMetadata, channels: Set<RangeOp['channel']>): () => void {
  const seg = ir.segments;
  const saved = [...channels].map((c) => [c, seg[c].slice()] as const);
  const { min, max } = ir.objectBounds;
  const bounds = [min.x, min.y, min.z, max.x, max.y, max.z];
  const objects = ir.objects.slice();
  const tools = ir.tools.map((t) => ({ entry: t, copy: { ...t } }));
  const capabilities = { ...ir.header.capabilities };
  const warningCount = ir.header.warnings.length;
  const meta = { ...metadata };
  return () => {
    for (const [c, copy] of saved) seg[c].set(copy);
    [min.x, min.y, min.z, max.x, max.y, max.z] = bounds;
    ir.objects.length = 0;
    ir.objects.push(...objects);
    ir.tools.length = 0;
    for (const { entry, copy } of tools) {
      for (const k of Object.keys(entry)) delete (entry as unknown as Record<string, unknown>)[k];
      ir.tools.push(Object.assign(entry, copy));
    }
    const caps = ir.header.capabilities;
    for (const k of Object.keys(caps)) delete caps[k];
    Object.assign(caps, capabilities);
    ir.header.warnings.length = warningCount;
    for (const k of Object.keys(metadata) as (keyof DialectMetadata)[]) delete metadata[k];
    Object.assign(metadata, meta);
  };
}
