/**
 * Canonical documentation-capture presentation.
 *
 * This is the ONE place the documentation media look is defined — a neutral,
 * medium-value grey slicer/CAD-style viewport, so every screenshot in the
 * README, the GitHub Pages site, and the manual reads as one system. It is a
 * documentation/showcase setting, NOT a library default: the renderer still
 * ships a transparent/unset background (`DEFAULT_THEME.background === null`) and
 * consumers keep full control of their own background and theme. The harness
 * simply applies this theme via the public `renderer.setTheme(...)` API before
 * every capture.
 *
 * Why mid-grey (and not the demo's near-black `#16181d`): a medium grey holds
 * contrast against BOTH bright toolpaths (white/yellow/cyan travel, light
 * feature colors) and dark ones (deep blues, cut/rapid), keeps the bed grid
 * legible, and looks like the environment people associate with slicers, CAD,
 * and CAM preview — where a dark UI made bright paths bloom and dark paths
 * vanish. The value below is validated by regenerating the set and eyeballing
 * bright + dark corpora (3DBenchy feature colors, CNC cut/rapid, speed ramps).
 */

/** Neutral mid-grey viewport background (~0.17 rel. luminance). Documentation default. */
export const DOC_BACKGROUND = '#6d7176';

/** Subtle, slightly darker neutral grid — reads as CAD, never competes with the toolpath. */
export const DOC_GRID = '#565a60';

/**
 * A slightly lighter checker/solid bed for shots that need the build surface to
 * be obviously present (bed-shape, framing, volume-cage shots). Most shots use
 * the bare grid (`bedSurface: { mode: 'none' }`) for the floating-toolpath look.
 */
export const DOC_BED_SURFACE = { mode: 'solid', color: '#777c82' };

/**
 * The canonical documentation Theme. `setTheme` has replace semantics (unspecified
 * fields reset to DEFAULT_THEME), so this object fully describes the doc look.
 * Pass `{ withBed: true }` to `docTheme()` for a solid bed surface.
 */
export function docTheme({ withBed = false, materialPreset = 'matte' } = {}) {
  return {
    background: DOC_BACKGROUND,
    gridColor: DOC_GRID,
    materialPreset,
    ...(withBed ? { bedSurface: DOC_BED_SURFACE } : { bedSurface: { mode: 'none' } })
  };
}

/** For Canvas-2D / model pages that paint their own backdrop, the same grey as a CSS color. */
export const DOC_BACKGROUND_CSS = DOC_BACKGROUND;

/** Shared capture viewport. deviceScaleFactor 2 → crisp 2× output. */
export const VIEW = { width: 1320, height: 760 };
export const SCALE = 2;

/**
 * Palettes mirror the demo (tools/demo/src/main.js) so documentation colors match
 * what a user sees in the app. Tuned once for legibility on DOC_BACKGROUND.
 */
export const PAL = {
  feature: [
    [0.92, 0.42, 0.72],
    [0.32, 0.68, 0.96],
    [0.97, 0.76, 0.28],
    [0.5, 0.9, 0.5],
    [0.8, 0.5, 0.95]
  ],
  tool: [
    [0.92, 0.42, 0.72],
    [0.32, 0.68, 0.96],
    [0.97, 0.76, 0.28],
    [0.5, 0.9, 0.5]
  ],
  height: [
    [0.13, 0.4, 0.95],
    [0.2, 0.85, 0.45],
    [0.97, 0.87, 0.2],
    [0.92, 0.3, 0.18]
  ],
  speed: [
    [0.12, 0.36, 0.95],
    [0.97, 0.86, 0.2],
    [0.92, 0.22, 0.15]
  ],
  object: [
    [0.35, 0.7, 0.95],
    [0.95, 0.55, 0.3],
    [0.5, 0.88, 0.5],
    [0.9, 0.42, 0.72]
  ]
};
