/**
 * Resolved theme → build-volume styling (DD-032; extracted from the scene so the model viewer can share
 * it). The cage flag is separate state on each viewer, so it is passed in.
 */
import type { BuildVolumeStyle } from './build-volume.js';
import type { ResolvedTheme } from './theme.js';

export function volumeStyle(t: ResolvedTheme, showCage: boolean): BuildVolumeStyle {
  return {
    gridColor: t.gridColor,
    gridOpacity: t.gridOpacity,
    boxColor: t.bedColor,
    boxOpacity: t.bedOpacity,
    bedSurface: t.bedSurface,
    showCage,
    ...(t.gridMajor !== undefined ? { gridMajor: t.gridMajor } : {}),
    ...(t.bedOutline !== undefined ? { bedOutline: t.bedOutline } : {})
  };
}
