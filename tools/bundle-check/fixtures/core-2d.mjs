// A 2D-only app on the core controller. The 3D loader stays reachable (lazy) from the same code.
// It also uses every three-related VALUE core exports, so re-exporting one of them from the renderer's
// main entry (instead of /lite) fails this real bundle, not only the source scan.
import {
  CaptureUnsupportedError,
  STUDIO_CAMERA_FOV,
  createPreviewController,
  studioTheme
} from '@chestnutlabs/gcode-preview-core';

globalThis.preview = createPreviewController({
  renderer: { mode: '2d', cameraFov: STUDIO_CAMERA_FOV, theme: studioTheme('dark') }
});
globalThis.isCaptureUnsupported = (err) => err instanceof CaptureUnsupportedError;
