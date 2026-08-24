/**
 * Resource limits for untrusted source models (DD-018 §7). Source bytes are untrusted input; nothing
 * is executed. Bounds are checked before large allocations so a hostile file fails cleanly.
 */
export interface ModelLimits {
  /** Max triangles across the whole scene. Default 5,000,000. */
  maxTriangles?: number;
  /** Max objects in a scene (3MF). Default 10,000. */
  maxObjects?: number;
  /** Max source bytes accepted before parsing. Default 256 MiB. */
  maxSourceBytes?: number;
}

export interface ResolvedLimits {
  maxTriangles: number;
  maxObjects: number;
  maxSourceBytes: number;
}

export const DEFAULT_LIMITS: ResolvedLimits = {
  maxTriangles: 5_000_000,
  maxObjects: 10_000,
  maxSourceBytes: 256 * 1024 * 1024
};

export function resolveLimits(limits?: ModelLimits): ResolvedLimits {
  return {
    maxTriangles: limits?.maxTriangles ?? DEFAULT_LIMITS.maxTriangles,
    maxObjects: limits?.maxObjects ?? DEFAULT_LIMITS.maxObjects,
    maxSourceBytes: limits?.maxSourceBytes ?? DEFAULT_LIMITS.maxSourceBytes
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
