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
  /** Fidelity policy (DD-023 §4 D6): 'full' | 'adaptive' | 'fast'. 3D only. */
  export let qualityMode = undefined;
  /** #60 curtain: 'lines' (default, stream the preview), 'hold' (reveal only the final build), or 'off'. 3D only. */
  export let progressivePreview = undefined;
  /** #150 (DD-009 D3): camera projection ('perspective' | 'orthographic'). */
  export let cameraMode = 'perspective';
  /** DD-032: perspective lens in degrees, [10, 120] (default 50; STUDIO_CAMERA_FOV = 32). Unset keeps the
   *  current lens. Out of range throws RangeError (never clamped). 3D only. */
  export let cameraFov = undefined;
  /** Resting pixel ratio of the canvas: a number in (0, 4], or 'device' (the display's
  *  devicePixelRatio capped at 2, followed live). Unset keeps the renderer's ratio (1). A ratio of 2 shades
  *  4x the fragments of 1. Out of range throws RangeError (never clamped). 3D only. */
  export let pixelRatio = undefined;
  /** #306/#6: frame the printed 'object' (excl. skirt/prime) or 'all' extrusion. Default 'all'. */
  export let frameContent = 'all';
  /** #306/2 (DD-020): 'auto' reduces detail while the camera moves. Default 'off'. */
  export let interactionQuality = 'off';
  /** #268/#275/M6: snap to a preset orientation (top/front/iso/…). */
  export let view = undefined;
  /** #268/#275/M6: restore a saved camera pose. Pair with the `camerachange` event for two-way. */
  export let cameraState = undefined;
  /** #153 (DD-009 D4): bounded declarative theme. */
  export let theme = undefined;
  export let colorMode = undefined;
  export let tube = undefined;
  /** Inclusive [start, end]; null shows every layer. */
  export let layerRange = null;
  /** Scrub cut (IR segment index); null shows everything up to the layer range. */
  export let scrub = null;
  /** Time-based scrub cut in ms of print time (#181); null clears it. */
  export let scrubTime = null;
  export let showTravel = true;
  /** DD-016 (#182): show slicer wipe moves. Default true. */
  export let showWipe = true;
  /** #584: show CNC/laser cut moves. Default true. */
  export let showCut = true;
  /** DD-009 D1 (#148): opt-in retraction/deretraction markers. */
  export let showRetractions = false;
  /** #306/#6: show the build-volume wireframe cage (independent of the bed/plate). Default true. */
  export let showVolumeCage = true;
  /** DD-031 G3: feature roles to hide (e.g. `[FeatureRole.Skirt, FeatureRole.Brim]`). Declarative
   *  form of `controls.setFeatureRoleVisible`; gate on `capabilities.featureRoles`. */
  export let hiddenFeatureRoles = undefined;
  /** DD-006 live progress observation; null hides the overlay. */
  export let progress = null;
  /** Worker factory escape hatch (DD-005 slim/custom entries; D2). */
  export let createWorker = undefined;
  /** DD-014 D5: '3d' (default, Three.js — loaded on demand) or '2d' (low-resource Canvas view). */
  export let renderer = undefined;
  /** 2D only (renderer="2d"): preceding "ghost" layers beneath the active one (default 1, floor 0). */
  export let adjacentLayers = undefined;
  /** Advanced/test renderer injectables (pass-throughs of the renderer contract). */
  export let rendererOptions = undefined;

  const dispatch = createEventDispatcher();
  const isMachine = buildVolume !== undefined && 'bed' in buildVolume;

  /** The full store/action handle — reachable via `bind:this={c}` then `c.preview`. */
  export const preview = createGcodePreview({
    createWorker,
    renderer: {
      mode: renderer,
      buildVolume: isMachine ? undefined : buildVolume,
      quality,
      qualityMode,
      progressivePreview,
      cameraMode,
      cameraFov,
      pixelRatio,
      frameContent,
      interactionQuality,
      theme,
      colorMode,
      tube,
      adjacentLayers,
      ...rendererOptions
    },
    parseDefaults: parseOptions
  });

  preview.onEvent((e) => {
    switch (e.type) {
      case 'parse-complete':
        dispatch('ready', {
          segments: e.segments,
          layers: e.layers,
          complete: e.complete,
          capabilities: e.capabilities,
          warnings: e.warnings,
          metadata: e.metadata
        });
        break;
      case 'camera-changed':
        dispatch('camerachange', e.state);
        break;
      case 'parse-error': {
        // The whole error, `cause` and `reason` included, without the event's `type`.
        const { type: _type, ...error } = e;
        dispatch('parseerror', error);
        break;
      }
      case 'parse-cancelled':
        dispatch('parsecancelled');
        break;
      case 'parse-progress':
        dispatch('parseprogress', { bytesProcessed: e.progress.bytesProcessed, totalBytes: e.progress.totalBytes });
        break;
      case 'stage':
        dispatch('stage', { stage: e.stage, progress: e.progress, detail: e.detail });
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
      case 'error': {
        const { type: _type, ...error } = e;
        if (e.code === 'machine-geometry-mismatch') dispatch('machinegeometrymismatch', e.message);
        else dispatch('error', error);
        break;
      }
      case 'renderer-unsupported':
        // #520: the renderer cannot honour a requested setting (e.g. a lens on the 2D renderer); once per request.
        dispatch('rendererunsupported', { feature: e.feature, message: e.message });
        break;
      default:
        break;
    }
  });

  // ---- prop wiring: each prop is a thin reactive call into the handle (D1 shell rule) ----
  // buildVolume must be reactive too (#274) — matching Vue's watch and React's useEffect. A machine
  // geometry is (re)applied via the handle; a plain BuildVolumeDef is an init-time renderer option
  // (above) that a post-mount change re-applies here as well (React and Vue do the same).
  $: if (buildVolume !== undefined) preview.controls.setBuildVolume(buildVolume);
  // Only `source` re-parses. `parseOptions` is read inside the function, so the `$:` block does not track it:
  // an inline `parseOptions={{ ... }}` is a new object every render and must not re-parse an unchanged file
  // (React reads it from a ref and Vue untracked, so all three adapters agree). #435.
  // On a source change the view props are read here too, untracked, and re-sent when they hold a value: a
  // renderer shows the new file uncut, and the controller applies them to the file this parse loads. scrubTime
  // goes last, so it wins over scrub (as at mount). The first parse needs none: the blocks below send them.
  let sourceParsed = false;
  // The source last parsed. Svelte counts any object prop as changed whenever it is set again, even to the same
  // value (a spread `{...props}`, or a parent re-setting `source={file}`), so the same bytes again would re-parse.
  // The same source again is no change, as in the React, Vue and Web Component adapters; to reload the same
  // bytes, pass a new array or call `parse()`. Clearing `source` resets it.
  let lastSource = null;
  function parseSource(bytes) {
    if (bytes === lastSource) return;
    lastSource = bytes;
    void preview.parse(bytes, parseOptions);
    const first = !sourceParsed;
    sourceParsed = true;
    if (first) return;
    if (layerRange !== null && layerRange !== undefined) preview.controls.setLayerRange(layerRange[0], layerRange[1]);
    if (scrub !== null && scrub !== undefined) preview.controls.setScrubPosition(scrub);
    if (scrubTime !== null && scrubTime !== undefined) preview.controls.setScrubTime(scrubTime);
  }
  // The scrub values last sent from the props. A nullish prop is sent (as a clear) only when it replaces a sent
  // number, so an unset `scrubTime` at mount no longer clears the `scrub` cut.
  let scrubSent = null;
  let scrubTimeSent = null;
  function sendScrub(v) {
    if (v === null && scrubSent === null) return;
    scrubSent = v;
    preview.controls.setScrubPosition(v);
  }
  function sendScrubTime(v) {
    if (v === null && scrubTimeSent === null) return;
    scrubTimeSent = v;
    preview.controls.setScrubTime(v);
  }
  $: if (source !== null && source !== undefined) parseSource(source);
  else lastSource = null;
  $: if (layerRange === null || layerRange === undefined) preview.controls.setLayerRange(0, Number.POSITIVE_INFINITY);
  else preview.controls.setLayerRange(layerRange[0], layerRange[1]);
  $: sendScrub(scrub ?? null);
  $: sendScrubTime(scrubTime ?? null);
  $: preview.controls.setKindVisible('travel', showTravel);
  $: preview.controls.setKindVisible('wipe', showWipe);
  $: preview.controls.setKindVisible('cut', showCut);
  $: preview.controls.setShowRetractions(showRetractions);
  $: preview.controls.setBuildVolumeCage(showVolumeCage);
  $: if (colorMode !== undefined) preview.controls.setColorMode(colorMode);
  // #520: what the controls last received for the four 3D-only construction props; each applies only when
  // its value differs. 3D was built with the construction values, so mount is a no-op there (a re-applied
  // quality would rebuild). 2D starts from the documented defaults, so only a non-default mount value is
  // applied, and the 2D renderer reports it once.
  const is2D = renderer === '2d';
  let appliedQuality = is2D ? 'auto' : quality;
  function applyQuality(q) {
    if (q === appliedQuality) return;
    appliedQuality = q;
    preview.controls.setQuality(q);
  }
  let appliedCameraMode = is2D ? 'perspective' : cameraMode;
  function applyCameraMode(mode) {
    if (mode === appliedCameraMode) return;
    appliedCameraMode = mode;
    preview.controls.setCameraMode(mode);
  }
  let appliedCameraFov = is2D ? 50 : cameraFov; // 50: the default lens
  function applyCameraFov(fov) {
    if (fov === undefined || fov === appliedCameraFov) return;
    appliedCameraFov = fov;
    preview.controls.setCameraFov(fov);
  }
  let appliedPixelRatio = is2D ? undefined : pixelRatio;
  function applyPixelRatio(ratio) {
    if (ratio === undefined || ratio === appliedPixelRatio) return;
    appliedPixelRatio = ratio;
    preview.controls.setPixelRatio(ratio);
  }
  $: applyQuality(quality);
  $: if (qualityMode) preview.controls.setQualityMode(qualityMode);
  $: if (progressivePreview) preview.controls.setProgressivePreview(progressivePreview);
  $: applyCameraMode(cameraMode);
  $: applyCameraFov(cameraFov);
  $: applyPixelRatio(pixelRatio);
  $: preview.controls.setFrameContent(frameContent);
  $: preview.controls.setInteractionQuality(interactionQuality);
  $: if (view !== undefined) preview.controls.setView(view);
  $: if (cameraState !== undefined && cameraState !== null) preview.controls.setCameraState(cameraState);
  $: if (theme !== undefined) preview.controls.setTheme(theme);
  $: if (progress === null || progress === undefined) preview.clearProgress();
  else preview.observeProgress(progress);

  // Feature-role visibility (DD-031 G3): diff prev→next so we only toggle roles this prop owns.
  // `roleState` is a plain object (property mutation isn't Svelte-tracked) so the reactive block
  // depends only on `hiddenFeatureRoles` and can't loop on its own bookkeeping.
  const roleState = { prev: [] };
  function applyHiddenRoles(roles) {
    const next = roles ?? [];
    for (const role of roleState.prev) if (!next.includes(role)) preview.controls.setFeatureRoleVisible(role, true);
    for (const role of next) if (!roleState.prev.includes(role)) preview.controls.setFeatureRoleVisible(role, false);
    roleState.prev = [...next];
  }
  $: applyHiddenRoles(hiddenFeatureRoles);

  onDestroy(() => preview.dispose());
</script>

<!-- tabindex makes the canvas focusable → keyboard camera (DD-004 a11y, #275/M4) -->
<canvas
  use:preview.canvas
  tabindex="0"
  style="width: 100%; height: 100%; display: block; touch-action: none;"
  aria-label="3D G-code toolpath preview"
></canvas>
