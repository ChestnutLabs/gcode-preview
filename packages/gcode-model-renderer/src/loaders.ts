/**
 * The generic model-source seam (DD-021 §4.1) — a loader registry keyed by an **open** `kind` string,
 * so the public input is a generic model source rather than an `STL | 3MF` union. New formats
 * (OBJ/STEP/PLY/…) become viewable by registering a {@link ModelLoader}, with no change to the viewer
 * or still-render signatures.
 *
 * v1 registers `stlLoader` (`kind:'stl'`) and `threeMfLoader` (`kind:'3mf'`). Both `renderModelStill`
 * (DD-018) and `createModelViewer` (DD-021) resolve their source through this one registry.
 */
import { parseStl } from './stl.js';
import { parse3mf } from './three-mf.js';
import { ModelParseError, type ModelLimits } from './limits.js';
import type { ModelScene } from './scene-model.js';

/**
 * Format-agnostic parse options carried through the registry. A loader that has no use for a field
 * ignores it; the bag stays generic so registering a new `kind` never widens the public seam.
 */
export interface ModelLoadOptions {
  /**
   * 3MF `paint_color` palette override (hex `#RRGGBB` per 0-based slot), instead of the file's own
   * `project_settings.config`. Ignored by loaders that don't consume it (e.g. STL).
   */
  filamentPalette?: readonly (string | undefined)[];
}

/** A loader turns source bytes of one `kind` into the neutral {@link ModelScene} (DD-018 §4.1). */
export interface ModelLoader {
  /** `'stl' | '3mf' | (future) 'obj' | 'step' | 'ply' | …` — an open string, not a closed union. */
  readonly kind: string;
  parse(bytes: Uint8Array, limits?: ModelLimits, opts?: ModelLoadOptions): ModelScene | Promise<ModelScene>;
}

/**
 * The viewer/still input: raw bytes tagged by an open `kind`, or an already-built {@link ModelScene}.
 * `kind` is NOT an STL|3MF union — new formats register a {@link ModelLoader}.
 */
export type ModelSourceInput = { kind: string; bytes: Uint8Array | ArrayBuffer } | ModelScene;

/** STL loader (binary + ASCII); no colour/structure, so the honest single-object, no-material case. */
export const stlLoader: ModelLoader = {
  kind: 'stl',
  parse: (bytes, limits) => parseStl(bytes, limits)
};

/** 3MF loader — multi-object/material incl. production `paint_color` multicolor (RR-005). */
export const threeMfLoader: ModelLoader = {
  kind: '3mf',
  parse: (bytes, limits, opts) =>
    parse3mf(bytes, limits, opts?.filamentPalette ? { filamentPalette: opts.filamentPalette } : undefined)
};

/** The v1 default registry: STL + 3MF. */
export const DEFAULT_MODEL_LOADERS: readonly ModelLoader[] = [stlLoader, threeMfLoader];

/** True for a pre-built {@link ModelScene} input (has `objects`, carries no `kind` tag). */
export function isModelScene(input: ModelSourceInput): input is ModelScene {
  return (input as ModelScene).objects !== undefined && (input as { kind?: string }).kind === undefined;
}

/**
 * Resolve any {@link ModelSourceInput} to a {@link ModelScene} through the registry: a pre-built scene
 * passes through; a `{kind, bytes}` input dispatches to the matching loader. Throws
 * {@link ModelParseError} `E_MODEL_UNSUPPORTED_KIND` when no loader is registered for the `kind` (DD §6).
 */
export async function resolveModelScene(
  input: ModelSourceInput,
  loaders: readonly ModelLoader[] = DEFAULT_MODEL_LOADERS,
  limits?: ModelLimits,
  opts?: ModelLoadOptions
): Promise<ModelScene> {
  if (isModelScene(input)) return input;
  const loader = loaders.find((l) => l.kind === input.kind);
  if (loader === undefined) {
    throw new ModelParseError('E_MODEL_UNSUPPORTED_KIND', `no model loader registered for kind '${input.kind}'`);
  }
  const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
  return loader.parse(bytes, limits, opts);
}
