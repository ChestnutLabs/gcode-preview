/**
 * `renderModelStill` (DD-018 §4.3) — the headless presentation-thumbnail preset, mirroring
 * `renderStill` on the toolpath side. Parse a source model → build a {@link ModelScene} → render one
 * deterministic frame → return the canvas + a stable cache key. The caller extracts pixels in its own
 * environment (`OffscreenCanvas.convertToBlob`, `toDataURL`, `readPixels`).
 *
 * Environment: any Chromium-class WebGL2 context — an OffscreenCanvas in a Worker, or headless
 * Chromium via ANGLE→SwiftShader (the software-GL path). A windowed GLX/GLFW path is out of scope.
 *
 * Determinism: same input + same environment ⇒ identical output. Cross-GPU/driver pixel identity is
 * not promised; cache by the `cacheKey` on the returned {@link RenderModelStillResult}.
 */
import type { Confidence } from '@chestnutlabs/toolpath-core';
import type { GLRendererLike, RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';
import { ModelRenderer, type ModelBackground, type PresentationView } from './model-renderer.js';
import { isModelScene, resolveModelScene } from './loaders.js';
import { sceneInstanceCount, type ModelScene } from './scene-model.js';
import { computeCacheKey } from './cache-key.js';
import type { ModelLimits } from './limits.js';

/**
 * A source model: STL bytes, 3MF bytes, or a pre-built `ModelScene`. This concrete union is the
 * backward-compatible still-render input; it flows through the shared open-`kind` loader registry
 * (`ModelSourceInput`, DD-021 §4.1), so any registered `kind` is also accepted.
 */
export type ModelSource =
  | { kind: 'stl'; bytes: Uint8Array | ArrayBuffer }
  | { kind: '3mf'; bytes: Uint8Array | ArrayBuffer }
  | ModelScene;

export interface RenderModelStillOptions {
  canvas: RenderTargetCanvas;
  width?: number;
  height?: number;
  /** Background: `'transparent'` (default — composite on a card) or a solid CSS color / 0xRRGGBB. */
  background?: ModelBackground;
  /** Preset angle; default `'iso'`. */
  view?: PresentationView;
  createRenderer?: (canvas: RenderTargetCanvas) => GLRendererLike;
  limits?: ModelLimits;
  /**
   * Override the 3MF source-model filament palette (hex `#RRGGBB` per 0-based slot) used to colour
   * `paint_color` facets, instead of the file's own `project_settings.config`. Niche: for consumers
   * re-rendering a file with a corrected/richer palette. Ignored for STL and pre-built scenes.
   */
  filamentPalette?: readonly (string | undefined)[];
  /** Override the environment id folded into the cache key (default: the `three` revision). */
  envId?: string;
}

export interface RenderModelStillResult {
  canvas: RenderTargetCanvas;
  width: number;
  height: number;
  objectCount: number;
  /** Whether source colors/materials were real — `'unavailable'` means the neutral default was used. */
  materials: Confidence;
  /**
   * Total instance placements drawn (DD-022): > `objectCount` when the source reused geometry (a
   * full-sheet plate of repeated copies), for an "N copies" badge. 1 per object when nothing is reused.
   */
  instancedCount: number;
  /**
   * Every-Nth-triangle decimation applied to fit the LOD budget (1 = none, layer/geometry detail full).
   * Field-parallel to the toolpath `RenderStillResult.decimationApplied` so a card badges "simplified for
   * size" the same way. Always 1 until model LOD lands (DD-022 Phase 2); reserved so the field is stable.
   */
  decimationApplied: number;
  /** Stable identity for caching: `hash(source) + options + envId`. */
  cacheKey: string;
}

async function toScene(
  source: ModelSource,
  limits?: ModelLimits,
  filamentPalette?: readonly (string | undefined)[]
): Promise<{ scene: ModelScene; sourceBytes: Uint8Array }> {
  if (isModelScene(source)) {
    // No raw bytes for a pre-built scene: key off a stable structural summary instead.
    const summary = JSON.stringify({ n: source.objects.length, b: source.bounds, c: source.capabilities });
    return { scene: source, sourceBytes: new TextEncoder().encode(summary) };
  }
  // Dispatch through the shared open-`kind` loader registry (DD-021 §4.1) — same parse result as before.
  const bytes = source.bytes instanceof Uint8Array ? source.bytes : new Uint8Array(source.bytes);
  const scene = await resolveModelScene(source, undefined, limits, filamentPalette ? { filamentPalette } : undefined);
  return { scene, sourceBytes: bytes };
}

/**
 * Render one presentation still. Async because the 3MF path unzips with the container reader
 * (`DecompressionStream`); the STL and pre-built-`ModelScene` paths resolve promptly. Mirrors the
 * async `renderStill` on the toolpath side.
 */
export async function renderModelStill(
  source: ModelSource,
  options: RenderModelStillOptions
): Promise<RenderModelStillResult> {
  const { canvas } = options;
  const width = options.width ?? canvas.width;
  const height = options.height ?? canvas.height;
  const background: ModelBackground = options.background ?? 'transparent';
  const view: PresentationView = options.view ?? 'iso';

  const { scene, sourceBytes } = await toScene(source, options.limits, options.filamentPalette);

  const renderer = new ModelRenderer({
    canvas,
    background,
    ...(options.createRenderer ? { createRenderer: options.createRenderer } : {}),
    preserveDrawingBuffer: true
  });
  try {
    renderer.resize(width, height);
    renderer.setScene(scene);
    renderer.render();

    const optionsJson = JSON.stringify({ width, height, background, view, palette: options.filamentPalette });
    const cacheKey = computeCacheKey(sourceBytes, optionsJson, options.envId);
    return {
      canvas,
      width,
      height,
      objectCount: scene.objects.length,
      materials: scene.capabilities.materials,
      instancedCount: sceneInstanceCount(scene),
      decimationApplied: 1,
      cacheKey
    };
  } finally {
    renderer.dispose();
  }
}
