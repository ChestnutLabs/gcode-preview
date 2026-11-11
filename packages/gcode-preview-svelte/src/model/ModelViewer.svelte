<script>
  /**
   * <ModelViewer> — the ready-to-use Svelte component for interactive source-model viewing (STL / 3MF),
   * the Prepare-side counterpart to <GcodePreview> (DD-031). A SHELL over `createModelViewer` (the
   * Svelte store/action handle): every prop is a reactive statement into the handle, every dispatched
   * event re-fires a controller event, and the handle is exported for bind:this access (`viewer`).
   * `<ModelViewer source={file} />` alone is a working viewer.
   *
   * Shipped RAW — the consumer's bundler compiles it via the "svelte" export condition.
   */
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { createModelViewer } from './create-model-viewer.js';

  /** The source model. Changing it re-parses. */
  export let source = null;
  /** Snap to a preset orientation (shared vocabulary with the toolpath camera). */
  export let view = undefined;
  /** Restore a saved camera pose. Pair with the `camerachange` event for two-way binding. */
  export let cameraState = undefined;
  /** 'transparent' (default) | CSS colour | 0xRRGGBB. */
  export let background = undefined;
  /** DD-020 interaction-aware quality; default 'auto'. */
  export let interactionQuality = undefined;
  /** Initial camera projection; default 'perspective'. */
  export let cameraMode = undefined;
  /** Render only a subset: { plateId } / { objectIds } / { instanceFilter }; null = whole source. */
  export let renderScope = undefined;
  /** Source-model triangle / byte caps. */
  export let limits = undefined;
  /** 3MF paint_color palette override (hex per 0-based slot). */
  export let filamentPalette = undefined;
  /** Loader registry (open kind). Default: STL + 3MF. */
  export let loaders = undefined;
  /** Build plate under the model (DD-032): the full BuildVolumeDef; null/omitted = no plate. */
  export let buildVolume = undefined;
  /** Plate/backdrop look, e.g. studioTheme('dark'); lights are deliberately not themed. Beats `background`. */
  export let theme = undefined;
  /** Perspective lens in degrees, [10, 120] (default 50). Out of range throws RangeError. */
  export let cameraFov = undefined;
  /** Resting pixel ratio: (0, 4] or 'device' (DPR capped at 2, followed live). Unset keeps 1. Out of range throws RangeError. */
  export let pixelRatio = undefined;
  /** Advanced/test: inject GL / orbit controls. */
  export let createRenderer = undefined;
  export let createControls = undefined;

  const dispatch = createEventDispatcher();

  /** The full store/action handle — reachable via bind:this={c} then c.viewer. */
  export const viewer = createModelViewer({
    background,
    interactionQuality,
    cameraMode,
    limits,
    filamentPalette,
    loaders,
    renderScope,
    buildVolume,
    theme,
    cameraFov,
    pixelRatio,
    createRenderer,
    createControls,
    onProgress: (p) => dispatch('progress', p)
  });

  viewer.onEvent((e) => {
    switch (e.type) {
      case 'ready':
        dispatch('ready', e.info);
        break;
      case 'camera-changed':
        dispatch('camerachange', e.state);
        break;
      case 'error':
        dispatch('error', { code: e.code, message: e.message });
        break;
      case 'renderer-unsupported':
        dispatch('rendererunsupported', { feature: e.feature, message: e.message });
        break;
      case 'context-lost':
        dispatch('contextlost');
        break;
      case 'context-restored':
        dispatch('contextrestored');
        break;
      default:
        break;
    }
  });

  // ---- prop wiring: each prop is a thin reactive call into the handle (D1 shell rule) ----
  $: if (source !== null && source !== undefined) void viewer.controls.setSource(source);
  $: if (view !== undefined) viewer.controls.setView(view);
  $: if (cameraState !== undefined && cameraState !== null) viewer.controls.setCameraState(cameraState);
  $: if (background !== undefined) viewer.controls.setBackground(background);
  $: if (interactionQuality !== undefined) viewer.controls.setInteractionQuality(interactionQuality);
  $: if (renderScope !== undefined) viewer.controls.setRenderScope(renderScope);
  // DD-032: look + lens (the controller remembers them across canvas rebinds)
  $: if (buildVolume !== undefined) viewer.controls.setBuildVolume(buildVolume);
  $: if (theme !== undefined) viewer.controls.setTheme(theme);
  $: if (cameraFov !== undefined) viewer.controls.setCameraFov(cameraFov);
  $: if (pixelRatio !== undefined) viewer.controls.setPixelRatio(pixelRatio);

  onDestroy(() => viewer.dispose());
</script>

<!-- tabindex makes the canvas focusable → keyboard camera (DD-004 a11y) -->
<canvas
  use:viewer.canvas
  tabindex="0"
  style="width: 100%; height: 100%; display: block; touch-action: none;"
  aria-label="3D source-model preview"
></canvas>
