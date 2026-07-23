/**
 * @chestnutlabs/gcode-dialects — dialect adapter contracts & registry (DD-005).
 *
 * Phase 1 (#73): behavioral contracts, buffered annotation sink, and the
 * composition runner. Built-in vendor adapters arrive in phases 3–5.
 * Depends only on @chestnutlabs/toolpath-core; the parser consumes the runner
 * through its own structural DialectRunnerFactory type (worker entries compose
 * the two — DD-002 §5 boundaries).
 */
export type { DialectAdapter, DetectInput, AnnotationSink, CommandEvent } from './contracts.js';
export { createDialectRunner } from './registry.js';
export type { DialectRunnerFactory, DialectRun, DialectRunInput, DialectRunResult } from './registry.js';
export { BufferedAnnotationSink } from './sink.js';
export { prusaSlicer } from './prusaslicer.js';
export { orcaBambu } from './orca-bambu.js';
export {
  segAtOrAfterByte,
  applyMarkerRanges,
  parseKeyValue,
  parseAreaPoints,
  bedFromPoints,
  decodeBase64,
  ThumbnailCollector
} from './annotate.js';
export type { RangeMarker } from './annotate.js';
