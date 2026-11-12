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
import type { BuildVolumeDef, GLRendererLike, RenderTargetCanvas, Theme } from '@chestnutlabs/gcode-renderer-three';
import { ModelRenderer, checkModelFov, type ModelBackground, type PresentationView } from './model-renderer.js';
import { isModelScene, resolveModelScene } from './loaders.js';
import { assertFiniteBounds } from './finite.js';
import {
  applyRenderScope,
  sceneInstanceCount,
  type ModelPlateSummary,
  type ModelScene,
  type RenderScope
} from './scene-model.js';
import { computeCacheKey } from './cache-key.js';
import type { ModelPlacement, PlacementOffset } from './placement.js';
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
  /**
   * Render only a subset of a multi-plate / multi-object source (DD-030 D2) — e.g. `{ plateId: 3 }` to
   * render just plate 3 of a project, framed to that plate. Omit to render the whole project (default).
   * `{ plateId }` is meaningful only when the source declares plates (`plates: 'known'`); on a source
   * without plate structure it matches nothing and renders empty (the honest result).
   */
  renderScope?: RenderScope;
  /**
   * Draw a build plate under the model (DD-032 §4.3) — the full `BuildVolumeDef` (shape, `min`,
   * excluded regions), so a saved thumbnail matches the live viewer. Omit for no plate (today's render).
   * Where the part sits on it is decided honestly: see `ModelPreviewState.placement`.
   */
  buildVolume?: BuildVolumeDef;
  /**
   * Plate/backdrop look (DD-032), e.g. `studioTheme('dark')`. Only the plate and backdrop fields apply;
   * lights and `materialPreset` are deliberately not (the model rig is unchanged). `theme.background` beats
   * `background` (an explicit `null` omits it, falling through to `background`).
   */
  theme?: Theme;
  /** Perspective lens in degrees, [10, 120] (default 50); framing is lens-aware. Throws `RangeError` outside it. */
  cameraFov?: number;
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
  /**
   * Declared plate structure (DD-025), present only when the source explicitly declares plates
   * (`capabilities.plates === 'known'`); absent for a single/plate-less source. `active` is the source's
   * declared active plate id when present.
   */
  plates?: { list: ModelPlateSummary[]; active?: number };
  /** How the plate placement was decided (DD-032); `null` when no plate was drawn. See `ModelPlacement`. */
  placement: ModelPlacement | null;
  /** The presentation offset applied to the model, mm (printer axes), or `null` when no plate was drawn. */
  placementOffset: PlacementOffset | null;
  /** Stable identity for caching: `hash(source) + options + envId`. */
  cacheKey: string;
}

async function toScene(
  source: ModelSource,
  limits?: ModelLimits,
  filamentPalette?: readonly (string | undefined)[]
): Promise<{ scene: ModelScene; sourceBytes: Uint8Array }> {
  if (isModelScene(source)) {
    assertFiniteBounds(source.bounds, 'ModelScene');
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
/** Counter that makes an opaque `instanceFilter` scope's cache key unique (never a false cache hit). */
let scopeKeyCounter = 0;

/** A stable, serializable cache-key fragment for a render scope (DD-030 D2). */
function scopeCacheKey(scope?: RenderScope): unknown {
  if (!scope) return undefined;
  if ('plateId' in scope) return { p: scope.plateId };
  if ('objectIds' in scope) return { o: [...scope.objectIds].sort() };
  return { fn: ++scopeKeyCounter }; // opaque predicate → non-cacheable, unique each call
}

/**
 * Cache-key fragment for a theme. A bed texture (an `ImageBitmap`/canvas) cannot be serialised, so a textured
 * theme is non-cacheable — unique each call, never a false cache hit — like an opaque `instanceFilter`.
 */
function themeCacheKey(theme?: Theme): unknown {
  if (!theme) return undefined;
  if (theme.bedSurface?.texture !== undefined) return { tex: ++scopeKeyCounter };
  return theme;
}

export async function renderModelStill(
  source: ModelSource,
  options: RenderModelStillOptions
): Promise<RenderModelStillResult> {
  const { canvas } = options;
  const width = options.width ?? canvas.width;
  const height = options.height ?? canvas.height;
  const background: ModelBackground = options.background ?? 'transparent';
  const view: PresentationView = options.view ?? 'iso';
  if (options.cameraFov !== undefined) checkModelFov(options.cameraFov); // before any work, like every option error

  const { scene: fullScene, sourceBytes } = await toScene(source, options.limits, options.filamentPalette);
  // DD-030 D2: narrow to the requested plate/object subset (framing follows the filtered bounds).
  const scene = options.renderScope ? applyRenderScope(fullScene, options.renderScope) : fullScene;

  const renderer = new ModelRenderer({
    canvas,
    background,
    ...(options.createRenderer ? { createRenderer: options.createRenderer } : {}),
    ...(options.buildVolume ? { buildVolume: options.buildVolume } : {}),
    ...(options.theme ? { theme: options.theme } : {}),
    ...(options.cameraFov !== undefined ? { cameraFov: options.cameraFov } : {}),
    preserveDrawingBuffer: true
  });
  try {
    renderer.resize(width, height);
    renderer.setScene(scene, { full: fullScene, scope: options.renderScope ?? null });
    renderer.render();

    const optionsJson = JSON.stringify({
      width,
      height,
      background,
      view,
      palette: options.filamentPalette,
      // Fold the scope so plate-1 and plate-2 thumbnails key distinctly. An opaque `instanceFilter` can't
      // be serialized — such a still is marked non-cacheable (consumers should not reuse it by key).
      scope: scopeCacheKey(options.renderScope),
      // The plate, the theme and the lens change the pixels, so they key the cache; absent ⇒ the key is
      // unchanged from before DD-032 (JSON.stringify drops undefined).
      plate: options.buildVolume ?? undefined,
      theme: themeCacheKey(options.theme),
      fov: options.cameraFov
    });
    const cacheKey = computeCacheKey(sourceBytes, optionsJson, options.envId);
    return {
      canvas,
      width,
      height,
      objectCount: scene.objects.length,
      materials: scene.capabilities.materials,
      instancedCount: sceneInstanceCount(scene),
      decimationApplied: 1,
      ...(scene.plates !== undefined ? { plates: scene.plates } : {}),
      placement: renderer.placement.placement,
      placementOffset: renderer.placement.placementOffset,
      cacheKey
    };
  } finally {
    renderer.dispose();
  }
}
