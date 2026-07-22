/**
 * @chestnutlabs/gcode-parser — worker-safe G-code parse core (DD-003).
 *
 * Phase 1 (issue #44): the pure parse core. Worker glue (GcodeParseSession,
 * protocol v1) lands in phase 2 (#45); streaming inputs and full limit wiring
 * in phase 3 (#46). Depends only on @chestnutlabs/toolpath-core.
 */
export { parseGcodeToIR, DEFAULT_LIMITS } from './parse';
export type { ParseLimits, ParseOptions, ParseResult, ParseStats, StopReason } from './parse';
export { BudgetExceededError } from './growable';
