# G-code viewer demo (DD-004 phase 3, issue #58)

The first end-to-end demo of the Chestnut pipeline: **`GcodeParseSession`** parses off-thread in the
package's default module worker (zero-copy IR transfer) and hands the `ToolpathIR` to
**`ToolpathRenderer`** (incremental chunk upload, draw-range layer clipping and scrub, capability-honest
color modes, decimation disclosure). Built on the consumer-smoke Vite harness pattern
(`tools/consumer-smoke/vite-app`) — the packages are consumed via `file:` installs exactly as an
external consumer would.

```sh
cd tools/demo
npm install
npm run dev     # http://localhost:5199
```

The fixture picker serves the inherited MIT demo corpus (`demo/gcodes/`, tracked in
`test-data/manifest.json`) via Vite's `publicDir` — nothing is copied or duplicated. Any local
G-code file can be loaded through the file input (parsed as a `Blob` through the same worker path).

## Keyboard operability (master plan §9.5)

Every control is labeled and tab-reachable; the sliders take arrow and page keys natively.
App-level shortcuts (active when focus is not inside a form control):

| Key | Action |
|---|---|
| `[` / `]` | last visible layer − / + |
| `,` / `.` | scrub − / + (1% steps) |
| `t` | toggle travel moves |
| `f` | frame the model |

## Honesty behaviors to look for

- **Decimation disclosure:** on IRs over the §4.4 thresholds a yellow notice states the exact
  reduction factor and that travel is hidden — degradation is never silent.
- **Capability gating:** the "By feature role" color mode is disabled (with the reason) when the IR
  reports `featureRoles: unavailable` — the current parser does, so the option shows *why* rather
  than rendering fabricated colors.
- **Partial results:** a limit-bounded parse renders what was produced and labels it
  `INCOMPLETE` with the structured `stopReason`.
