/*
 * demo-kit/theme — the one viewport look shared by every Chestnut Labs development surface.
 *
 * The Feature Lab and the four framework showcases all render into the canonical neutral **mid-grey
 * documentation workspace** (#6d7176) — the same grey the screenshot harness uses for the capability
 * renders in the README/docs — so a visitor moving between the demos, and the imagery in the docs,
 * all read as one consistent product. This is a demo/documentation preference, NOT a library default:
 * the renderer still ships a transparent/unset background and consumers keep full control of theming.
 *
 * `DOC_VIEWPORT_THEME` is a bounded declarative `Theme` for the toolpath viewer (`<GcodePreview>`'s
 * `theme` prop / `controls.setTheme`). `DOC_VIEWPORT_BG` is the matching flat background for the model
 * viewer (`<ModelViewer background=…>`), which themes only its clear colour.
 */
export const DOC_VIEWPORT_BG = '#6d7176';

export const DOC_VIEWPORT_THEME = {
  background: DOC_VIEWPORT_BG,
  gridColor: '#565a60',
  bedColor: '#565a60',
  hemisphereIntensity: 2.1
};

// ---- DD-032 Studio look (opt-in preset) ----
// The Studio look is an OPT-IN preset (`studioTheme('dark' | 'light')` + `STUDIO_CAMERA_FOV`). The SDK's
// default look is unchanged: with no `theme` the renderer still ships the transparent/unset background and
// the 50 degree lens. The Feature Lab and showcases offer the preset as a switch and may start on it (they
// are our own design language); a consumer opts in with one line, e.g. `theme: studioTheme('dark')`.

/**
 * Looks offered by the showcase switchers. `docgrey` is the showcases' previous look (a flat grey set through
 * the ordinary `theme` / `background` props, the 50 degree lens); it is not the SDK default, which is no theme
 * at all.
 */
export const LOOKS = [
  { id: 'studio-dark', label: 'Studio dark', mode: 'dark' },
  { id: 'studio-light', label: 'Studio light', mode: 'light' },
  { id: 'docgrey', label: 'Documentation grey', mode: null }
];
export const LOOK_BY_ID = Object.fromEntries(LOOKS.map((l) => [l.id, l]));

/** The perspective lens range the SDK accepts; outside it `setCameraFov` throws `RangeError`. */
export const LENS_MIN = 10;
export const LENS_MAX = 120;
/** The SDK default lens (degrees). */
export const DEFAULT_LENS = 50;

/**
 * The model-viewer's honest plate-placement line, exactly as `ModelPreviewState` reports it: the tier word
 * and the offset, with no softening. `null` placement means no plate is drawn.
 */
export function placementLine(placement, offset) {
  if (placement === null || placement === undefined) return 'placement: none (no plate drawn)';
  const o = offset ? `offset x ${offset.x} y ${offset.y} z ${offset.z} mm` : 'offset none';
  return `placement: ${placement} · ${o}`;
}
