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

/** A consumer-supplied plate image (#185). NOT a URL — CSP-safe + synchronous for `renderStill`. */
export type BedTextureSource = ImageBitmap | HTMLCanvasElement;

/**
 * Build-plate surface (#185): a filled shaded plate instead of only the bare wireframe grid. Generic
 * and self-drawn — no bundled vendor plate textures (trademark/copyright + bloat). A consumer may
 * drape their own image via `texture`.
 */
export interface BedSurface {
  /** `'none'` = grid only (today's look); `'solid'` = a filled plate under the toolpath. */
  mode: 'none' | 'solid';
  /** Plate color (default a muted dark slate). */
  color?: ThemeColor;
  /** Plate opacity in [0,1] (default 1). */
  opacity?: number;
  /** Consumer image drawn on the plate (preloaded bitmap/canvas — never a URL). Top face only. */
  texture?: BedTextureSource;
  /** Plate thickness in mm (DD-032). Default 0 = a flat plane. `> 0` adds side walls below the top face,
   *  which keeps its height (z = −0.05) and stays unlit. */
  thickness?: number;
  /** Side-wall color of a thick plate (DD-032). Default = `color`. */
  edgeColor?: ThemeColor;
}

/** A scene background: a solid color, `null` (three's default), or a vertical gradient (DD-032). */
export type ThemeBackground = ThemeColor | null | { top: ThemeColor; bottom: ThemeColor };

/** A major grid tier (DD-032): lines every `every` mm from the bed minimum, drawn instead of the minor
 *  line they coincide with. `every` snaps to the nearest whole number of minor pitches (at least one). */
export interface ThemeGridMajor {
  every: number;
  opacity: number;
  /** Default = `gridColor`. */
  color?: ThemeColor;
}

/** The printable-boundary loop (DD-032), drawn above the grid for every bed shape. */
export interface ThemeBedOutline {
  opacity: number;
  /** Default = `gridColor`. */
  color?: ThemeColor;
}

/** A soft footprint shadow at plate level (DD-032). */
export interface ThemeContactShadow {
  opacity: number;
}

/**
 * A partial, declarative theme. Every field is optional; unspecified fields fall
 * back to {@link DEFAULT_THEME} (replace semantics — the object fully describes the
 * desired state, so `setTheme` resets omitted fields to their defaults).
 */
export interface Theme {
  /** Scene background. Omit to leave three's default (today's unset/transparent look);
   *  `null` is the same as omitting. A color paints a solid backdrop. */
  background?: ThemeBackground;
  /** Build-plate grid line color. */
  gridColor?: ThemeColor;
  /** Minor grid line opacity in [0,1] (default 0.35). */
  gridOpacity?: number;
  /** Major grid tier (DD-032); omit for a single-tier grid. */
  gridMajor?: ThemeGridMajor;
  /** Bed boundary loop (DD-032); omit for today's look (no loop on rect beds). */
  bedOutline?: ThemeBedOutline;
  /** Soft contact shadow under the content (DD-032); omit for none. */
  contactShadow?: ThemeContactShadow;
  /** Build-plate outline (wireframe box) color. */
  bedColor?: ThemeColor;
  /** Ambient hemisphere light intensity. */
  hemisphereIntensity?: number;
  /** Key directional light intensity. */
  directionalIntensity?: number;
  /** Extrusion (tube) material preset. Lines-quality geometry is unlit and unaffected. */
  materialPreset?: MaterialPreset;
  /** Build-plate surface (#185); omit for the bare grid (today's look). */
  bedSurface?: BedSurface;
}

/** A theme with every value resolved (public overrides + fixed non-themeable constants). */
export interface ResolvedTheme {
  background: ThemeBackground;
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
  bedSurface: BedSurface;
  /** Absent unless the theme sets it (DD-032), so the defaults stay key-for-key unchanged. */
  gridMajor?: ThemeGridMajor;
  bedOutline?: ThemeBedOutline;
  contactShadow?: ThemeContactShadow;
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
  materialPreset: 'matte',
  bedSurface: { mode: 'none' } // bare grid by default — no behavior change
};

// ─── Theme value checks ───────────────────────────────────────────────────────────────────────────
// Three-free and self-contained (no imports, no three types): a shared theme validator can lift this
// block as-is. Colour strings are NOT checked here. A theme is a consumer option, so a bad value throws
// `RangeError` instead of reaching three as NaN or a silent fallback.

/** NaN or an out-of-range opacity would render nonsense silently — reject it (RangeError, as tubes.ts). */
function checkOpacity(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!(value >= 0 && value <= 1)) {
    throw new RangeError(`theme ${name} must be a number in [0,1] (got ${String(value)})`);
  }
}

/** A light intensity or a plate thickness: a finite number, at least 0 (NaN/Infinity would reach three as is). */
function checkNonNegative(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new RangeError(`theme ${name} must be a finite number >= 0 (got ${String(value)})`);
  }
}

/** A named choice: an unknown string (a typo) used to fall back silently to the default. */
function checkOneOf(name: string, value: unknown, allowed: readonly string[]): void {
  if (!allowed.includes(value as string)) {
    throw new RangeError(
      `theme ${name} must be one of ${allowed.map((a) => `'${a}'`).join(', ')} (got ${String(value)})`
    );
  }
}

/** Every numeric / named theme value, checked before anything is resolved. */
function checkThemeValues(t: Theme): void {
  checkOpacity('gridOpacity', t.gridOpacity);
  checkOpacity('gridMajor.opacity', t.gridMajor?.opacity);
  checkOpacity('bedOutline.opacity', t.bedOutline?.opacity);
  checkOpacity('contactShadow.opacity', t.contactShadow?.opacity);
  if (t.gridMajor !== undefined && !(Number.isFinite(t.gridMajor.every) && t.gridMajor.every > 0)) {
    throw new RangeError(`theme gridMajor.every must be a positive number (got ${String(t.gridMajor.every)})`);
  }
  checkNonNegative('hemisphereIntensity', t.hemisphereIntensity);
  checkNonNegative('directionalIntensity', t.directionalIntensity);
  if (t.materialPreset !== undefined) checkOneOf('materialPreset', t.materialPreset, ['matte', 'glossy']);
  const s = t.bedSurface;
  if (s !== undefined) {
    checkOneOf('bedSurface.mode', s.mode, ['none', 'solid']);
    checkOpacity('bedSurface.opacity', s.opacity);
    checkNonNegative('bedSurface.thickness', s.thickness);
  }
}

/**
 * Resolve a partial theme over {@link DEFAULT_THEME} (replace semantics). Throws `RangeError` for an
 * opacity outside [0,1] (or NaN; grid, major, outline, shadow and plate opacities), a non-finite /
 * non-positive `gridMajor.every`, a light intensity or plate `thickness` that is not a finite number of at least 0,
 * or a `materialPreset` / `bedSurface.mode` that is not one of its names. `every` is NOT required to be
 * a multiple of the grid pitch: the build volume snaps it (see `BuildVolumeStyle.gridMajor`), so a later
 * grid-pitch change never makes an earlier theme throw.
 */
export function resolveTheme(theme?: Theme): ResolvedTheme {
  const t = theme ?? {};
  checkThemeValues(t);
  return {
    ...DEFAULT_THEME,
    ...(t.background !== undefined ? { background: t.background } : {}),
    ...(t.gridColor !== undefined ? { gridColor: t.gridColor } : {}),
    ...(t.gridOpacity !== undefined ? { gridOpacity: t.gridOpacity } : {}),
    ...(t.bedColor !== undefined ? { bedColor: t.bedColor } : {}),
    ...(t.hemisphereIntensity !== undefined ? { hemisphereIntensity: t.hemisphereIntensity } : {}),
    ...(t.directionalIntensity !== undefined ? { directionalIntensity: t.directionalIntensity } : {}),
    ...(t.materialPreset !== undefined ? { materialPreset: t.materialPreset } : {}),
    ...(t.bedSurface !== undefined ? { bedSurface: t.bedSurface } : {}),
    ...(t.gridMajor !== undefined ? { gridMajor: t.gridMajor } : {}),
    ...(t.bedOutline !== undefined ? { bedOutline: t.bedOutline } : {}),
    ...(t.contactShadow !== undefined ? { contactShadow: t.contactShadow } : {})
  };
}

/** Vertical field of view (degrees) of the Studio look's perspective camera (DD-032 §4.4). */
export const STUDIO_CAMERA_FOV = 32;

/**
 * The Studio viewport look (DD-032 §4.4): a gradient backdrop, a solid 4 mm plate, a two-tier grid
 * (10 mm minor — the build volume's default `grid` pitch, which the preset relies on — and 50 mm major),
 * a bed outline, and a contact shadow. Lights, material preset, and the cage color stay default.
 * Returns a fresh object each call.
 */
export function studioTheme(mode: 'dark' | 'light'): Theme {
  const bedSurface: BedSurface = { mode: 'solid', color: '#7c8086', thickness: 4, edgeColor: '#585c61' };
  return mode === 'dark'
    ? {
        background: { top: '#23272e', bottom: '#2b3038' },
        bedSurface,
        gridColor: '#ffffff',
        gridOpacity: 0.11,
        gridMajor: { every: 50, opacity: 0.39 },
        bedOutline: { color: '#ffffff', opacity: 0.83 },
        contactShadow: { opacity: 0.4 }
      }
    : {
        background: { top: '#dfe3e8', bottom: '#c9ced5' },
        bedSurface,
        gridColor: '#1b2430',
        gridOpacity: 0.16,
        gridMajor: { every: 50, opacity: 0.55 },
        bedOutline: { color: '#1b2430', opacity: 0.87 },
        contactShadow: { opacity: 0.3 }
      };
}
