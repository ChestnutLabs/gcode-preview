/**
 * Staged loading-progress contract (DD-024) — shared by the model and toolpath render paths.
 *
 * The contract is **typed and consumer-neutral**: an event carries a machine-readable stage + real count
 * (or an honest indeterminate), and NO human-facing copy — the consumer owns all wording/i18n. A count is
 * present only when the pipeline genuinely knows it; a stage with an unknown total is `indeterminate`, never
 * a fabricated percentage (DD-024 §3/§6). Every event carries the `generation` of its load so a consumer
 * can drop events from a superseded/cancelled load (DD-024 §4 D5).
 */

/** The observable stages of a load (DD-024 §4 D1). Not every source hits every stage. */
export type LoadStage =
  | 'parsing'
  | 'reading-structure'
  | 'decoding-material'
  | 'processing-objects'
  | 'building-geometry'
  | 'preparing-scene'
  | 'ready';

/**
 * The typed unit a stage's `{done,total}` counts (DD-024 §4 D2) — a machine enum, never a display label.
 * `'meshes'`/`'chunks'` on `preparing-scene` count GPU **submissions**, not measured upload completion.
 */
export type LoadUnit = 'bytes' | 'segments' | 'objects' | 'components' | 'placements' | 'meshes' | 'chunks';

/** One staged loading-progress event (DD-024). Typed fields only — no human copy. */
export interface LoadProgress {
  stage: LoadStage;
  /** Real progress count within the stage; present only with `total` and a real quantity. */
  done?: number;
  /** Real total for the stage; omitted when unknown (then `indeterminate` is set). */
  total?: number;
  /** The unit `done`/`total` count. */
  unit?: LoadUnit;
  /** The stage is real but has no meaningful total yet — the consumer shows activity, not a bar. */
  indeterminate?: boolean;
  /** The load/generation this event belongs to (DD-024 §4 D5); a consumer drops stale generations. */
  generation: number;
}
