/**
 * The model viewer's build plate (DD-032 §4.3), shared by the interactive viewer and the headless still.
 * It reuses the renderer's `createBuildVolume` / `volumeStyle` / `createContactShadow` / `disposeBuildVolume`
 * (nothing re-implemented) and adds only what is model-specific: deciding the placement, moving the model onto
 * the plate, sizing the contact shadow under the *presented* footprint, and the background precedence.
 *
 * Only the plate/backdrop part of a `Theme` is honoured here. Lights and `materialPreset` are deliberately not
 * applicable: the model rig differs from the toolpath defaults, so applying a theme's replace semantics to it
 * would silently darken every model.
 */
import { Color, Group, type Scene } from 'three';
import {
  createBackdrop,
  createBuildVolume,
  createContactShadow,
  disposeBuildVolume,
  resolveTheme,
  volumeStyle,
  type Backdrop,
  type BuildVolumeDef,
  type ShadowFootprint,
  type Theme
} from '@chestnutlabs/gcode-renderer-three';
import type { ModelContent } from './model-content.js';
import type { ModelBackground } from './model-renderer.js';
import {
  NO_PLACEMENT,
  computePlacement,
  presentedBounds,
  type PlacementBed,
  type PlacementResult
} from './placement.js';
import type { ModelScene, RenderScope } from './scene-model.js';

/** The consumer's bed as a placement rectangle (a non-rectangular `shape` still places by its bounding box). */
export function bedOf(def: BuildVolumeDef | null): PlacementBed | null {
  if (def === null) return null;
  const x0 = def.min?.x ?? 0;
  const y0 = def.min?.y ?? 0;
  return { min: [x0, y0], max: [x0 + def.x, y0 + def.y] };
}

/**
 * Scene background by the DD-032 precedence (the capture override is the stage's, above all of these):
 * `theme.background` (solid or gradient) → the `background` option / `setBackground` (the fallback tier) →
 * transparent. A `null`/omitted theme background falls through. Returns the gradient backdrop it created (the
 * caller owns and disposes it), disposing `previous` first.
 */
export function applyModelBackground(
  scene: Scene,
  theme: Theme | undefined,
  fallback: ModelBackground,
  previous: Backdrop | null
): Backdrop | null {
  previous?.dispose();
  const b = theme?.background;
  if (b !== undefined && b !== null && typeof b === 'object') {
    const backdrop = createBackdrop(b);
    scene.background = backdrop.texture;
    return backdrop;
  }
  if (b !== undefined && b !== null) scene.background = new Color(b);
  else scene.background = fallback === 'transparent' ? null : new Color(fallback as string | number);
  return null;
}

/** True when nothing would paint the background (a transparent canvas). */
export function isTransparentBackground(theme: Theme | undefined, fallback: ModelBackground): boolean {
  const b = theme?.background;
  return (b === undefined || b === null) && fallback === 'transparent';
}

export class ModelPlate {
  private readonly root = new Group();
  private volume: Group | null = null;
  private result: PlacementResult = NO_PLACEMENT;
  private footprint: ShadowFootprint | null = null;
  private hiddenDepth = 0;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private def: BuildVolumeDef | null,
    private theme: Theme | undefined,
    /** Whether the wireframe cage is drawn (the plate, grid and shadow are independent of it). */
    private cageVisible = true
  ) {
    this.root.name = 'modelPlate';
    this.root.rotation.x = -Math.PI / 2; // printer Z-up → scene Y-up, as the model root
    scene.add(this.root);
  }

  /** The group holding the volume + shadow (null while no plate is drawn). Exposed for tests. */
  get volumeGroup(): Group | null {
    return this.volume;
  }

  getPlacement(): PlacementResult {
    return this.result;
  }

  setBuildVolume(def: BuildVolumeDef | null): void {
    this.def = def;
  }

  setTheme(theme: Theme | undefined): void {
    this.theme = theme;
  }

  /**
   * Show/hide the wireframe cage, in place (no rebuild, no re-placement). Remembered, so every later rebuild
   * (bed, theme, scope, context restore) honours it.
   */
  setCageVisible(visible: boolean): void {
    this.cageVisible = visible;
    const cage = this.volume?.getObjectByName('volumeCage');
    if (cage !== undefined) cage.visible = visible;
  }

  /**
   * Recompute the placement for what is shown, move the model onto the plate, and (re)build the plate and
   * its shadow. Call after `content.setScene`, and again whenever the bed, theme or scope changes.
   */
  update(
    content: ModelContent,
    full: ModelScene | null,
    shown: ModelScene | null,
    scope: RenderScope | null
  ): PlacementResult {
    this.result =
      full === null || shown === null ? NO_PLACEMENT : computePlacement(full, shown, scope, bedOf(this.def));
    content.setPresentationOffset(this.result.placementOffset);
    if (shown === null || this.result.placement === null) {
      this.footprint = null;
    } else {
      const b = presentedBounds(shown.bounds, this.result.placementOffset);
      this.footprint = { min: { x: b.min[0], y: b.min[1] }, max: { x: b.max[0], y: b.max[1] } };
    }
    this.rebuild();
    return this.result;
  }

  /** Free and recreate the plate (also the context-restore path: the old GPU resources are gone). */
  rebuild(): void {
    this.free();
    if (this.disposed || this.def === null || this.result.placement === null) return;
    const resolved = resolveTheme(this.theme);
    const volume = createBuildVolume(this.def, volumeStyle(resolved, this.cageVisible));
    if (resolved.contactShadow !== undefined) {
      const shadow = createContactShadow(this.footprint, resolved.contactShadow.opacity);
      if (shadow !== null) volume.add(shadow);
    }
    volume.visible = this.hiddenDepth === 0;
    this.root.add(volume);
    this.volume = volume;
  }

  /** Hide the plate (and its shadow) until the returned function is called — for a capture without it. */
  hide(): () => void {
    this.hiddenDepth++;
    if (this.volume !== null) this.volume.visible = false;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.hiddenDepth--;
      if (this.volume !== null) this.volume.visible = this.hiddenDepth === 0;
    };
  }

  private free(): void {
    if (this.volume === null) return;
    disposeBuildVolume(this.volume);
    this.root.remove(this.volume);
    this.volume = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.free();
    this.scene.remove(this.root);
  }
}
