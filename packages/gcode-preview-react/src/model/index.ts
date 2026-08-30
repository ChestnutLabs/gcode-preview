/**
 * @chestnutlabs/gcode-preview-react/model — the React integration for interactive **source-model**
 * viewing (STL / 3MF), the Prepare-side counterpart to the toolpath `<GcodePreview>` (DD-031).
 * `useModelViewer` hook + `<ModelViewer>` component, both thin reactivity bridges over
 * `createModelPreviewController` — never a separate viewer. Shared contracts pass through from the
 * controller (the D1 drift firewall).
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
export type { ModelViewerProps, ModelViewerSource } from './model-viewer-component.js';
