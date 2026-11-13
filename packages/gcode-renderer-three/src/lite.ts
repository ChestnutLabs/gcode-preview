/**
 * `@chestnutlabs/gcode-renderer-three/lite`: the three-free pieces of this package.
 *
 * Every module this entry reaches has no value import of `three` (type imports only). A package
 * that loads the 3D renderer on demand with `import('@chestnutlabs/gcode-renderer-three')` imports
 * these statically from here instead of from the main entry. A bundler cannot split one module
 * between a startup chunk and a lazy chunk, so a single static value import of the main entry
 * pulls all of three.js into the startup bundle and defeats the lazy load.
 *
 * The main entry re-exports everything here, so consumers normally don't need this subpath.
 * `tools/bundle-check.mjs` guards it: a 2D-only bundle of the core controller and the four
 * adapters must load no three.js at startup.
 */
export { CaptureUnsupportedError } from './capture.js';
export type { CaptureOptions } from './capture.js';
export { studioTheme, STUDIO_CAMERA_FOV } from './theme.js';
export type { Theme, MaterialPreset, ThemeColor } from './theme.js';
export type { CameraMode, CameraView, CameraState } from './interactive-stage.js';
export type { PixelRatioOption } from './stage.js';
