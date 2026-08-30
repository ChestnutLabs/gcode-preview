/*
 * demo-kit/format — small presentation helpers shared across the Feature Lab and examples so numbers,
 * times, and honesty phrasing read the same everywhere (DD-031 §21 — reusable formatting).
 */

/** Compact integer with thousands separators. */
export function count(n) {
  return Number(n).toLocaleString();
}

/** ms → "1h 04m", "3m 12s", "45s" — for print-time estimates. */
export function duration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

/** bytes → "3.7 MB" / "635 KB". */
export function bytes(n) {
  if (n == null) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}

/** Provenance note for a time estimate: slicer's own vs a kinematic approximation. */
export function timeSourceNote(source) {
  if (source === 'slicer') return "the slicer's own estimate";
  if (source === 'kinematic') return 'a kinematic approximation (constant-velocity, slightly low)';
  return '';
}
