<script>
  /**
   * <GcodePreview> — the ready-to-use Svelte component (DD-007 D1 amendment, phase 7).
   *
   * Strictly a SHELL over `createGcodePreview` (D1: never a separate implementation):
   * every prop is a reactive statement into the store/action API, every dispatched event
   * re-fires a controller event, and the underlying handle is exported for bind:this
   * access (`preview`). Advanced props are optional with sensible defaults, so
   * `<GcodePreview source={file} />` alone is a working viewer (D4).
   *
   * Svelte-4-style component (compiles under Svelte 5 compat) shipped RAW — the
   * consumer's bundler compiles it via the "svelte" export condition.
   */
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { createGcodePreview } from './create-gcode-preview.js';

  /** Bytes/File to parse. Changing it re-parses. */
  export let source = null;
  export let parseOptions = undefined;
  /** Consumer-configured volume — wins over file-discovered geometry (DD-005). */
  export let buildVolume = undefined;
  export let quality = 'auto';
  export let colorMode = undefined;
  export let tube = undefined;
  /** Inclusive [start, end]; null shows every layer. */
  export let layerRange = null;
  /** Scrub cut (IR segment index); null shows everything up to the layer range. */
  export let scrub = null;
  export let showTravel = true;
  /** DD-009 D1 (#148): opt-in retraction/deretraction markers. */
  export let showRetractions = false;
  /** DD-006 live progress observation; null hides the overlay. */
  export let progress = null;
  /** Worker factory escape hatch (DD-005 slim/custom entries; D2). */
  export let createWorker = undefined;
  /** Advanced/test renderer injectables (pass-throughs of the renderer contract). */
  export let rendererOptions = undefined;

  const dispatch = createEventDispatcher();
  const isMachine = buildVolume !== undefined && 'bed' in buildVolume;

  /** The full store/action handle — reachable via `bind:this={c}` then `c.preview`. */
  export const preview = createGcodePreview({
    createWorker,
    renderer: {
      buildVolume: isMachine ? undefined : buildVolume,
      quality,
      colorMode,
      tube,
      ...rendererOptions
    },
    parseDefaults: parseOptions
  });

  if (isMachine) preview.controls.setBuildVolume(buildVolume);

  preview.onEvent((e) => {
    switch (e.type) {
      case 'parse-complete':
        dispatch('ready', { segments: e.segments, layers: e.layers, complete: e.complete });
        break;
      case 'parse-error':
        dispatch('parseerror', { code: e.code, message: e.message });
        break;
      case 'parse-cancelled':
        dispatch('parsecancelled');
        break;
      case 'parse-progress':
        dispatch('parseprogress', { bytesProcessed: e.progress.bytesProcessed, totalBytes: e.progress.totalBytes });
        break;
      case 'buildComplete': {
        dispatch('buildcomplete', { segments: e.segments, quality: e.quality });
        let disclosure = '';
        const off = preview.state.subscribe((s) => (disclosure = s.disclosure));
        off();
        dispatch('disclosure', disclosure);
        break;
      }
      case 'qualityFallback':
        dispatch('qualityfallback', { from: e.from, to: e.to, reason: e.reason });
        break;
      case 'progress-presentation-changed':
        dispatch('progresspresentationchanged', e.reason === undefined ? { mode: e.mode } : { mode: e.mode, reason: e.reason });
        break;
      case 'machine-geometry-discovered':
        dispatch('machinegeometrydiscovered', e.machine);
        break;
      case 'error':
        if (e.code === 'machine-geometry-mismatch') dispatch('machinegeometrymismatch', e.message);
        else dispatch('error', { code: e.code, message: e.message });
        break;
      default:
        break;
    }
  });

  // ---- prop wiring: each prop is a thin reactive call into the handle (D1 shell rule) ----
  $: if (source !== null && source !== undefined) void preview.parse(source, parseOptions);
  $: if (layerRange === null || layerRange === undefined) preview.controls.setLayerRange(0, Number.POSITIVE_INFINITY);
  else preview.controls.setLayerRange(layerRange[0], layerRange[1]);
  $: preview.controls.setScrubPosition(scrub ?? null);
  $: preview.controls.setKindVisible('travel', showTravel);
  $: preview.controls.setShowRetractions(showRetractions);
  $: if (colorMode !== undefined) preview.controls.setColorMode(colorMode);
  $: preview.controls.setQuality(quality);
  $: if (progress === null || progress === undefined) preview.clearProgress();
  else preview.observeProgress(progress);

  onDestroy(() => preview.dispose());
</script>

<canvas
  use:preview.canvas
  style="width: 100%; height: 100%; display: block; touch-action: none;"
  aria-label="3D G-code toolpath preview"
></canvas>
