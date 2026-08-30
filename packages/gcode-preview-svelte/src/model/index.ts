/**
 * @chestnutlabs/gcode-preview-svelte/model — the Svelte integration for interactive **source-model**
 * viewing (STL / 3MF), the Prepare-side counterpart to the toolpath API (DD-031). `createModelViewer`
 * store/action handle + the raw `ModelViewer.svelte` component (import from
 * '@chestnutlabs/gcode-preview-svelte/model/ModelViewer.svelte'). Both are thin bridges over
 * `createModelPreviewController` — never a separate viewer.
 */
export * from './create-model-viewer.js';
