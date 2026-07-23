# Consumer smoke coverage (DD-003 §4.4/§11, issue #45)

Verifies that a real consumer can instantiate `@chestnutlabs/gcode-parser`'s **default worker path**
(`new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`) and complete a parse
off-thread, in the two environments the maintainer required: **Vite/browser** and **Electron**.

Both apps consume the workspace packages via `file:` dependencies and print/render a machine-readable
verdict (`{"smoke":"PASS", ...}`).

## vite-app

```bash
cd tools/consumer-smoke/vite-app
npm install
npm run build          # Vite emits the package worker as its own chunk (assets/worker-*.js)
npx live-server dist   # open in a browser; #result shows the verdict JSON
```

Evidence (2026-07-22, Vite 6.4.3, Chromium): `smoke: PASS`, 120,001 segments parsed off-thread,
`complete: true`, progress events delivered, transferred `Float32Array` buffers intact,
`sourcePositions: known`.

## electron-app

Loads the **same Vite-built** consumer over a loopback HTTP server in an Electron renderer
(default `webPreferences`, no `nodeIntegration`), polls the verdict, prints
`ELECTRON_SMOKE_RESULT <json>` and exits 0 on PASS.

```bash
cd tools/consumer-smoke/vite-app && npm install && npm run build
cd ../electron-app && npm install
npm run smoke          # exit code 0 == PASS
```

Evidence (2026-07-22, Electron 33.4.11 / win32-x64): `smoke: PASS`, identical verdict to the browser
run, exit 0.

### Known environment quirk (Windows)

Electron's `postinstall` can silently fail to populate `node_modules/electron/dist` while caching a
valid zip (a prior aborted download also poisons `%LOCALAPPDATA%\electron\Cache` as a bogus
"cache hit"). If `npm run smoke` reports *"Electron failed to install correctly"*: delete
`%LOCALAPPDATA%\electron\Cache`, re-run `node node_modules/electron/install.js`, and if `dist/` is
still incomplete, extract the cached `electron-v*-win32-x64.zip` into `node_modules/electron/dist`
manually and write `electron.exe` into `node_modules/electron/path.txt`.

## Notes

- These apps are **evidence harnesses**, not shipped artifacts; they are outside the npm workspace so
  root `npm ci` is unaffected. CI automation of these runs belongs to the release program (E7).
- Build outputs and local installs are gitignored; the lockfiles are committed for reproducibility.
