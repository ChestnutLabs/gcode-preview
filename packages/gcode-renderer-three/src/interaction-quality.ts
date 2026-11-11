/**
 * Interaction-aware render quality (DD-020, #306/2) — a small, renderer-agnostic controller that
 * reduces render detail (pixel ratio) while the camera is moving and restores it once the gesture
 * settles. Extracted from the toolpath renderer (DD-021 Phase 0) so the interactive model viewer
 * shares one implementation instead of a parallel copy.
 *
 * It knows nothing about scenes, cameras, or IR — only how to (a) read and set a pixel ratio, (b)
 * request a render, and (c) schedule an animation frame. The owner wires an OrbitControls `'change'`
 * → {@link InteractionQualityController.onFrame} and `'end'` → {@link InteractionQualityController.settle}.
 *
 * The resting ratio ("base") is the renderer's own ratio, read at the start of each gesture — the
 * controller only ever scales it down transiently and restores exactly it (#435). Adaptation samples
 * the browser's real frame interval (rAF → rAF) while the gesture is rendering, not the CPU time of
 * the synchronous `render()` call, which excludes GPU work and so almost never looked slow (#435).
 */

/** Factor is clamped to `[MIN_INTERACTION_FACTOR, 1]`. */
export const MIN_INTERACTION_FACTOR = 0.4;
/** Proactive reduction applied when a gesture starts (then adapted by measured frame interval). */
export const DEFAULT_INTERACTION_FACTOR = 0.6;
/** Debounce before restoring full detail after the camera settles. */
export const INTERACTION_SETTLE_MS = 150;
/** Frame interval slower than this (ms; a missed 60 Hz vsync) → step coarser. */
export const INTERACTION_FRAME_BUDGET_HI = 22;
/** Frame interval faster than this (ms; keeping up with 60 Hz or better) → step finer. */
export const INTERACTION_FRAME_BUDGET_LO = 18;
/** Consecutive slow (or fast) samples required before one step — one hitch never flips detail. */
export const INTERACTION_STREAK = 3;
/** Consecutive frames with no interaction render that count as a pause: sampling stops, streaks reset. */
export const INTERACTION_PAUSE_FRAMES = 6;
/** Per-step adjustment to the detail factor. */
export const INTERACTION_FACTOR_STEP = 0.15;

/**
 * What the controller needs from its owner: set a pixel ratio and request a render. The optional
 * members default sensibly: `getPixelRatio` → 1, `requestFrame`/`cancelFrame` → the global
 * `requestAnimationFrame`/`cancelAnimationFrame`. With no frame scheduler available the factor stays
 * at its proactive value for the whole gesture (no adaptation). A supplied `requestFrame` is only ever
 * cancelled through `cancelFrame` (never the global one — its handles are foreign); without
 * `cancelFrame`, a late tick from a stopped sampler is ignored (it carries a stale generation).
 */
export interface InteractionQualityDeps {
  setPixelRatio(ratio: number): void;
  render(): void;
  /** The renderer's current (resting) pixel ratio — read at each gesture start. */
  getPixelRatio?(): number;
  /** Schedule `cb` for the next animation frame with a millisecond timestamp; returns a handle. */
  requestFrame?(cb: (timestampMs: number) => void): number;
  /** Cancel a handle returned by `requestFrame`. */
  cancelFrame?(handle: number): void;
}

/**
 * Reduces render detail during camera interaction and restores it on settle. Off by default — no
 * behavior change until switched to `'auto'`. The detail `factor` is clamped to
 * `[MIN_INTERACTION_FACTOR, 1]` and adapted by a bounded frame-interval hysteresis.
 */
export class InteractionQualityController {
  private mode: 'off' | 'auto';
  private basePixelRatio = 1;
  /** The ratio last handed to `setPixelRatio` (or read at gesture start) — skips redundant resizes. */
  private appliedRatio = 1;
  private factor = 1;
  private interacting = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private frameHandle: number | null = null;
  private lastTick: number | null = null;
  private renderedSinceTick = false;
  private emptyFrames = 0;
  /** Bumped on every sampler start/stop; a tick carrying an older value is from a dead loop. */
  private samplerGen = 0;
  private slowStreak = 0;
  private fastStreak = 0;

  constructor(
    private readonly deps: InteractionQualityDeps,
    mode: 'off' | 'auto' = 'off'
  ) {
    this.mode = mode;
  }

  /**
   * Toggle the mode. `'off'` clears any pending settle and, if a gesture had reduced detail, restores
   * the resting ratio immediately; otherwise it leaves the renderer's pixel ratio untouched.
   */
  setMode(mode: 'off' | 'auto'): void {
    this.mode = mode;
    if (mode === 'off') {
      this.clearTimer();
      if (this.interacting) this.restore();
    }
  }

  /** OrbitControls `'change'`: render, and (when `'auto'`) reduce detail + adapt to frame interval. */
  onFrame(): void {
    if (this.mode !== 'auto') {
      this.deps.render();
      return;
    }
    if (!this.interacting) {
      this.interacting = true;
      this.basePixelRatio = this.deps.getPixelRatio?.() ?? 1;
      this.appliedRatio = this.basePixelRatio;
      this.factor = DEFAULT_INTERACTION_FACTOR; // proactive reduction, then adapt by frame interval
      this.slowStreak = 0;
      this.fastStreak = 0;
    }
    this.clearTimer();
    this.applyRatio(this.basePixelRatio * this.factor);
    this.deps.render();
    this.renderedSinceTick = true;
    this.startSampling();
  }

  /** OrbitControls `'end'`: restore full detail a short debounce after the camera settles. */
  settle(): void {
    if (this.mode !== 'auto') return;
    this.clearTimer();
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.restore();
    }, INTERACTION_SETTLE_MS);
  }

  /** Release the pending settle timer and stop frame sampling. */
  dispose(): void {
    this.clearTimer();
    this.stopSampling();
  }

  /** End the gesture: back to the resting ratio, full detail, one repaint. */
  private restore(): void {
    this.stopSampling();
    this.interacting = false;
    this.factor = 1;
    this.applyRatio(this.basePixelRatio);
    this.deps.render();
  }

  private applyRatio(ratio: number): void {
    if (ratio === this.appliedRatio) return;
    this.appliedRatio = ratio;
    this.deps.setPixelRatio(ratio);
  }

  private requestFrame(cb: (t: number) => void): number | null {
    if (this.deps.requestFrame) return this.deps.requestFrame(cb);
    if (typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(cb);
    return null; // no scheduler → no adaptation; the proactive factor holds for the gesture
  }

  /** Start the rAF sampler if it is not already running. Its first tick only sets the baseline. */
  private startSampling(): void {
    if (this.frameHandle !== null) return;
    this.lastTick = null;
    this.schedule(++this.samplerGen);
  }

  private schedule(gen: number): void {
    this.frameHandle = this.requestFrame((t) => this.tick(t, gen));
  }

  private stopSampling(): void {
    this.samplerGen++;
    if (this.frameHandle !== null) {
      if (this.deps.requestFrame) this.deps.cancelFrame?.(this.frameHandle);
      else if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.lastTick = null;
  }

  private tick(t: number, gen: number): void {
    // A stale tick (its loop was stopped but could not be cancelled — an injected `requestFrame` with no
    // `cancelFrame`) must neither measure nor re-arm, or a restarted gesture would run two loops.
    if (gen !== this.samplerGen) return;
    this.frameHandle = null;
    // A frame with no interaction render (input slower than the display, e.g. 60 Hz input on a 120 Hz
    // screen) is not a measurement: re-baseline, so every sampled interval spans exactly one frame that
    // rendered, and keep the streaks. Only a run of empty frames is a real pause: stop and reset; the
    // next `onFrame` restarts the sampler with a fresh baseline.
    if (!this.renderedSinceTick) {
      if (++this.emptyFrames >= INTERACTION_PAUSE_FRAMES) {
        this.lastTick = null;
        this.slowStreak = 0;
        this.fastStreak = 0;
        return;
      }
      this.lastTick = t;
      this.schedule(gen);
      return;
    }
    this.emptyFrames = 0;
    this.renderedSinceTick = false;
    if (this.lastTick !== null) this.sample(t - this.lastTick);
    this.lastTick = t;
    this.schedule(gen);
  }

  /** Bounded hysteresis: a streak of slow intervals → coarser; of fast ones → finer. Clamped to [MIN, 1]. */
  private sample(dt: number): void {
    if (dt > INTERACTION_FRAME_BUDGET_HI) {
      this.fastStreak = 0;
      if (++this.slowStreak >= INTERACTION_STREAK) {
        this.slowStreak = 0;
        this.factor = Math.max(MIN_INTERACTION_FACTOR, this.factor - INTERACTION_FACTOR_STEP);
      }
    } else if (dt < INTERACTION_FRAME_BUDGET_LO) {
      this.slowStreak = 0;
      if (++this.fastStreak >= INTERACTION_STREAK) {
        this.fastStreak = 0;
        this.factor = Math.min(1, this.factor + INTERACTION_FACTOR_STEP);
      }
    } else {
      this.slowStreak = 0;
      this.fastStreak = 0;
    }
  }

  private clearTimer(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
  }
}
