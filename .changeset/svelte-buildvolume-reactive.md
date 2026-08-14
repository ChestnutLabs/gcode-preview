---
"@chestnutlabs/gcode-preview-svelte": patch
---

Fix: Svelte `buildVolume` is reactive after mount (parity with Vue/React) (#274)

The Svelte shell applied `buildVolume` once at init with no reactive statement, so changing it after
mount was a silent no-op — a cross-adapter parity break (Vue watches it; React re-applies via
`useEffect`). It was the only writable prop missing a `$:` wiring. Now a post-mount `buildVolume`
change re-applies through the handle, matching the other twelve props. A source-invariant test guards
that every writable prop stays reactively wired (the shell has no component-mount harness).
