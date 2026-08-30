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
  type PresentationView,
  type RenderScope
} from '@chestnutlabs/gcode-model-renderer';
import type {
  CameraMode,
  CameraState,
  CameraView,
  CaptureOptions,
  GLRendererLike,
  InteractiveStageOptions,
  RenderTargetCanvas
} from '@chestnutlabs/gcode-renderer-three';

/** Observed scalar attributes; rich options (source, cameraState, palettes, loaders, injectables) are property-only. */
const OBSERVED = ['view', 'background', 'interaction-quality', 'camera-mode'] as const;

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
    this._renderScope = v;
    this.controller?.controls.setRenderScope(v);
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
    if (v === null) this.removeAttribute('view');
    else this.setAttribute('view', v);
  }
  get interactionQuality(): string | null {
    return this.getAttribute('interaction-quality');
  }
  set interactionQuality(v: string | null) {
    if (v === null) this.removeAttribute('interaction-quality');
    else this.setAttribute('interaction-quality', v);
  }
  get cameraMode(): string | null {
    return this.getAttribute('camera-mode');
  }
  set cameraMode(v: string | null) {
    if (v === null) this.removeAttribute('camera-mode');
    else this.setAttribute('camera-mode', v);
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
    return this.requireController().controls.capture(opts);
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

    const bg = this._background ?? (this.getAttribute('background') as ModelBackground | null) ?? undefined;
    this.controller = createModelPreviewController({
      ...(this._loaders ? { loaders: this._loaders } : {}),
      ...(bg !== undefined ? { background: bg } : {}),
      ...(this.getAttribute('interaction-quality')
        ? { interactionQuality: this.getAttribute('interaction-quality') as 'off' | 'auto' }
        : {}),
      ...(this.getAttribute('camera-mode') ? { cameraMode: this.getAttribute('camera-mode') as CameraMode } : {}),
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
    const view = this.getAttribute('view');
    if (view !== null) this.controller.controls.setView(view as PresentationView | CameraView);
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
    if (this.controller === null) return;
    const c = this.controller.controls;
    switch (name) {
      case 'view':
        if (value !== null) c.setView(value as PresentationView | CameraView);
        break;
      case 'background':
        if (value !== null) c.setBackground(value as ModelBackground);
        break;
      case 'interaction-quality':
        if (value !== null) c.setInteractionQuality(value as 'off' | 'auto');
        break;
      case 'camera-mode':
        // Construction-time only (projection switching post-mount is out of scope); no-op at runtime.
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
