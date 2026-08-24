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
import { parseStl } from './stl.js';
import type { ModelScene } from './scene-model.js';
import { computeCacheKey } from './cache-key.js';
import type { ModelLimits } from './limits.js';

/** A source model. Phase 1: STL bytes, or a pre-built `ModelScene`. (3MF arrives in Phase 2.) */
export type ModelSource = { kind: 'stl'; bytes: Uint8Array | ArrayBuffer } | ModelScene;

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
  /** Stable identity for caching: `hash(source) + options + envId`. */
  cacheKey: string;
}

function isModelScene(s: ModelSource): s is ModelScene {
  return (s as ModelScene).objects !== undefined && (s as { kind?: string }).kind === undefined;
}

function toScene(source: ModelSource, limits?: ModelLimits): { scene: ModelScene; sourceBytes: Uint8Array } {
  if (isModelScene(source)) {
    // No raw bytes for a pre-built scene: key off a stable structural summary instead.
    const summary = JSON.stringify({ n: source.objects.length, b: source.bounds, c: source.capabilities });
    return { scene: source, sourceBytes: new TextEncoder().encode(summary) };
  }
  const bytes = source.bytes instanceof Uint8Array ? source.bytes : new Uint8Array(source.bytes);
  return { scene: parseStl(bytes, limits), sourceBytes: bytes };
}

export function renderModelStill(source: ModelSource, options: RenderModelStillOptions): RenderModelStillResult {
  const { canvas } = options;
  const width = options.width ?? canvas.width;
  const height = options.height ?? canvas.height;
  const background: ModelBackground = options.background ?? 'transparent';
  const view: PresentationView = options.view ?? 'iso';

  const { scene, sourceBytes } = toScene(source, options.limits);

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

    const optionsJson = JSON.stringify({ width, height, background, view });
    const cacheKey = computeCacheKey(sourceBytes, optionsJson, options.envId);
    return {
      canvas,
      width,
      height,
      objectCount: scene.objects.length,
      materials: scene.capabilities.materials,
      cacheKey
    };
  } finally {
    renderer.dispose();
  }
}
