/**
 * Interaction-aware render quality (DD-020, #306/2) — a small, renderer-agnostic controller that
 * reduces render detail (device pixel ratio) while the camera is moving and restores it once the
 * gesture settles. Extracted from the toolpath renderer (DD-021 Phase 0) so the interactive model
 * viewer shares one implementation instead of a parallel copy.
 *
 * It knows nothing about scenes, cameras, or IR — only how to (a) set a pixel ratio and (b) request
 * a render. The owner wires an OrbitControls `'change'` → {@link InteractionQualityController.onFrame}
 * and `'end'` → {@link InteractionQualityController.settle}.
 */

/** Factor is clamped to `[MIN_INTERACTION_FACTOR, 1]`. */
export const MIN_INTERACTION_FACTOR = 0.4;
/** Proactive reduction applied when a gesture starts (then adapted by measured frame time). */
export const DEFAULT_INTERACTION_FACTOR = 0.6;
/** Debounce before restoring full detail after the camera settles. */
export const INTERACTION_SETTLE_MS = 150;
/** Frame slower than this (ms) → step coarser. */
export const INTERACTION_FRAME_BUDGET_HI = 22;
/** Frame comfortably faster than this (ms) → step finer. */
export const INTERACTION_FRAME_BUDGET_LO = 12;
/** Per-frame adjustment to the detail factor. */
export const INTERACTION_FACTOR_STEP = 0.15;

/** What the controller needs from its owner: set a pixel ratio, and request a render. */
export interface InteractionQualityDeps {
  setPixelRatio(ratio: number): void;
  render(): void;
}

/**
 * Reduces render detail during camera interaction and restores it on settle. Off by default — no
 * behavior change until switched to `'auto'`. The detail `factor` is clamped to
 * `[MIN_INTERACTION_FACTOR, 1]` and adapted by a bounded frame-time hysteresis.
 */
export class InteractionQualityController {
  private mode: 'off' | 'auto';
  private basePixelRatio = 1;
  private factor = 1;
  private interacting = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly deps: InteractionQualityDeps,
    mode: 'off' | 'auto' = 'off'
  ) {
    this.mode = mode;
  }

  /** Toggle the mode. `'off'` clears any pending settle and restores full detail immediately. */
  setMode(mode: 'off' | 'auto'): void {
    this.mode = mode;
    if (mode === 'off') {
      this.clearTimer();
      this.interacting = false;
      this.factor = 1;
      this.deps.setPixelRatio(this.basePixelRatio);
    }
  }

  /** OrbitControls `'change'`: render, and (when `'auto'`) reduce detail + adapt to frame time. */
  onFrame(): void {
    if (this.mode !== 'auto') {
      this.deps.render();
      return;
    }
    if (!this.interacting) {
      this.interacting = true;
      this.basePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      this.factor = DEFAULT_INTERACTION_FACTOR; // proactive reduction, then adapt below
    }
    this.clearTimer();
    this.deps.setPixelRatio(this.basePixelRatio * this.factor);
    const t0 = Date.now();
    this.deps.render();
    const dt = Date.now() - t0;
    // Bounded hysteresis: too slow → coarser; comfortably fast → finer. Clamped to [MIN, 1].
    if (dt > INTERACTION_FRAME_BUDGET_HI) {
      this.factor = Math.max(MIN_INTERACTION_FACTOR, this.factor - INTERACTION_FACTOR_STEP);
    } else if (dt < INTERACTION_FRAME_BUDGET_LO) {
      this.factor = Math.min(1, this.factor + INTERACTION_FACTOR_STEP);
    }
  }

  /** OrbitControls `'end'`: restore full detail a short debounce after the camera settles. */
  settle(): void {
    if (this.mode !== 'auto') return;
    this.clearTimer();
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.interacting = false;
      this.factor = 1;
      this.deps.setPixelRatio(this.basePixelRatio);
      this.deps.render();
    }, INTERACTION_SETTLE_MS);
  }

  /** Release the pending settle timer. */
  dispose(): void {
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
  }
}
