/**
 * Resource limits for untrusted source models (DD-018 §7). Source bytes are untrusted input; nothing
 * is executed. Bounds are checked before large allocations so a hostile file fails cleanly.
 */
export interface ModelLimits {
  /** Max triangles across the whole scene. Default 5,000,000. */
  maxTriangles?: number;
  /** Max `<object>` elements in a 3MF, across the main and external parts (`E_MODEL_TOO_MANY_OBJECTS`). Default 10,000. */
  maxObjects?: number;
  /** Max source bytes accepted before parsing. Default 256 MiB. */
  maxSourceBytes?: number;
  /**
   * Max total instance placements across the scene (DD-022): a source 3MF that reuses meshes via
   * production-extension components / repeated build items is bounded on placement count, so an "instance
   * bomb" (a tiny master referenced millions of times) is rejected cheaply from the structure — before any
   * large geometry part is decompressed. Every node visited in the component graph also counts, so a fan-out DAG
   * is bounded too. Default 50,000.
   */
  maxInstances?: number;
}

export interface ResolvedLimits {
  maxTriangles: number;
  maxObjects: number;
  maxSourceBytes: number;
  maxInstances: number;
}

export const DEFAULT_LIMITS: ResolvedLimits = {
  maxTriangles: 5_000_000,
  maxObjects: 10_000,
  maxSourceBytes: 256 * 1024 * 1024,
  maxInstances: 50_000
};

/**
 * A present limit must be a non-negative integer (`0` is valid and rejects any source that has the thing
 * being counted). `NaN`/`Infinity`/negative/fractional would silently disable or invert the bound, so they
 * throw `E_MODEL_OPTION` (the E_CONTAINER_OPTION / E_PARSE_OPTION shape). `undefined`/`null` keep the default.
 */
function limitOrDefault(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ModelParseError('E_MODEL_OPTION', `${name} must be a non-negative integer (got ${String(value)})`);
  }
  return value;
}

export function resolveLimits(limits?: ModelLimits): ResolvedLimits {
  return {
    maxTriangles: limitOrDefault('maxTriangles', limits?.maxTriangles, DEFAULT_LIMITS.maxTriangles),
    maxObjects: limitOrDefault('maxObjects', limits?.maxObjects, DEFAULT_LIMITS.maxObjects),
    maxSourceBytes: limitOrDefault('maxSourceBytes', limits?.maxSourceBytes, DEFAULT_LIMITS.maxSourceBytes),
    maxInstances: limitOrDefault('maxInstances', limits?.maxInstances, DEFAULT_LIMITS.maxInstances)
  };
}

/** A bounded, structured model-parse failure (DD-018 §6). */
export class ModelParseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ModelParseError';
    this.code = code;
  }
}
