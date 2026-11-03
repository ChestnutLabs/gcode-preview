# svelte-compat

CI-only harness (issue #444). `@chestnutlabs/gcode-preview-svelte` declares
`peerDependencies.svelte: "^4.0.0 || ^5.0.0"`, but its build is `tsc` plus a raw copy of the `.svelte`
files and its own tests read them as text, so neither major ever compiled or ran them. This harness does:
for **each** of Svelte 4 and Svelte 5 it

1. compiles every shipped `.svelte` (the exports-map entries of the package) for the client **and** the
   server target - errors fail, warnings are printed;
2. mounts `GcodePreview` and `ModelViewer` in happy-dom with that major's API (`new C({target})` on 4,
   `mount()` / `unmount()` on 5) over the package's own stub worker and renderer, and checks the canvas, the
   `ready` event (including a re-parse when the `source` prop changes), and that unmount disposes;
3. asserts that the compiler **and the runtime** that ran the components are the expected major. The
   components live under `packages/`, so a bare `import 'svelte'` there would otherwise resolve to the
   root `node_modules` (Svelte 5 via npm peer auto-install) and silently run Svelte-4-compiled code on the
   Svelte 5 runtime.

```
tools/svelte-compat/
  shared/            tests and vitest wiring used by both legs (plain .mjs, no dependencies of its own)
  svelte4/           package.json + lock + vitest config: svelte ^4.2.20
  svelte5/           package.json + lock + vitest config: svelte ^5
```

Run one leg (needs the root `npm ci` once, so the sibling packages' third-party imports resolve):

```bash
npm ci --prefix tools/svelte-compat/svelte5 && npm test --prefix tools/svelte-compat/svelte5
```

Notes:

- Each leg tests the **latest of its major**, not the `^4.0.0` floor.
- Components are compiled with the leg's own `svelte/compiler` through a 20-line vite transform
  (`shared/base-config.mjs`) rather than `@sveltejs/vite-plugin-svelte`: the plugin ties the vite major to the
  svelte major and would pull an old vite/vitest chain into the Svelte 4 leg.
- Sibling `@chestnutlabs/*` packages resolve from `src/`, like `packages/gcode-preview-svelte/vitest.config.mts`,
  so no package dist build is needed.
- Adding a leg dir or a lockfile: list it in `.github/dependabot.yml` as well.
