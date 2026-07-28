# @chestnutlabs/toolpath-core

Neutral **`ToolpathIR`** and **capability model** for the Chestnut Labs G-code Preview toolpath stack.
This is the replacement seam for the whole stack: the parser **writes** it, renderers and analyzers **read**
it. See [`docs/design/DD-001`](https://github.com/ChestnutLabs/gcode-preview/blob/dev/docs/design/DD-001-toolpath-ir-and-capability-model.md).

**Design rules**

- The canonical IR is plain, **transferable** data — a small header plus **structure-of-arrays typed
  buffers** (not object graphs). Positions are `Float32` deltas relative to a `Float64` `originOffset`
  (floating origin, DD-001 §4.6).
- **Unknown is a valid state.** Optional/derived data carries a `Confidence`
  (`known | inferred | approximated | unavailable`); missing values are sentinels (`NaN`, `0`), never
  fabricated data.
- This package depends on **nothing** — no `three`, DOM, Vue, or AnyBridge (DD-002 boundary).

**Contents (scaffold)**

- `ir.ts` — `ToolpathIR`, header, segments (SoA), layers/tools/objects, capabilities, `MoveKind`,
  `FeatureRole`, `IR_SCHEMA_VERSION`.
- `builder.ts` — `ToolpathIRBuilder` (accumulate segments → canonical typed-array IR).
- `source-index.ts` — `buildSourceIndex` / `segmentAtByte` (byte offset → segment; live-progress input).
- `bounds.ts` — extrude-only and travel-inclusive bounds.

```bash
npm run build      -w @chestnutlabs/toolpath-core   # tsc -> dist
npm run typecheck  -w @chestnutlabs/toolpath-core
npm test           -w @chestnutlabs/toolpath-core
```

> Status: **scaffold** (E1, issue #32). The builder accumulates into number arrays and converts to typed
> arrays in `finalize()`; E2's worker parser will write directly into growable typed buffers. Package
> extraction/publish is gated by DD-002 §7 and the release DD (E7/DD-008).
