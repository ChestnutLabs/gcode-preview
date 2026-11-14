/**
 * <gcode-model-viewer> — the framework-free Web Component for interactive source-model viewing
 * (STL / 3MF), the Prepare-side counterpart to <gcode-preview> (DD-031). A SHELL over
 * `createModelPreviewController`, exactly like the Vue/React/Svelte model adapters: attributes and
 * properties map to controller options / `controls.*` calls, and controller events are re-emitted as
 * DOM `CustomEvent`s. The handle is also exposed as instance members (`state`/`controls`/`raw`/`onEvent`/
 * `setSource`/`capture`) so the shared model behavioral suite runs against it identically.
 *
 * The tag is `gcode-model-viewer` (not the reserved `model-viewer`). No framework peer dependency.
 */
import {
  createModelPreviewController,
  type ModelBackground,
  type ModelLimits,
  type ModelLoader,
  type ModelPreviewController,
  type ModelPreviewControls,
  type ModelPreviewState,
  type ModelSourceInput,
  type ModelViewer,
  type ModelViewerEvent,
  type RenderScope
} from '@chestnutlabs/gcode-model-renderer';
import { CaptureUnsupportedError, resolveTheme } from '@chestnutlabs/gcode-renderer-three';
import { CAMERA_MODES, CAMERA_VIEWS, INTERACTION_QUALITIES, assertEnum, pickEnum } from '../enums.js';
import type {
  BuildVolumeDef,
  Theme,
  CameraState,
  CaptureOptions,
  GLRendererLike,
  InteractiveStageOptions,
  PixelRatioOption,
  RenderTargetCanvas
} from '@chestnutlabs/gcode-renderer-three';

/** Observed scalar attributes; rich options (source, cameraState, palettes, loaders, injectables) are property-only. */
const OBSERVED = [
  'view',
  'background',
  'interaction-quality',
  'camera-mode',
  'camera-fov',
  'pixel-ratio',
  'show-volume-cage'
] as const;

/** A `camera-fov` attribute as a valid lens, or `undefined` (absent, non-numeric or outside [10, 120]). */
function parseFovAttribute(value: string | null): number | undefined {
  // Number(null), Number('') and Number(' ') are all 0, and NaN fails both bounds: the range alone decides.
  const n = Number(value);
  return n >= 10 && n <= 120 ? n : undefined;
}

/** A `pixel-ratio` attribute: exactly `'device'`, or a number in (0, 4]; else `undefined` (absent or invalid). */
function parsePixelRatioAttribute(value: string | null): PixelRatioOption | undefined {
  if (value === 'device') return 'device';
  // Number(null) and Number('') are 0 and NaN fails both bounds: the range alone decides.
  const n = Number(value);
  return n > 0 && n <= 4 ? n : undefined;
}

/** The default tag name for the model viewer. */
export const DEFAULT_MODEL_TAG = 'gcode-model-viewer';

export class GcodeModelViewerElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return [...OBSERVED];
  }

  private controller: ModelPreviewController | null = null;
  private canvasEl: HTMLCanvasElement | null = null;

  // Rich options — objects/functions can't be attributes, so they are property-only.
  private _source: ModelSourceInput | null = null;
  private _cameraState: CameraState | null = null;
  private _background: ModelBackground | undefined;
  private _renderScope: RenderScope | null = null;
  private _limits: ModelLimits | undefined;
  private _filamentPalette: readonly (string | undefined)[] | undefined;
  private _loaders: readonly ModelLoader[] | undefined;
  private _buildVolume: BuildVolumeDef | null = null;
  private _theme: Theme | undefined;
  private _cameraFov: number | undefined;
  private _pixelRatio: PixelRatioOption | undefined;
  private _createRenderer: ((canvas: RenderTargetCanvas) => GLRendererLike) | undefined;
  private _createControls: NonNullable<InteractiveStageOptions['createControls']> | undefined;

  // ---- rich-option property accessors ----
  get source(): ModelSourceInput | null {
    return this._source;
  }
  set source(v: ModelSourceInput | null) {
    this._source = v;
    if (v !== null && this.controller !== null) void this.controller.controls.setSource(v);
  }
  get cameraState(): CameraState | null {
    return this._cameraState;
  }
  set cameraState(v: CameraState | null) {
    this._cameraState = v;
    if (v !== null) this.controller?.controls.setCameraState(v);
  }
  /** Backdrop colour or `'transparent'`. Mirrors the `background` attribute (last value given; not reflected). */
  get background(): ModelBackground | undefined {
    return this._background;
  }
  set background(v: ModelBackground | undefined) {
    this._background = v;
    if (v !== undefined) this.controller?.controls.setBackground(v);
  }
  get renderScope(): RenderScope | null {
    return this._renderScope;
  }
  set renderScope(v: RenderScope | null) {
    // RangeError now, before anything is stored: the controller's own check, run on an unbound controller
    // (it validates before it touches any engine), so a disconnected element rejects a bad scope too.
    // This relies on createModelPreviewController() construction staying side-effect-free (no listeners,
    // timers, observers or GPU work until bind; measured ~2.6 µs, #582 review). If that changes, export the
    // check from gcode-model-renderer instead.
    if (v !== null) createModelPreviewController({}).controls.setRenderScope(v);
    this._renderScope = v;
    this.controller?.controls.setRenderScope(v);
  }
  /** Build plate under the model (DD-032) — property-only (object-valued). `null`/unset = no plate. */
  get buildVolume(): BuildVolumeDef | null {
    return this._buildVolume;
  }
  set buildVolume(v: BuildVolumeDef | null) {
    this._buildVolume = v ?? null;
    this.controller?.controls.setBuildVolume(this._buildVolume);
  }
  /** Plate/backdrop look, e.g. `studioTheme('dark')` (DD-032) — property-only. Throws `RangeError` for invalid values. */
  get theme(): Theme | undefined {
    return this._theme;
  }
  set theme(v: Theme | undefined) {
    if (v === undefined) return; // replace semantics: pass `{}` to reset, there is no "unset"
    resolveTheme(v); // RangeError now, not later from connectedCallback
    this._theme = v;
    this.controller?.controls.setTheme(v);
  }
  /**
   * Perspective lens in degrees, [10, 120] (DD-032). Mirrors the `camera-fov` attribute. Setting an
   * out-of-range value through the property throws `RangeError`, like `controls.setCameraFov`; an invalid
   * *attribute* is ignored and the last valid lens kept (attribute callbacks must not throw). Not reflected.
   * Reads return the last valid lens from either, including one given in markup; `undefined` if none.
   */
  get cameraFov(): number | undefined {
    return this._cameraFov;
  }
  set cameraFov(v: number | undefined) {
    if (v === undefined) return;
    if (!(v >= 10 && v <= 120)) throw new RangeError(`cameraFov must be in [10, 120] degrees (got ${String(v)})`);
    this._cameraFov = v;
    this.controller?.controls.setCameraFov(v);
  }
  /**
   * Resting pixel ratio: a number in (0, 4], or `'device'` (the display's DPR capped at 2, followed live;
   * the exact lowercase string). Mirrors the `pixel-ratio` attribute. Setting anything else through the
   * property throws `RangeError`, like `controls.setPixelRatio`; an invalid *attribute* is ignored and the
   * last valid ratio kept (attribute callbacks must not throw). Not reflected. Reads return the last valid
   * ratio from either, including one given in markup; `undefined` if none. A ratio of 2 shades 4x the
   * fragments of 1; the default `capture()` size does not change.
   */
  get pixelRatio(): PixelRatioOption | undefined {
    return this._pixelRatio;
  }
  set pixelRatio(v: PixelRatioOption | undefined) {
    if (v === undefined) return;
    if (v !== 'device' && !(typeof v === 'number' && v > 0 && v <= 4)) {
      throw new RangeError(`pixelRatio must be 'device' or a number in (0, 4] (got ${String(v)})`);
    }
    this._pixelRatio = v;
    this.controller?.controls.setPixelRatio(v);
  }
  get limits(): ModelLimits | undefined {
    return this._limits;
  }
  set limits(v: ModelLimits | undefined) {
    this._limits = v; // construction-time only
  }
  get filamentPalette(): readonly (string | undefined)[] | undefined {
    return this._filamentPalette;
  }
  set filamentPalette(v: readonly (string | undefined)[] | undefined) {
    this._filamentPalette = v; // construction-time only
  }
  get loaders(): readonly ModelLoader[] | undefined {
    return this._loaders;
  }
  set loaders(v: readonly ModelLoader[] | undefined) {
    this._loaders = v; // construction-time only
  }
  get createRenderer(): ((canvas: RenderTargetCanvas) => GLRendererLike) | undefined {
    return this._createRenderer;
  }
  set createRenderer(v: ((canvas: RenderTargetCanvas) => GLRendererLike) | undefined) {
    this._createRenderer = v; // construction-time only
  }
  get createControls(): NonNullable<InteractiveStageOptions['createControls']> | undefined {
    return this._createControls;
  }
  set createControls(v: NonNullable<InteractiveStageOptions['createControls']> | undefined) {
    this._createControls = v; // construction-time only
  }

  // ---- scalar attribute accessors ----
  get view(): string | null {
    return this.getAttribute('view');
  }
  set view(v: string | null) {
    assertEnum('view', CAMERA_VIEWS, v);
    if (v === null) this.removeAttribute('view');
    else this.setAttribute('view', v);
  }
  get interactionQuality(): string | null {
    return this.getAttribute('interaction-quality');
  }
  set interactionQuality(v: string | null) {
    assertEnum('interactionQuality', INTERACTION_QUALITIES, v);
    if (v === null) this.removeAttribute('interaction-quality');
    else this.setAttribute('interaction-quality', v);
  }
  get cameraMode(): string | null {
    return this.getAttribute('camera-mode');
  }
  set cameraMode(v: string | null) {
    assertEnum('cameraMode', CAMERA_MODES, v);
    if (v === null) this.removeAttribute('camera-mode');
    else this.setAttribute('camera-mode', v);
  }
  /**
   * Build-volume wireframe cage over the plate (the plate, grid and shadow stay). Default `true`;
   * `show-volume-cage="false"` hides it, as on `<gcode-preview>`. Reflects the attribute.
   */
  get showVolumeCage(): boolean {
    return this.getAttribute('show-volume-cage') !== 'false';
  }
  set showVolumeCage(v: boolean) {
    this.setAttribute('show-volume-cage', v ? 'true' : 'false');
  }

  // ---- handle passthrough (parity with the other adapters) ----
  get state(): ModelPreviewState {
    return this.requireController().getState();
  }
  get controls(): ModelPreviewControls {
    return this.requireController().controls;
  }
  get raw(): { viewer: () => ModelViewer | null } {
    return this.requireController().raw;
  }
  setSource(input: ModelSourceInput): Promise<import('@chestnutlabs/gcode-model-renderer').ModelReadyInfo> {
    return this.requireController().controls.setSource(input);
  }
  capture(opts?: CaptureOptions): Promise<Blob> {
    // Before connect there is no canvas: reject like the controller does, never a synchronous throw.
    if (this.controller === null) return Promise.reject(new CaptureUnsupportedError('no canvas bound (not connected)'));
    return this.controller.controls.capture(opts);
  }
  onEvent(cb: (e: ModelViewerEvent) => void): () => void {
    return this.requireController().onEvent(cb);
  }

  // ---- lifecycle ----
  connectedCallback(): void {
    if (this.controller !== null) return;
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.replaceChildren();
    const style = document.createElement('style');
    style.textContent = ':host{display:block;width:100%;height:100%}canvas{display:block;width:100%;height:100%}';
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', '3D source-model preview');
    canvas.setAttribute('tabindex', '0');
    root.append(style, canvas);
    this.canvasEl = canvas;

    // The last valid `background` / `camera-fov` / `pixel-ratio`, from the property or the attribute callback.
    // Fall back to the attribute itself (recorded, so the getter reports it) for DOMs that skip the attribute
    // callbacks when upgrading parsed markup (happy-dom). An invalid attribute is ignored, never thrown.
    const bg = (this._background ??= this.getAttribute('background') ?? undefined);
    const fov = (this._cameraFov ??= parseFovAttribute(this.getAttribute('camera-fov')));
    const pixelRatio = (this._pixelRatio ??= parsePixelRatioAttribute(this.getAttribute('pixel-ratio')));
    const interactionQuality = pickEnum(INTERACTION_QUALITIES, this.getAttribute('interaction-quality'));
    const cameraMode = pickEnum(CAMERA_MODES, this.getAttribute('camera-mode'));
    this.controller = createModelPreviewController({
      ...(this._buildVolume !== null ? { buildVolume: this._buildVolume } : {}),
      ...(this._theme !== undefined ? { theme: this._theme } : {}),
      showVolumeCage: this.showVolumeCage,
      ...(fov !== undefined ? { cameraFov: fov } : {}),
      ...(pixelRatio !== undefined ? { pixelRatio } : {}),
      ...(this._loaders ? { loaders: this._loaders } : {}),
      ...(bg !== undefined ? { background: bg } : {}),
      // An enum attribute that is not exactly one of its values is bad markup: ignored (the default), never a throw.
      ...(interactionQuality !== undefined ? { interactionQuality } : {}),
      ...(cameraMode !== undefined ? { cameraMode } : {}),
      ...(this._limits ? { limits: this._limits } : {}),
      ...(this._filamentPalette ? { filamentPalette: this._filamentPalette } : {}),
      ...(this._renderScope ? { renderScope: this._renderScope } : {}),
      ...(this._createRenderer ? { createRenderer: this._createRenderer } : {}),
      ...(this._createControls ? { createControls: this._createControls } : {}),
      onProgress: (p) => this.dispatchEvent(new CustomEvent('progress', { detail: p }))
    });
    this.controller.onEvent((e) => this.reemit(e));
    this.controller.bindCanvas(canvas);
    // Apply runtime-only state that isn't a construction option.
    const view = pickEnum(CAMERA_VIEWS, this.getAttribute('view'));
    if (view !== undefined) this.controller.controls.setView(view);
    if (this._cameraState !== null) this.controller.controls.setCameraState(this._cameraState);
    if (this._source !== null) void this.controller.controls.setSource(this._source);
  }

  disconnectedCallback(): void {
    this.controller?.dispose();
    this.controller = null;
    this.canvasEl = null;
    this.shadowRoot?.replaceChildren();
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    // `background`, `camera-fov` and `pixel-ratio` are not reflected, so record each valid value even while
    // disconnected (markup, or a change before a reconnect): the getter reports it and connect applies it.
    // Invalid (or removed) ⇒ ignored and the last valid value kept; attribute callbacks must not throw.
    const fov = name === 'camera-fov' ? parseFovAttribute(value) : undefined;
    const ratio = name === 'pixel-ratio' ? parsePixelRatioAttribute(value) : undefined;
    if (name === 'background' && value !== null) this._background = value;
    if (fov !== undefined) this._cameraFov = fov;
    if (ratio !== undefined) this._pixelRatio = ratio;
    if (this.controller === null) return;
    const c = this.controller.controls;
    switch (name) {
      case 'view': {
        const v = pickEnum(CAMERA_VIEWS, value);
        if (v !== undefined) c.setView(v);
        break;
      }
      case 'background':
        if (value !== null) c.setBackground(value);
        break;
      case 'interaction-quality': {
        const v = pickEnum(INTERACTION_QUALITIES, value);
        if (v !== undefined) c.setInteractionQuality(v);
        break;
      }
      case 'camera-mode':
        // Construction-time only (projection switching post-mount is out of scope); no-op at runtime.
        break;
      case 'show-volume-cage':
        c.setBuildVolumeCage(value !== 'false');
        break;
      case 'camera-fov':
        if (fov !== undefined) c.setCameraFov(fov);
        break;
      case 'pixel-ratio':
        if (ratio !== undefined) c.setPixelRatio(ratio);
        break;
      default:
        break;
    }
  }

  private reemit(e: ModelViewerEvent): void {
    const emit = (type: string, detail?: unknown): void => {
      this.dispatchEvent(new CustomEvent(type, { detail }));
    };
    switch (e.type) {
      case 'ready':
        emit('ready', e.info);
        break;
      case 'camera-changed':
        emit('camerachange', e.state);
        break;
      case 'error':
        emit('error', { code: e.code, message: e.message });
        break;
      case 'renderer-unsupported':
        emit('renderer-unsupported', { feature: e.feature, message: e.message });
        break;
      case 'context-lost':
        emit('context-lost');
        break;
      case 'context-restored':
        emit('context-restored');
        break;
      default:
        break;
    }
  }

  private requireController(): ModelPreviewController {
    if (this.controller === null) {
      throw new Error('gcode-model-viewer: not connected to the DOM yet (no controller)');
    }
    return this.controller;
  }
}

/** Register the element (idempotent). Import `.../model/define` for auto-registration. */
export function defineGcodeModelViewer(tag: string = DEFAULT_MODEL_TAG): void {
  if (customElements.get(tag) === undefined) {
    customElements.define(tag, GcodeModelViewerElement);
  }
}
