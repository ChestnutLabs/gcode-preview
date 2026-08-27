/**
 * <gcode-preview> — the framework-free Web Component adapter (DD-007 D1 / DD-009 D5).
 *
 * Strictly a SHELL over `createPreviewController` (D1: never a separate implementation),
 * exactly like the Vue/React/Svelte adapters: attributes and properties map to the same
 * neutral controller options / `controls.*` calls, and controller events are re-emitted as
 * DOM `CustomEvent`s (kebab-case). The underlying handle is also exposed as instance members
 * (`state`/`controls`/`raw`/`onEvent`/`parse`/…) so the shared behavioral suite runs against
 * it identically to the other three adapters.
 *
 * No framework peer dependency — this is the plain-DOM / Angular / vanilla path.
 */
import {
  createPreviewController,
  type CaptureOptions,
  type GcodePreviewControls,
  type GcodePreviewState,
  type ParseOutcome,
  type PreviewController,
  type PreviewEvent,
  type RendererMode
} from '@chestnutlabs/gcode-preview-core';
import type {
  BuildVolumeDef,
  CameraMode,
  CameraState,
  CameraView,
  ColorMode,
  Theme,
  TubeOptions
} from '@chestnutlabs/gcode-renderer-three';
import type { MachineGeometry, MappedProgress, ProgressObservation } from '@chestnutlabs/toolpath-core';
import type { WireParseOptions, WorkerLike } from '@chestnutlabs/gcode-parser';

export type GcodePreviewSource = Uint8Array | ArrayBuffer | File | null;

/** Advanced/test renderer injectables (pass-throughs of the controller's renderer contract). */
export type ElementRendererOptions = Omit<
  NonNullable<PreviewControllerRenderer>,
  | 'buildVolume'
  | 'quality'
  | 'qualityMode'
  | 'progressivePreview'
  | 'cameraMode'
  | 'frameContent'
  | 'interactionQuality'
  | 'theme'
  | 'colorMode'
  | 'tube'
>;
type PreviewControllerRenderer = NonNullable<Parameters<typeof createPreviewController>[0]>['renderer'];

/** Observed scalar/boolean/number attributes; rich options are property-only. */
const OBSERVED = [
  'quality',
  'quality-mode',
  'progressive-preview',
  'camera-mode',
  'frame-content',
  'interaction-quality',
  'view',
  'show-travel',
  'show-wipe',
  'show-retractions',
  'show-volume-cage',
  'scrub',
  'scrub-time',
  'layer-range'
] as const;

/** The default tag name (DD-009 §4.5). */
export const DEFAULT_TAG = 'gcode-preview';

export class GcodePreviewElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return [...OBSERVED];
  }

  private controller: PreviewController | null = null;
  private canvasEl: HTMLCanvasElement | null = null;

  // Rich options — objects/functions can't be attributes, so they are property-only.
  private _source: GcodePreviewSource = null;
  private _parseOptions: WireParseOptions | undefined;
  private _buildVolume: BuildVolumeDef | MachineGeometry | undefined;
  private _colorMode: ColorMode | undefined;
  private _tube: TubeOptions | undefined;
  private _theme: Theme | undefined;
  private _progress: ProgressObservation | null = null;
  private _createWorker: (() => WorkerLike) | undefined;
  private _rendererOptions: ElementRendererOptions | undefined;
  private _cameraState: CameraState | null = null;

  // ---- rich-option property accessors ----
  get source(): GcodePreviewSource {
    return this._source;
  }
  set source(v: GcodePreviewSource) {
    this._source = v;
    if (this.controller !== null && v !== null) void this.controller.parse(v, this._parseOptions);
  }
  get parseOptions(): WireParseOptions | undefined {
    return this._parseOptions;
  }
  set parseOptions(v: WireParseOptions | undefined) {
    this._parseOptions = v;
  }
  get buildVolume(): BuildVolumeDef | MachineGeometry | undefined {
    return this._buildVolume;
  }
  set buildVolume(v: BuildVolumeDef | MachineGeometry | undefined) {
    this._buildVolume = v;
    if (this.controller !== null && v !== undefined && 'bed' in v) this.controller.controls.setBuildVolume(v);
  }
  get colorMode(): ColorMode | undefined {
    return this._colorMode;
  }
  set colorMode(v: ColorMode | undefined) {
    this._colorMode = v;
    if (this.controller !== null && v !== undefined) this.controller.controls.setColorMode(v);
  }
  get tube(): TubeOptions | undefined {
    return this._tube;
  }
  set tube(v: TubeOptions | undefined) {
    this._tube = v; // construction-only (tube profile is fixed per renderer)
  }
  get theme(): Theme | undefined {
    return this._theme;
  }
  set theme(v: Theme | undefined) {
    this._theme = v;
    if (this.controller !== null && v !== undefined) this.controller.controls.setTheme(v);
  }
  get progress(): ProgressObservation | null {
    return this._progress;
  }
  set progress(v: ProgressObservation | null) {
    this._progress = v;
    this.applyProgress();
  }
  get createWorker(): (() => WorkerLike) | undefined {
    return this._createWorker;
  }
  set createWorker(v: (() => WorkerLike) | undefined) {
    this._createWorker = v; // construction-only (a worker factory can't change mid-lifecycle)
  }
  get rendererOptions(): ElementRendererOptions | undefined {
    return this._rendererOptions;
  }
  set rendererOptions(v: ElementRendererOptions | undefined) {
    this._rendererOptions = v; // construction-only injectables
  }

  // ---- scalar-option accessors (reflect to attributes: one source of truth) ----
  get quality(): string | null {
    return this.getAttribute('quality');
  }
  set quality(v: string | null) {
    this.reflect('quality', v);
  }
  get qualityMode(): string | null {
    return this.getAttribute('quality-mode');
  }
  set qualityMode(v: string | null) {
    this.reflect('quality-mode', v);
  }
  get progressivePreview(): string | null {
    return this.getAttribute('progressive-preview');
  }
  set progressivePreview(v: string | null) {
    this.reflect('progressive-preview', v);
  }
  get cameraMode(): string | null {
    return this.getAttribute('camera-mode');
  }
  set cameraMode(v: string | null) {
    this.reflect('camera-mode', v);
  }
  /** #306/#6: frame the printed 'object' (excl. skirt/prime) or 'all' extrusion. */
  get frameContent(): string | null {
    return this.getAttribute('frame-content');
  }
  set frameContent(v: string | null) {
    this.reflect('frame-content', v);
  }
  /** #306/2 (DD-020): 'auto' reduces detail while the camera moves. */
  get interactionQuality(): string | null {
    return this.getAttribute('interaction-quality');
  }
  set interactionQuality(v: string | null) {
    this.reflect('interaction-quality', v);
  }
  /** #268/#275/M6: preset orientation attribute (top/front/iso/…). */
  get view(): string | null {
    return this.getAttribute('view');
  }
  set view(v: string | null) {
    this.reflect('view', v);
  }
  /** #268/#275/M6: restore a saved pose (property-only — objects can't be attributes). Pair with the
   *  `camerachange` event for two-way. */
  get cameraState(): CameraState | null {
    return this.controller !== null ? this.controller.controls.getCameraState() : this._cameraState;
  }
  set cameraState(v: CameraState | null) {
    this._cameraState = v;
    if (this.controller !== null && v !== null) this.controller.controls.setCameraState(v);
  }
  /** Default true; only `show-travel="false"` hides travel. */
  get showTravel(): boolean {
    return this.getAttribute('show-travel') !== 'false';
  }
  set showTravel(v: boolean) {
    this.setAttribute('show-travel', v ? 'true' : 'false');
  }
  /** DD-016 (#182): default true; only `show-wipe="false"` hides slicer wipe moves. */
  get showWipe(): boolean {
    return this.getAttribute('show-wipe') !== 'false';
  }
  set showWipe(v: boolean) {
    this.setAttribute('show-wipe', v ? 'true' : 'false');
  }
  /** Default false; only `show-retractions="true"` shows markers. */
  get showRetractions(): boolean {
    return this.getAttribute('show-retractions') === 'true';
  }
  set showRetractions(v: boolean) {
    this.setAttribute('show-retractions', v ? 'true' : 'false');
  }
  /** #306/#6: build-volume cage, independent of the plate. Default true; `show-volume-cage="false"` hides it. */
  get showVolumeCage(): boolean {
    return this.getAttribute('show-volume-cage') !== 'false';
  }
  set showVolumeCage(v: boolean) {
    this.setAttribute('show-volume-cage', v ? 'true' : 'false');
  }
  get scrub(): number | null {
    const a = this.getAttribute('scrub');
    return a === null ? null : Number(a);
  }
  set scrub(v: number | null) {
    this.reflect('scrub', v);
  }
  /** Time-based scrub cut in ms of print time (#181). */
  get scrubTime(): number | null {
    const a = this.getAttribute('scrub-time');
    return a === null ? null : Number(a);
  }
  set scrubTime(v: number | null) {
    this.reflect('scrub-time', v);
  }
  get layerRange(): [number, number] | null {
    return parseLayerRange(this.getAttribute('layer-range'));
  }
  set layerRange(v: [number, number] | null) {
    this.reflect('layer-range', v === null ? null : `${v[0]},${v[1]}`);
  }

  // ---- handle-parity passthrough (advanced/parity surface; DOM events are the ergonomic one) ----
  get state(): GcodePreviewState {
    return this.requireController().getState();
  }
  get controls(): GcodePreviewControls {
    return this.requireController().controls;
  }
  get raw(): PreviewController['raw'] {
    return this.requireController().raw;
  }
  parse(input: Uint8Array | ArrayBuffer | File, opts?: WireParseOptions): Promise<ParseOutcome> {
    return this.requireController().parse(input, opts);
  }
  /** Capture the current view as an image `Blob` (DD-030 D1). Delegates to `controls.capture`. */
  capture(opts?: CaptureOptions): Promise<Blob> {
    return this.requireController().controls.capture(opts);
  }
  observeProgress(obs: ProgressObservation): MappedProgress | null {
    return this.controller?.observeProgress(obs) ?? null;
  }
  tickProgress(nowMs: number): MappedProgress | null {
    return this.controller?.tickProgress(nowMs) ?? null;
  }
  clearProgress(): void {
    this.controller?.clearProgress();
  }
  onEvent(cb: (e: PreviewEvent) => void): () => void {
    return this.requireController().onEvent(cb);
  }

  // ---- lifecycle ----
  connectedCallback(): void {
    if (this.controller !== null) return; // guard double-connect
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.replaceChildren();
    const style = document.createElement('style');
    style.textContent = ':host{display:block;width:100%;height:100%}canvas{display:block;width:100%;height:100%}';
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', '3D G-code toolpath preview');
    canvas.setAttribute('tabindex', '0'); // focusable → keyboard camera (DD-004 a11y, #275/M4)
    root.append(style, canvas);
    this.canvasEl = canvas;

    const isMachine = this._buildVolume !== undefined && 'bed' in this._buildVolume;
    this.controller = createPreviewController({
      createWorker: this._createWorker,
      renderer: {
        // DD-014 D5: construction-time renderer selection (mode switching post-mount is out of scope).
        mode: (this.getAttribute('renderer') as RendererMode | null) ?? undefined,
        buildVolume: isMachine ? undefined : (this._buildVolume as BuildVolumeDef | undefined),
        quality: (this.getAttribute('quality') as 'auto' | 'lines' | 'tubes' | null) ?? 'auto',
        qualityMode: (this.getAttribute('quality-mode') as 'full' | 'adaptive' | 'fast' | null) ?? undefined,
        progressivePreview: (this.getAttribute('progressive-preview') as 'lines' | 'hold' | 'off' | null) ?? undefined,
        cameraMode: (this.getAttribute('camera-mode') as CameraMode | null) ?? undefined,
        frameContent: (this.getAttribute('frame-content') as 'object' | 'all' | null) ?? undefined,
        interactionQuality: (this.getAttribute('interaction-quality') as 'off' | 'auto' | null) ?? undefined,
        colorMode: this._colorMode,
        tube: this._tube,
        theme: this._theme,
        adjacentLayers: this.hasAttribute('adjacent-layers') ? Number(this.getAttribute('adjacent-layers')) : undefined,
        ...this._rendererOptions
      },
      parseDefaults: this._parseOptions
    });
    this.controller.onEvent((e) => this.reemit(e));
    this.controller.bindCanvas(canvas);
    if (isMachine) this.controller.controls.setBuildVolume(this._buildVolume as MachineGeometry);
    this.applyRuntimeState();
    if (this._source !== null) void this.controller.parse(this._source, this._parseOptions);
  }

  disconnectedCallback(): void {
    this.controller?.dispose();
    this.controller = null;
    this.canvasEl = null;
    this.shadowRoot?.replaceChildren();
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (this.controller === null) return; // connectedCallback applies the initial state
    const c = this.controller.controls;
    switch (name) {
      case 'quality':
        c.setQuality((value as 'auto' | 'lines' | 'tubes' | null) ?? 'auto');
        break;
      case 'quality-mode':
        if (value !== null) c.setQualityMode(value as 'full' | 'adaptive' | 'fast');
        break;
      case 'progressive-preview':
        if (value !== null) c.setProgressivePreview(value as 'lines' | 'hold' | 'off');
        break;
      case 'camera-mode':
        if (value !== null) c.setCameraMode(value as CameraMode);
        break;
      case 'frame-content':
        if (value !== null) c.setFrameContent(value as 'object' | 'all');
        break;
      case 'interaction-quality':
        if (value !== null) c.setInteractionQuality(value as 'off' | 'auto');
        break;
      case 'view':
        if (value !== null) c.setView(value as CameraView);
        break;
      case 'show-travel':
        c.setKindVisible('travel', value !== 'false');
        break;
      case 'show-wipe':
        c.setKindVisible('wipe', value !== 'false');
        break;
      case 'show-volume-cage':
        c.setBuildVolumeCage(value !== 'false');
        break;
      case 'show-retractions':
        c.setShowRetractions(value === 'true');
        break;
      case 'scrub':
        c.setScrubPosition(value === null ? null : Number(value));
        break;
      case 'scrub-time':
        c.setScrubTime(value === null ? null : Number(value));
        break;
      case 'layer-range': {
        const r = parseLayerRange(value);
        if (r === null) c.setLayerRange(0, Number.POSITIVE_INFINITY);
        else c.setLayerRange(r[0], r[1]);
        break;
      }
      default:
        break;
    }
  }

  // ---- internals ----
  /** Apply the runtime-only controls (the construction options were set at controller creation). */
  private applyRuntimeState(): void {
    const c = this.requireController().controls;
    c.setKindVisible('travel', this.showTravel);
    c.setKindVisible('wipe', this.showWipe);
    c.setShowRetractions(this.showRetractions);
    c.setBuildVolumeCage(this.showVolumeCage);
    const r = this.layerRange;
    if (r === null) c.setLayerRange(0, Number.POSITIVE_INFINITY);
    else c.setLayerRange(r[0], r[1]);
    c.setScrubPosition(this.scrub);
    c.setScrubTime(this.scrubTime);
    this.applyProgress();
  }

  private applyProgress(): void {
    if (this.controller === null) return;
    if (this._progress === null) this.controller.clearProgress();
    else this.controller.observeProgress(this._progress);
  }

  private reflect(attr: string, v: string | number | null): void {
    if (v === null) this.removeAttribute(attr);
    else this.setAttribute(attr, String(v));
  }

  private requireController(): PreviewController {
    if (this.controller === null) {
      throw new Error('<gcode-preview>: not connected to the DOM yet (no controller). Append it before use.');
    }
    return this.controller;
  }

  /** Re-emit a controller event as a kebab-case DOM CustomEvent. */
  private reemit(e: PreviewEvent): void {
    const emit = (type: string, detail?: unknown): void => {
      this.dispatchEvent(new CustomEvent(type, { detail }));
    };
    switch (e.type) {
      case 'parse-complete':
        emit('ready', {
          segments: e.segments,
          layers: e.layers,
          complete: e.complete,
          capabilities: e.capabilities,
          warnings: e.warnings,
          metadata: e.metadata
        });
        break;
      case 'camera-changed':
        emit('camerachange', e.state);
        break;
      case 'parse-error':
        emit('parse-error', { code: e.code, message: e.message });
        break;
      case 'parse-cancelled':
        emit('parse-cancelled');
        break;
      case 'parse-progress':
        emit('parse-progress', { bytesProcessed: e.progress.bytesProcessed, totalBytes: e.progress.totalBytes });
        break;
      case 'stage':
        emit('stage', { stage: e.stage, progress: e.progress, detail: e.detail });
        break;
      case 'buildComplete':
        emit('build-complete', { segments: e.segments, quality: e.quality });
        emit('disclosure', { text: this.controller?.getState().disclosure ?? '' });
        break;
      case 'qualityFallback':
        emit('quality-fallback', { from: e.from, to: e.to, reason: e.reason });
        break;
      case 'progress-presentation-changed':
        emit(
          'progress-presentation-changed',
          e.reason === undefined ? { mode: e.mode } : { mode: e.mode, reason: e.reason }
        );
        break;
      case 'machine-geometry-discovered':
        emit('machine-geometry-discovered', { machine: e.machine });
        break;
      case 'error':
        if (e.code === 'machine-geometry-mismatch') emit('machine-geometry-mismatch', { message: e.message });
        else emit('error', { code: e.code, message: e.message });
        break;
      default:
        break;
    }
  }
}

function parseLayerRange(value: string | null): [number, number] | null {
  if (value === null) return null;
  const parts = value.split(',').map((s) => Number(s.trim()));
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0], parts[1]];
}

/**
 * Register `<gcode-preview>` (idempotent — safe to call repeatedly and from multiple
 * bundles). Kept as a function (not a module side effect) so the package stays
 * `sideEffects: false`; import `@chestnutlabs/gcode-preview-element/define` for auto-registration.
 */
export function defineGcodePreview(tag: string = DEFAULT_TAG): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(tag) === undefined) customElements.define(tag, GcodePreviewElement);
}
