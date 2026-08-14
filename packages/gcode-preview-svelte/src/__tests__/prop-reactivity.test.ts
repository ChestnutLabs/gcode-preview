/**
 * Prop-reactivity invariant for the Svelte shell (#274). `buildVolume` shipped as a one-time init
 * call with no `$:` statement, so post-mount changes were a silent no-op — a parity break vs Vue's
 * `watch` and React's `useEffect`. The portable behavioral suite drives `createGcodePreview` (the
 * store), not the `.svelte` component, and the package has no component-mount test harness (its
 * vitest runs in `node` with no Svelte compiler plugin), so this static invariant is the enforceable
 * guard: **every writable prop must be wired into a reactive `$:` block** (or be a documented
 * init-only renderer option that genuinely cannot change after mount).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(fileURLToPath(new URL('../GcodePreview.svelte', import.meta.url)), 'utf8');

/**
 * Props fixed at construction (passed into `createGcodePreview` / renderer options) — they cannot be
 * re-applied after mount, so they are intentionally not reactive. Keep this list tight: a new
 * consumer-facing option that *can* change at runtime must be reactive, not added here.
 */
const INIT_ONLY = new Set(['renderer', 'createWorker', 'rendererOptions', 'adjacentLayers', 'tube']);

describe('Svelte shell prop reactivity (#274)', () => {
  const props = [...SOURCE.matchAll(/export let (\w+)/g)].map((m) => m[1]);
  // Names referenced in a reactive statement: a `$:` line, or the `else` continuation of a
  // `$: if (…) …; else …` pair. Deliberately NOT arbitrary `preview.*` calls — an init-time call
  // (like the old one-time `setBuildVolume`) must not count as reactive, or the guard is toothless.
  const reactiveNames = new Set(
    SOURCE.split('\n')
      .filter((line) => {
        const t = line.trimStart();
        return t.startsWith('$:') || t.startsWith('else ');
      })
      .join('\n')
      .match(/\b\w+\b/g) ?? []
  );

  it('discovers the full prop surface', () => {
    expect(props).toContain('buildVolume');
    expect(props.length).toBeGreaterThan(10);
  });

  it('every writable prop is reactively wired (or a documented init-only option)', () => {
    const nonReactive = props.filter((p) => !INIT_ONLY.has(p) && !reactiveNames.has(p));
    expect(nonReactive).toEqual([]);
  });

  it('buildVolume specifically is reactive (the #274 regression)', () => {
    expect(SOURCE).toMatch(/\$:[^\n]*buildVolume[^\n]*setBuildVolume/);
  });
});
