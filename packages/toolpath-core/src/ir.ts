/**
 * ToolpathIR — the neutral, versioned intermediate representation (DD-001).
 *
 * The canonical IR is plain, transferable data: a small metadata header plus
 * structure-of-arrays (SoA) typed buffers. No class instances, DOM, `three`,
 * Vue, or consumer (AnyBridge) types appear here. Positions are `Float32`
 * deltas relative to a `Float64` `originOffset` (floating origin, DD-001 §4.6).
 */

/** Bump on any breaking layout/semantic change. Separate from the package version. */
export const IR_SCHEMA_VERSION = 1;

/** Confidence of an optional/derived datum. `unavailable` is a valid state — never a fabricated 0. */
export type Confidence = 'known' | 'inferred' | 'approximated' | 'unavailable';

export type Units = 'mm' | 'in';
export type Severity = 'info' | 'warn' | 'error';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Bitflags stored in `ToolpathSegments.kind`. */
export const MoveKind = {
  None: 0,
  Extrude: 1 << 0,
  Travel: 1 << 1,
  Retract: 1 << 2,
  Unretract: 1 << 3,
  Wipe: 1 << 4,
  ArcSegment: 1 << 5,
  Seam: 1 << 6,
  /** Tool-engaged productive move (cut / burn / draw) when no extrusion E is present —
   *  a CNC/laser/plotter counterpart to `Extrude` (DD-012 D2). Set by the parser only when a
   *  tool-state modal (spindle/laser on) holds and the move has no E delta, so an FDM slice
   *  never sets it. Composes with `ArcSegment` like the other kinds. */
  Cut: 1 << 7
} as const;
export type MoveKindName = keyof typeof MoveKind;

/** Feature-role indices stored in `ToolpathSegments.feature` (0 = unknown). */
export const FeatureRole = {
  Unknown: 0,
  Perimeter: 1,
  ExternalPerimeter: 2,
  Infill: 3,
  SolidInfill: 4,
  Support: 5,
  Skirt: 6,
  Brim: 7,
  Bridge: 8,
  Travel: 9,
  Custom: 10
} as const;
export type FeatureRoleName = keyof typeof FeatureRole;

export interface Warning {
  code: string;
  message: string;
  severity: Severity;
  srcByte?: number;
  count?: number;
}

export interface DialectDecision {
  id: string;
  version?: string;
  confidence: Confidence;
}

export interface ToolpathIRHeader {
  irSchemaVersion: number;
  parserVersion: string;
  source: { id?: string; byteLength: number; sha256?: string };
  units: Units;
  unitsSource: Confidence;
  /** Float64 reference point; segment positions are Float32 deltas from this (DD-001 §4.6). */
  originOffset: Vec3;
  complete: boolean;
  truncatedAtByte?: number;
  dialects: DialectDecision[];
  warnings: Warning[];
  /** Per-field confidence summary, e.g. { featureRoles: 'unavailable', units: 'known' }. */
  capabilities: Record<string, Confidence>;
}

/**
 * Ordered motion segments as parallel typed arrays of length `count`.
 * Positions are Float32 deltas relative to `ToolpathIRHeader.originOffset`.
 * Optional channels use sentinels: `feedrate` NaN = unknown; `feature`/`object` 0 = unknown/none.
 */
export interface ToolpathSegments {
  count: number;
  x0: Float32Array;
  y0: Float32Array;
  z0: Float32Array;
  x1: Float32Array;
  y1: Float32Array;
  z1: Float32Array;
  /** Extrusion delta for the segment (0 for travel). */
  e: Float32Array;
  /** mm/min; NaN when unknown. */
  feedrate: Float32Array;
  /** MoveKind bitflags. */
  kind: Uint8Array;
  /** Index into `tools`. */
  tool: Uint16Array;
  /** Index into `layers`. */
  layer: Uint32Array;
  /** FeatureRole index; 0 = unknown. */
  feature: Uint8Array;
  /** Index into `objects` + 1; 0 = none/unknown. */
  object: Uint32Array;
  /** Byte offset in the source of the command that produced this segment. */
  srcByte: Uint32Array;
  /** Opt-in modal channels (DD-012 D3), keyed by channel id — present only when the parse was asked
   *  to capture them (`ParseOptions.modalChannels`). Each is a Float32 column of length `count`; an
   *  unset value is `NaN` (an honest "no value here"), never a fabricated 0. E.g. `modal.toolPower`
   *  is the spindle/laser `S` value while a tool is engaged. FDM parses carry no `modal`. */
  modal?: Readonly<Record<string, Float32Array>>;
}

export interface ToolpathLayer {
  /** Absolute Z of the layer. */
  z: number;
  segStart: number;
  segEnd: number;
}

export interface ToolInfo {
  id: number;
  color?: RGBA;
  material?: string;
}

export interface ObjectInfo {
  id: string;
  name?: string;
}

/**
 * A filament retraction (`retract`) or its reversal (`unretract`) — an E-only move
 * with no XYZ travel, so it has a *position* but no segment in the main stream
 * (DD-009 D1 amendment, #148). Kept in a sparse side channel so segment indices,
 * scrub, and layer ranges are untouched. `segIndex` is the index of the next
 * segment emitted after the event, for layer/scrub-aligned marker clipping.
 */
export interface RetractionEvent {
  /** Position (same frame as segments: origin-relative). */
  x: number;
  y: number;
  z: number;
  kind: 'retract' | 'unretract';
  /** Byte offset in the source for scrub/telemetry alignment. */
  srcByte: number;
  /** Segment index at the moment of the event (draw-range clip alignment). */
  segIndex: number;
}

/**
 * A manual filament-swap color boundary (`M600`) — a marker with a *position* but
 * no motion segment (DD-009 D2 amendment, #147). Like {@link RetractionEvent} it is
 * kept in a sparse side channel so segment indices, scrub, and layer ranges are
 * untouched. The renderer's `colorChange` color mode shades segments by *swap slot*
 * (the count of color changes at or before a segment), NOT by the `tool` channel.
 */
export interface ColorChangeEvent {
  /** Position (same frame as segments: origin-relative). */
  x: number;
  y: number;
  z: number;
  /** Index of the first segment emitted after the swap (slot boundary + marker clip). */
  segIndex: number;
  /** Byte offset in the source for scrub/telemetry alignment. */
  srcByte: number;
  /** Tool active at the swap — provenance only; not used to pick the swap color. */
  tool: number;
}

export interface ToolpathBounds {
  min: Vec3;
  max: Vec3;
}

/** Sorted parallel arrays enabling `byteOffset -> segmentIndex` via binary search (E5/DD-006 input). */
export interface SourceIndex {
  byteOffsets: Uint32Array;
  segmentIndices: Uint32Array;
}

export interface ToolpathIR {
  header: ToolpathIRHeader;
  segments: ToolpathSegments;
  layers: ToolpathLayer[];
  tools: ToolInfo[];
  objects: ObjectInfo[];
  /** Sparse retraction/unretraction events (DD-009 D1, #148); empty when none seen. */
  retractions: RetractionEvent[];
  /** Sparse M600 filament-swap color-change boundaries (DD-009 D2, #147); empty when none seen. */
  colorChanges: ColorChangeEvent[];
  /** Bounds over extruding moves only. */
  bounds: ToolpathBounds;
  /** Bounds including travel moves. */
  boundsWithTravel: ToolpathBounds;
  /**
   * Bounds over the extrusion of labeled objects (`segments.object != 0`) — excludes skirt/prime/purge
   * (which are `object 0`). Empty (Infinity/-Infinity) when the file carries no object labels. Used to
   * "frame the printed object, not the skirt" (#306/#6); a consumer checks it is finite before use.
   */
  objectBounds: ToolpathBounds;
  sourceIndex: SourceIndex;
}
