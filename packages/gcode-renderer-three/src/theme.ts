/**
 * Bounded declarative theming (DD-009 D4, #153).
 *
 * A small, stable surface for the scene's *presentation* — background, grid/bed
 * colors, light intensities, and a named material preset — deliberately NOT raw
 * three, so it stays valid across three upgrades. Deep customization keeps using
 * the `createRenderer` injectable / `raw.renderer()` escape hatches.
 *
 * The public types are three-free (`ThemeColor = number | string`, both of which
 * three's `Color` accepts) so `gcode-preview-core` can re-export them without
 * leaking a three dependency. three `Color` objects are constructed at apply time
 * inside the scene/build-volume modules, never here.
 *
 * Semantic status colors — the progress/retraction markers, overlay ghost/band,
 * and the origin tripod (RGB axes) — are intentionally not themeable.
 */

/** A color three's `Color` accepts: `0xRRGGBB` or a CSS string. */
export type ThemeColor = number | string;

/** Extrusion (tube) material look. `matte` = unlit-ish Lambert; `glossy` = PBR Standard. */
export type MaterialPreset = 'matte' | 'glossy';

/**
 * A partial, declarative theme. Every field is optional; unspecified fields fall
 * back to {@link DEFAULT_THEME} (replace semantics — the object fully describes the
 * desired state, so `setTheme` resets omitted fields to their defaults).
 */
export interface Theme {
  /** Scene background. Omit to leave three's default (today's unset/transparent look);
   *  `null` is the same as omitting. A color paints a solid backdrop. */
  background?: ThemeColor | null;
  /** Build-plate grid line color. */
  gridColor?: ThemeColor;
  /** Build-plate outline (wireframe box) color. */
  bedColor?: ThemeColor;
  /** Ambient hemisphere light intensity. */
  hemisphereIntensity?: number;
  /** Key directional light intensity. */
  directionalIntensity?: number;
  /** Extrusion (tube) material preset. Lines-quality geometry is unlit and unaffected. */
  materialPreset?: MaterialPreset;
}

/** A theme with every value resolved (public overrides + fixed non-themeable constants). */
export interface ResolvedTheme {
  background: ThemeColor | null;
  gridColor: ThemeColor;
  gridOpacity: number;
  bedColor: ThemeColor;
  bedOpacity: number;
  hemisphereSky: ThemeColor;
  hemisphereGround: ThemeColor;
  hemisphereIntensity: number;
  directionalColor: ThemeColor;
  directionalIntensity: number;
  materialPreset: MaterialPreset;
}

/** The exact current look — the no-theme defaults (grid/box/lights from the original scene). */
export const DEFAULT_THEME: ResolvedTheme = {
  background: null, // never set today: leave three's default so nothing changes
  gridColor: 0x448844,
  gridOpacity: 0.35,
  bedColor: 0x888888,
  bedOpacity: 0.5,
  hemisphereSky: 0xffffff,
  hemisphereGround: 0x35404d,
  hemisphereIntensity: 1.6,
  directionalColor: 0xffffff,
  directionalIntensity: 1.1,
  materialPreset: 'matte'
};

/** Resolve a partial theme over {@link DEFAULT_THEME} (replace semantics). */
export function resolveTheme(theme?: Theme): ResolvedTheme {
  const t = theme ?? {};
  return {
    ...DEFAULT_THEME,
    ...(t.background !== undefined ? { background: t.background } : {}),
    ...(t.gridColor !== undefined ? { gridColor: t.gridColor } : {}),
    ...(t.bedColor !== undefined ? { bedColor: t.bedColor } : {}),
    ...(t.hemisphereIntensity !== undefined ? { hemisphereIntensity: t.hemisphereIntensity } : {}),
    ...(t.directionalIntensity !== undefined ? { directionalIntensity: t.directionalIntensity } : {}),
    ...(t.materialPreset !== undefined ? { materialPreset: t.materialPreset } : {})
  };
}
