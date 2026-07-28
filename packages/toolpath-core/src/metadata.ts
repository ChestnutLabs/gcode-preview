/**
 * Dialect/machine metadata data contracts (DD-005 §4.2, as amended).
 *
 * Pure data types — no behavior. They live in toolpath-core (not
 * @chestnutlabs/gcode-dialects) because every layer consumes them as values:
 * the parser carries them beside the IR in ParseResult/protocol messages and
 * the renderer applies MachineGeometry as a build volume — neither may depend
 * on the dialects package (DD-002 §5 boundaries). The behavioral contracts
 * (DialectAdapter, AnnotationSink, registry) live in gcode-dialects.
 */
import type { Confidence } from './ir.js';

export interface Point2 {
  x: number;
  y: number;
}

/** A 2D region in printer coordinates (excluded areas etc.). */
export interface Region2 {
  kind: 'rect' | 'polygon';
  points: Point2[]; // rect: [min, max]
}

/**
 * Machine/bed geometry discovered from a file (DD-005 §4.2, amendment 2).
 * Never fabricated: absent means unknown, and consumers must not invent one.
 */
export interface MachineGeometry {
  bed:
    | { kind: 'rect'; min: Point2; max: Point2 }
    | { kind: 'circular'; center: Point2; diameter: number }
    | { kind: 'polygon'; points: Point2[] };
  /** Printer-coordinate origin location — explicit, not a convention flag. */
  origin: Point2;
  /** Regions the toolhead must avoid (Klipper excludes, Bambu excluded areas). */
  excludedRegions?: Region2[];
  heightMm?: number;
  printerName?: string;
  /** 'known' from container/config data; 'inferred' from slicer comments. */
  confidence: Confidence;
  /** Provenance: which adapter concluded this, from what evidence. */
  source: { adapterId: string; evidence: string; srcByte?: number };
}

/** A dialect detection decision with its evidence (DD-005 §4.1). */
export interface DialectDetection {
  dialectId: string;
  /** 'slicer' and 'firmware' adapters compose (amendment 1). */
  kind: 'slicer' | 'firmware' | 'generic';
  confidence: Confidence;
  evidence: string;
}

export interface FilamentInfo {
  slot: number;
  type?: string;
  color?: string;
  name?: string;
}

/**
 * Slicer-reported filament consumption (#183) — the "info panel" totals a slicer emits as G-code
 * comments. Absent when the slicer doesn't report it (capability-honest). Aggregate across extruders;
 * fields are independently optional (a slicer may report length but not weight).
 */
export interface FilamentUsage {
  /** Total filament length in millimetres. */
  lengthMm?: number;
  /** Total extruded volume in cm³. */
  volumeCm3?: number;
  /** Total filament weight in grams. */
  weightG?: number;
  source: { adapterId: string; evidence: string; srcByte?: number };
}

/**
 * The slicer's own print-time estimate (#183) — the trustworthy figure for a time readout / time
 * scrub, versus a kinematic estimate. Absent when the slicer doesn't emit it.
 */
export interface PrintEstimate {
  /** Estimated print duration in seconds. */
  seconds: number;
  /** Slicer mode label when given (e.g. PrusaSlicer 'normal' / 'silent'). */
  mode?: string;
  source: { adapterId: string; evidence: string; srcByte?: number };
}

export interface ThumbnailData {
  width: number;
  height: number;
  mime: string;
  bytes: Uint8Array;
}

/**
 * Optional result metadata riding beside the IR (DD-005 §4.2) — no IR schema
 * bump; structured-cloneable across the worker boundary (thumbnail bytes
 * transferable).
 */
export interface DialectMetadata {
  /** Every applied adapter (composition, amendment 1). */
  dialects?: DialectDetection[];
  machine?: MachineGeometry;
  filaments?: FilamentInfo[];
  /** Slicer-reported total filament consumption (#183); absent when not emitted. */
  filamentUsage?: FilamentUsage;
  /** The slicer's own print-time estimate (#183); absent when not emitted. */
  printEstimate?: PrintEstimate;
  thumbnails?: ThumbnailData[];
  /** Whitelisted key/value settings only — bounded, never local paths. */
  raw?: Record<string, string>;
}
