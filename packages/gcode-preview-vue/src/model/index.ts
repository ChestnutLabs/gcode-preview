/**
 * @chestnutlabs/gcode-preview-vue/model — the Vue integration for interactive **source-model** viewing
 * (STL / 3MF), the Prepare-side counterpart to the toolpath `<GcodePreview>` (DD-031). `useModelViewer`
 * composable + `<ModelViewer>` component, both thin reactivity bridges over `createModelPreviewController`.
 */
export { useModelViewer } from './use-model-viewer.js';
export type {
  ModelViewerHandle,
  UseModelViewerOptions,
  ModelPreviewControls,
  ModelPreviewState,
  ModelViewerEvent,
  ModelReadyInfo
} from './use-model-viewer.js';
export { ModelViewer } from './model-viewer-component.js';
export type { ModelViewerSource } from './model-viewer-component.js';
