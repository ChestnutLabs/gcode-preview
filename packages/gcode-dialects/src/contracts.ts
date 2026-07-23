/**
 * Dialect adapter behavioral contracts (DD-005 §4.1/§4.3, as amended).
 *
 * Adapters are ANNOTATORS: through the AnnotationSink they may write the
 * optional `feature`/`object` channels, result metadata, and capability
 * upgrades — the sink exposes no way to touch positions, kinds, layers, or
 * counts, and the geometry-invariance CI gate proves it stays that way.
 *
 * Data contracts (MachineGeometry, DialectMetadata, DialectDetection) live in
 * @chestnutlabs/toolpath-core (see its metadata.ts for the rationale).
 */
import type {
  Confidence,
  DialectDetection,
  MachineGeometry,
  FilamentInfo,
  ThumbnailData,
  ToolpathIR
} from '@chestnutlabs/toolpath-core';

/** Read-only normalized command event — mirror of the parser's hook payload. */
export interface CommandEvent {
  gcode: string;
  params: Readonly<Record<string, number>>;
  rawLine: string;
  srcByte: number;
  segIndex: number;
}

export interface DetectInput {
  /** First decoded window (≤ 64 KB). */
  headText: string;
  /** Last decoded window (≤ 16 KB); '' for non-seekable streams until finalize (§4.5). */
  tailText: string;
  /** Container metadata when the input came through gcode-containers (phase 2). */
  containerMeta?: Record<string, string>;
}

export interface AnnotationSink {
  /** Write a FeatureRole index for segments [segStart, segEnd] (bounds validated at apply). */
  setFeature(segStart: number, segEnd: number, role: number): void;
  /** `objectValue` is the 1-based object-channel value (DD-001: v indexes ir.objects[v-1]). */
  setObject(segStart: number, segEnd: number, objectValue: number): void;
  defineObject(objectValue: number, name: string): void;
  setMachine(machine: MachineGeometry): void;
  setFilament(info: FilamentInfo): void;
  /** Enrich a tool's identity (material, '#RRGGBB' color) — merged into ir.tools (DD-005 phase 5). */
  setToolInfo(tool: number, info: { material?: string; colorHex?: string }): void;
  addThumbnail(thumb: ThumbnailData): void;
  setRaw(key: string, value: string): void;
  upgradeCapability(key: string, confidence: Confidence): void;
  warn(code: string, message: string, srcByte?: number): void;
}

export interface DialectAdapter {
  id: string;
  displayName: string;
  /** 'slicer' and 'firmware' adapters COMPOSE (amendment 1); one winner per kind. */
  kind: 'slicer' | 'firmware' | 'generic';
  detect(input: DetectInput): DialectDetection | null;
  /** Per-adapter serializable configuration (validated by the adapter itself). */
  onComment?(comment: string, srcByte: number, sink: AnnotationSink, config?: unknown): void;
  onCommand?(event: CommandEvent, sink: AnnotationSink, config?: unknown): void;
  finalize?(ir: ToolpathIR, sink: AnnotationSink, config?: unknown): void;
}
