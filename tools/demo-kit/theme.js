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
