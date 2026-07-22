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
  Seam: 1 << 6
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
  /** Bounds over extruding moves only. */
  bounds: ToolpathBounds;
  /** Bounds including travel moves. */
  boundsWithTravel: ToolpathBounds;
  sourceIndex: SourceIndex;
}
