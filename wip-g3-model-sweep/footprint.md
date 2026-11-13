# G3 footprint: gcode-model-renderer controller/viewer sweep (base RED + probe)

Worktree `C:/cl-scratch-hot/g3/model-sweep` (branch `test/model-renderer-sweep`, base origin/dev d895700a, real npm ci).
Files: model-preview.ts, model-viewer.ts, render-model-still.ts, cache-key.ts, model-content.ts, scene-model.ts.
Harness `F:/ab-scratch/g3/model-sweep/red.py` (whole package suite per mutant, fresh backup), log `red-base.log`.
Probe (pristine source) `probe.test.ts`, output `probe.out`.

## Details

**Base RED: 219/242 killed, control green, 0 INVALID, 0 HANG.** The 23 survivors:

| Group | Mutants | What's missing |
|---|---|---|
| Test gap: checked "before any work" | V02, V03 (viewer ctor theme/fov), V48 (setCameraFov check with no stage), S11 (still fov check before parse) | The later layers re-check, so only the ordering is untested. Assert no `createRenderer` / loader call on a bad value; assert `setCameraFov(5)` throws on an unsupported (stage-less) viewer. |
| Test gap: viewer behaviour | V12 (`interactionQuality` default 'auto'), V15 + V18 (context-restored rebuilds the meshes and emits), V23 ('model viewer is disposed' message), V46 (`setTheme` reaches the plate), V59 (`capture` on an unsupported viewer is `CaptureUnsupportedError`), V61 (double dispose disposes the GL once) | Literal-value tests. |
| Test gap: still | S08, S09 (size defaults to the canvas), S17 (`preserveDrawingBuffer: true` reaches the default GL; needs vi.mock), S18 (`resize(w,h)` reaches setSize), S34 (`objectCount` is the scoped count) | Literal-value tests. |
| Test gap: cache key | K02 (a char ≥ 0x80: `'é'` vs `'i'` envId must key apart), K16 + K17 (two scenes differing only in `bounds` / `capabilities` key apart) | Collision tests. |
| Equivalent | P03 (`buildVolume ?? null` vs undefined: the only reader is `engineOptions`' `!== null` spread, and the viewer does `?? null` again). P75 (controller double dispose: every step is already a no-op the second time). K05 (`typedHash(undefined)` = null vs '00000000': differs only if a real FNV hash is exactly 0, a 2^-32 collision) | Proofs in the PR body; the code stays. |
| Not equivalent: shows a defect | P77 (`pendingOps.length = 0` in dispose) | It survives because `setView` / `setCameraState` / `frame` / `resize` still push to `pendingOps` AFTER dispose. That queue is never drained, so it grows without bound (D4). |

**Probe findings (pristine source):**

- **D1 (P2): a throwing listener fails a good load.** An `onStateChange` callback or an engine `onEvent` callback that throws during `ready` makes `setSource` reject. It also emits `error E_MODEL_PARSE "<listener's message>"` and leaves `state.ready: false` with the model drawn. Cause: `mutate`/`emit` call listeners inline, and the engine's `emit({type:'ready'})` sits inside setSource's try. Core fixed the same class in #542 (`notifyAll` + queueMicrotask rethrow).
- **D2 (P2): a bad queued op throws out of `bindCanvas`.** Before bind, `setView(null|undefined|'bogus')` and `setCameraState(null)` are queued without a check. At bind they throw (`TypeError: VIEW_DIRECTIONS[view] is not iterable` / `RangeError: camera state must be an object`) out of `bindCanvas`. That skips the remaining ops, `pendingOps.length = 0` and the replay of `lastSource`: the model never loads, and in React/Vue the throw lands inside a ref callback or effect. Core's analogue is #542 `E_CONTROL_REJECTED`.
- **D3 (P2): null/undefined isn't "unset" (the #590 rule).**
  - **ctor `null` throws RangeError:** `cameraFov`, `pixelRatio` and `renderScope` on the controller and the viewer; `cameraFov` and `renderScope` on `renderModelStill`.
  - **setters:**
    - `setCameraFov` and `setPixelRatio` throw on null AND undefined.
    - `setRenderScope(undefined)` throws (null is fine).
    - `setBuildVolume(undefined)`, once bound, is a `TypeError: reading 'min'` from the plate (unbound it's fine).
  - **Reachable from consumers:**
    - Vue: the model component guards only `!== undefined`, so `:camera-fov="null"` / `:pixel-ratio="null"` reach these, at mount and in watchers.
    - React: the same guard, so plain JS can pass null.
    - Element: guards undefined only, so `el.cameraFov = null` throws RangeError.
- **D4 (P3):** controls called after `dispose()` push to `pendingOps` forever (see P77).
- **D5 (decision):**
  - A superseded or disposed-mid-load `setSource` **resolves** with that load's info (objectCount etc.) though nothing was shown. Docs say only "last-wins". Core rejects a superseded parse (CancelledError).
  - With the controller disposed mid-load, the caller's promise resolves and `state.loading` stays `true`.
  - A `setSource` after `bindCanvas(null)` waits until the next bind (that one matches the docs).
- **Not a finding:** a pre-built `ModelScene` skips `limits` in the still and the viewer. `limits` caps hostile source bytes, and a consumer-built scene is trusted (DD-018). Pinned only if you want it.
- Cache-key collisions: none found beyond K02/K16/K17 (all test gaps; the code is right). Scope `{objectIds, plateId: undefined}` keys like `{objectIds}`, as designed.

## Options

- **(a) Tests only.** Close the 20 test gaps; equivalents get proofs; D1–D5 are filed as follow-ups. Smallest PR, but it leaves two P2 crash paths open.
- **(b) Tests + fix D1, D2 and D4 in model-preview.ts / model-viewer.ts.**
  - Isolate listeners, as core's `notifyAll` does (a throw is rethrown in a microtask and never fails the load).
  - Replay queued ops one by one with try/catch → state.error + an `error` event `E_CONTROL_REJECTED` "<control> rejected: <msg>" (core's code and wording), then carry on with the remaining ops + source replay.
  - Ignore controls after dispose (no queueing).
  - D3 and D5 stay as follow-ups.
- **(c) = (b) + D3: null/undefined = unset in model-renderer only** (no adapter edits; #590's rule).
  - **ctor:** `cameraFov`/`pixelRatio`/`renderScope` `!= null`, checked only when set.
  - **setters:** `setCameraFov(null|undefined)` → the default 50; `setPixelRatio(null|undefined)` → back to 1 / unset; `setRenderScope(undefined)` = null (whole source); `setBuildVolume(undefined)` = null (no plate).
  - **renderModelStill:** `cameraFov`/`renderScope` null = unset.
  - Same in the viewer, so the four adapters inherit it.
  - D5 is still a follow-up.
- **(d) = (c) + D5:** a superseded / disposed `setSource` rejects (`E_MODEL_SUPERSEDED` / `E_MODEL_PREVIEW_DISPOSED`), and dispose sets `loading: false`. This changes a public promise contract (callers that await an older load now see a rejection), so it needs an owner/AB look.

## Recommendation

**(c).** D1 and D2 turn a consumer bug or an unset prop into a dead viewer; D3 is the same rule the lead just applied to core in #590, and Vue's `:camera-fov="null"` reaches it today. All three are model-renderer-only, so there are no seams with #590/#601/#588 or the React sweep. They follow core's precedent (same code, same message format), so the adapters need no change. D5 is a contract change → follow-up for the owner. Changeset: patch, consumer-first ("null now means unset", "a throwing listener no longer fails a load", "a bad queued call is reported as E_CONTROL_REJECTED instead of throwing from bindCanvas").
- Expected size: about 60 src lines over 3 files + 2 test files (`model-preview-sweep4.test.ts`, `model-viewer-sweep4.test.ts`) + a `render-model-still` test + a changeset.
- RED: every new clause, plus re-running the 23 survivors → aim for 0 survivors bar the 3 proven equivalents.
- Gate `npm run gate`. That's no `--ci` (no exports, package.json or testing.ts change); I'll run `--ci` if the lead prefers, since model-testing.ts is the portable suite.

## One step further

Add a portable case to `model-testing.ts`: "a throwing onStateChange / event listener does not fail a load" and "a null lens / pixel ratio prop is unset". That way all four adapters are pinned and DD-031 parity Q5 is answered by a test, not by inheritance.

**Assessment: follow-up (P2).** model-testing.ts is the shared portable suite, so it needs `gate -- --ci` plus both svelte-compat legs, and it may collide with G2's guards work. It's valuable, but the controller tests already pin the behaviour the adapters inherit.

## Follow-ups (max 3)

- P2: D5, superseded/disposed `setSource` contract (resolve vs reject, `loading` after dispose): owner/AB decision.
- P2: portable model-testing.ts cases for D1/D3 (the OSF above).
- P3: Vue/React model adapters guard `!== undefined` only. Once (c) lands that's harmless, but they could adopt `!= null` when their lanes next touch those files.
