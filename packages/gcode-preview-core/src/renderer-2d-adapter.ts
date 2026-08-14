/**
 * `LayerView2DRenderer` — adapts the low-resource Canvas 2D renderer
 * (`@chestnutlabs/gcode-renderer-2d`) to the controller's {@link PreviewRenderer} interface
 * (DD-014 D5), so `renderer.mode: '2d'` slots in behind the same seam as the 3D renderer.
 *
 * This is a **static** import of the (tiny, three-free) 2D package. The 3D renderer is loaded
 * on demand in the controller, so a 2D-only bundle never pulls Three.js.
 *
 * Honesty (DD-014 §6/§11): a flat per-layer view cannot represent 3D-only options. Genuine
 * 3D-only requests (camera projection, quality modes) are disclosed via `renderer-unsupported`
 * — never silently faked. Coarser-granularity requests (segment scrub, retraction point markers)
 * are documented no-ops. Nothing is ever drawn that the IR does not contain.
 */
import {
  LayerView2D,
  describe2DDisclosures,
  type ColorMode,
  type LayerProgress,
  type TravelStyle
} from '@chestnutlabs/gcode-renderer-2d';
import type {
  BuildVolumeDef,
  CameraMode,
  CameraState,
  CameraView,
  QualityMode,
  Theme
} from '@chestnutlabs/gcode-renderer-three';
import type { MachineGeometry, MappedProgress, ToolpathIR } from '@chestnutlabs/toolpath-core';
import type { MoveKindToggle, PreviewRenderer, PreviewRendererEvent } from './renderer-interface.js';

export interface LayerView2DRendererOptions {
  colorMode?: ColorMode;
  /** Preceding "ghost" layers drawn beneath the active one (default 1, floor 0). */
  adjacentLayers?: number;
  /** Ghost-layer opacity (default 0.25). */
  ghostOpacity?: number;
  /** Extrusion stroke width in device px (default 1). */
  lineWidth?: number;
  /** Travel style, or false to hide travel (default hidden). */
  travel?: TravelStyle | false;
}

export class LayerView2DRenderer implements PreviewRenderer {
  private readonly view: LayerView2D;
  private ir: ToolpathIR | null = null;
  private readonly listeners = new Set<(e: PreviewRendererEvent) => void>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    opts: LayerView2DRendererOptions = {}
  ) {
    this.view = new LayerView2D(canvas, {
      colorMode: opts.colorMode,
      adjacentLayers: opts.adjacentLayers,
      ghostOpacity: opts.ghostOpacity,
      lineWidth: opts.lineWidth,
      travel: opts.travel
    });
  }

  private emit(e: PreviewRendererEvent): void {
    for (const cb of this.listeners) cb(e);
  }

  private disclose(feature: string, message: string): void {
    this.emit({ type: 'renderer-unsupported', feature, message });
  }

  onEvent(cb: (e: PreviewRendererEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  resize(width: number, height: number): void {
    this.canvas.width = Math.max(1, Math.round(width));
    this.canvas.height = Math.max(1, Math.round(height));
    this.view.render();
  }

  setIR(ir: ToolpathIR): void {
    this.ir = ir;
    this.view.setToolpath(ir);
    this.view.render();
    // Disclose what a flat 2D view cannot faithfully represent (non-planar/CNC), never silently
    // (DD-014 §6/§11) — an honest capability signal on the same channel as 3D-only-option notices.
    for (const message of describe2DDisclosures(ir)) this.disclose('layers', message);
  }

  /** 3D-only progressive preview; the 2D view draws on the final IR (§3 non-goal). */
  appendPartial(): void {
    // Intentional no-op — 2D renders once on setIR; no fabricated partial geometry.
  }

  get layerCount(): number {
    return this.ir?.layers.length ?? 0;
  }

  get segmentCount(): number {
    return this.ir?.segments.count ?? 0;
  }

  setBuildVolume(_def: BuildVolumeDef | MachineGeometry): void {
    // No bed chrome in the 2D layer view (phase 1–3); not an error, simply not drawn.
  }

  setLayerRange(_startLayer: number, endLayer: number): void {
    // A single-layer 2D view shows the TOP of the requested range (the current layer).
    this.view.setLayer(endLayer);
    this.view.render();
  }

  setScrubPosition(_segIndex: number | null): void {
    // Segment-granular scrub is a 3D-clip feature; the 2D view is layer-granular. Documented no-op.
  }

  setKindVisible(kind: MoveKindToggle, visible: boolean): void {
    // extrusion is the point of the 2D view (never hidden); wipe is a 3D-line concern with no
    // distinct 2D representation, so only the travel toggle is meaningful here.
    if (kind !== 'travel') return;
    this.view.setTravel(visible ? { color: 'rgba(120,120,120,0.9)', lineWidth: 0.5 } : false);
    this.view.render();
  }

  setShowRetractions(visible: boolean): void {
    if (visible) this.disclose('retractions', 'Retraction markers are only shown in the 3D renderer.');
  }

  setColorMode(mode: ColorMode): boolean {
    if (!this.isColorModeAvailable(mode.mode)) return false;
    this.view.setColorMode(mode);
    this.view.render();
    return true;
  }

  /** Capability gate mirroring the 3D renderer (DD-001 honesty): unknown channel → unavailable. */
  private isColorModeAvailable(mode: ColorMode['mode']): boolean {
    const caps = this.ir?.header.capabilities;
    if (mode === 'feature') return caps?.['featureRoles'] !== undefined && caps['featureRoles'] !== 'unavailable';
    if (mode === 'colorChange') return caps?.['colorChanges'] !== undefined && caps['colorChanges'] !== 'unavailable';
    if (mode === 'object') return caps?.['objects'] !== undefined && caps['objects'] !== 'unavailable';
    if (mode === 'feedrate') return caps?.['feedrate'] !== 'unavailable';
    return true;
  }

  setQuality(_quality: QualityMode | 'auto'): void {
    this.disclose('quality', 'Quality/geometry modes apply only to the 3D renderer; the 2D view has none.');
  }

  setCameraMode(_mode: CameraMode): void {
    this.disclose('camera', 'Camera projection applies only to the 3D renderer; the 2D view is flat top-down.');
  }

  setView(_view: CameraView): void {
    this.disclose('camera', 'Preset views apply only to the 3D renderer; the 2D view is fixed top-down.');
  }

  getCameraState(): CameraState | null {
    // The flat 2D view has no 3D pose — return null rather than fabricate one (#268, honesty pattern).
    return null;
  }

  setCameraState(_state: CameraState): void {
    this.disclose('camera', 'Camera state applies only to the 3D renderer; the 2D view has no 3D pose.');
  }

  setTheme(_theme: Theme): void {
    // The 2D view uses per-segment colors from the color mode; scene theming is a 3D concern.
  }

  setProgress(p: MappedProgress | null): void {
    const projected: LayerProgress | null = p === null ? null : { segIndex: p.segIndex, layerIndex: p.layerIndex };
    this.view.setProgress(projected);
    this.view.render();
  }

  pickSegment(): number | null {
    // Segment picking is a 3D raycast feature; the 2D layer view has none yet (#184).
    return null;
  }

  frame(): void {
    // The 2D view always auto-fits the whole-model frame; framing is just a redraw.
    this.view.render();
  }

  dispose(): void {
    this.listeners.clear();
    this.view.setToolpath(null);
    this.ir = null;
  }
}
