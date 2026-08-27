import {
  IR_SCHEMA_VERSION,
  type ColorChangeEvent,
  type Confidence,
  type ObjectInfo,
  type RetractionEvent,
  type ToolInfo,
  type ToolpathIR,
  type ToolpathIRHeader,
  type ToolpathLayer,
  type ToolpathSegments,
  type Units,
  type Vec3,
  type Warning
} from './ir.js';
import { computeSegmentBounds } from './bounds.js';
import { classifyModelBounds } from './classify.js';
import { buildSourceIndex } from './source-index.js';

/** One motion segment in absolute model coordinates. The builder stores it as a delta from the origin. */
export interface SegmentInput {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  /** Extrusion delta; omit or 0 for travel. */
  e?: number;
  /** mm/min; omit when unknown (stored as NaN). */
  feedrate?: number;
  /** MoveKind bitflags. */
  kind: number;
  tool?: number;
  layer: number;
  feature?: number;
  /** Object index + 1; 0/omitted = none. */
  object?: number;
  srcByte: number;
}

export interface BuilderOptions {
  parserVersion?: string;
  units?: Units;
  unitsSource?: Confidence;
  source?: { id?: string; byteLength?: number; sha256?: string };
  /** Fixed floating-origin reference; defaults to the first segment's start point. */
  originOffset?: Vec3;
}

/**
 * Accumulates segments and produces a canonical {@link ToolpathIR}.
 *
 * The builder accumulates into plain number arrays and converts to typed arrays in
 * {@link ToolpathIRBuilder.finalize}. The *canonical* IR it returns is already the compact,
 * transferable typed-array contract from DD-001; E2 (the worker parser) will additionally
 * write directly into growable typed buffers to avoid the intermediate arrays.
 */
export class ToolpathIRBuilder {
  private readonly opts: BuilderOptions;
  private originOffset: Vec3 | null;

  private readonly x0: number[] = [];
  private readonly y0: number[] = [];
  private readonly z0: number[] = [];
  private readonly x1: number[] = [];
  private readonly y1: number[] = [];
  private readonly z1: number[] = [];
  private readonly e: number[] = [];
  private readonly feedrate: number[] = [];
  private readonly kind: number[] = [];
  private readonly tool: number[] = [];
  private readonly layer: number[] = [];
  private readonly feature: number[] = [];
  private readonly object: number[] = [];
  private readonly srcByte: number[] = [];

  private readonly toolsMap = new Map<number, ToolInfo>();
  private readonly objectsList: ObjectInfo[] = [];
  private readonly retractionsList: RetractionEvent[] = [];
  private readonly colorChangesList: ColorChangeEvent[] = [];
  private readonly warnings: Warning[] = [];
  private readonly capabilities: Record<string, Confidence> = {};

  constructor(opts: BuilderOptions = {}) {
    this.opts = opts;
    this.originOffset = opts.originOffset ?? null;
  }

  addSegment(s: SegmentInput): void {
    if (this.originOffset === null) {
      this.originOffset = { x: s.x0, y: s.y0, z: s.z0 };
    }
    const o = this.originOffset;
    this.x0.push(s.x0 - o.x);
    this.y0.push(s.y0 - o.y);
    this.z0.push(s.z0 - o.z);
    this.x1.push(s.x1 - o.x);
    this.y1.push(s.y1 - o.y);
    this.z1.push(s.z1 - o.z);
    this.e.push(s.e ?? 0);
    this.feedrate.push(s.feedrate ?? NaN);
    this.kind.push(s.kind);
    this.tool.push(s.tool ?? 0);
    this.layer.push(s.layer);
    this.feature.push(s.feature ?? 0);
    this.object.push(s.object ?? 0);
    this.srcByte.push(s.srcByte);
    if (s.tool !== undefined && !this.toolsMap.has(s.tool)) {
      this.toolsMap.set(s.tool, { id: s.tool });
    }
  }

  /** Record a retraction/unretraction event (DD-009 D1, #148). Position is absolute; stored origin-relative. */
  addRetraction(r: {
    x: number;
    y: number;
    z: number;
    kind: 'retract' | 'unretract';
    srcByte: number;
    segIndex: number;
  }): void {
    const o = this.originOffset ?? { x: 0, y: 0, z: 0 };
    this.retractionsList.push({
      x: r.x - o.x,
      y: r.y - o.y,
      z: r.z - o.z,
      kind: r.kind,
      srcByte: r.srcByte,
      segIndex: r.segIndex
    });
  }

  /** Record an M600 color-change boundary (DD-009 D2, #147). Position is absolute; stored origin-relative. */
  addColorChange(c: { x: number; y: number; z: number; segIndex: number; srcByte: number; tool: number }): void {
    const o = this.originOffset ?? { x: 0, y: 0, z: 0 };
    this.colorChangesList.push({
      x: c.x - o.x,
      y: c.y - o.y,
      z: c.z - o.z,
      segIndex: c.segIndex,
      srcByte: c.srcByte,
      tool: c.tool
    });
  }

  addWarning(w: Warning): void {
    this.warnings.push(w);
  }

  setCapability(name: string, confidence: Confidence): void {
    this.capabilities[name] = confidence;
  }

  setTool(info: ToolInfo): void {
    this.toolsMap.set(info.id, info);
  }

  /** Register an object; returns its 1-based index for use in `SegmentInput.object`. */
  addObject(info: ObjectInfo): number {
    this.objectsList.push(info);
    return this.objectsList.length;
  }

  finalize(): ToolpathIR {
    const count = this.x0.length;
    const segments: ToolpathSegments = {
      count,
      x0: Float32Array.from(this.x0),
      y0: Float32Array.from(this.y0),
      z0: Float32Array.from(this.z0),
      x1: Float32Array.from(this.x1),
      y1: Float32Array.from(this.y1),
      z1: Float32Array.from(this.z1),
      e: Float32Array.from(this.e),
      feedrate: Float32Array.from(this.feedrate),
      kind: Uint8Array.from(this.kind),
      tool: Uint16Array.from(this.tool),
      layer: Uint32Array.from(this.layer),
      feature: Uint8Array.from(this.feature),
      object: Uint32Array.from(this.object),
      srcByte: Uint32Array.from(this.srcByte)
    };
    const origin = this.originOffset ?? { x: 0, y: 0, z: 0 };
    const layers = deriveLayers(segments, origin.z);
    const { bounds, boundsWithTravel, objectBounds } = computeSegmentBounds(segments, origin);
    const { modelBounds, classification } = classifyModelBounds(segments, origin);
    const sourceIndex = buildSourceIndex(segments.srcByte, count);
    // Honest at build time from whatever channels exist; the dialect runner refreshes both after
    // annotation settles the object/feature channels (DD-026 D5, lifecycle §5).
    this.capabilities.nonModelClassification = classification;

    const header: ToolpathIRHeader = {
      irSchemaVersion: IR_SCHEMA_VERSION,
      parserVersion: this.opts.parserVersion ?? 'unknown',
      source: {
        id: this.opts.source?.id,
        byteLength: this.opts.source?.byteLength ?? 0,
        sha256: this.opts.source?.sha256
      },
      units: this.opts.units ?? 'mm',
      unitsSource: this.opts.unitsSource ?? 'unavailable',
      originOffset: origin,
      complete: true,
      dialects: [],
      warnings: this.warnings,
      capabilities: this.capabilities
    };

    const tools = [...this.toolsMap.values()].sort((a, b) => a.id - b.id);
    return {
      header,
      segments,
      layers,
      tools,
      objects: this.objectsList,
      retractions: this.retractionsList,
      colorChanges: this.colorChangesList,
      bounds,
      boundsWithTravel,
      objectBounds,
      modelBounds,
      sourceIndex
    };
  }
}

/** Group segments into layers by their `layer` index; layer Z is absolute. Assumes dense layer indices. */
function deriveLayers(seg: ToolpathSegments, originZ: number): ToolpathLayer[] {
  const byIndex = new Map<number, ToolpathLayer>();
  for (let i = 0; i < seg.count; i++) {
    const li = seg.layer[i];
    const existing = byIndex.get(li);
    if (existing === undefined) {
      byIndex.set(li, { z: originZ + seg.z1[i], segStart: i, segEnd: i });
    } else {
      existing.segEnd = i;
    }
  }
  return [...byIndex.keys()].sort((a, b) => a - b).map((k) => byIndex.get(k) as ToolpathLayer);
}
