# AnyBridge Handoff — G-code Viewer Deferral

**Prepared:** 2026-07-22

## Ready-to-paste response to the main AnyBridge session

> I agree the interactive layer/toolpath viewer should not be implemented as part of #593. Keep
> #593 focused on the bounded header/classification and dispatch-safety work: fit/Z, target
> mismatch, and capability warnings. Those checks should continue without waiting for the viewer.
>
> The viewer is now being planned as a separate Chestnut Labs project:
> `chestnutlabs/gcode-preview`, beginning as a public fork of `xyz-tools/gcode-preview`. It will own
> the reusable parser, dialect/container handling, normalized `ToolpathIR`, worker/large-file
> pipeline, Three.js renderer, layer/source scrubbing, and a Vue integration package. AnyBridge will
> remain the first consumer and will own file/job access, printer telemetry normalization,
> permissions, safety decisions, and the VueKit application UI.
>
> Please create or defer a dedicated AnyBridge integration issue/Epic for the 3D G-code viewer,
> link it as related to #593 and #581, and mark it blocked on the Chestnut Labs viewer's first
> consumable contract/release. Do not build a throwaway 2D viewer inside AnyBridge; a future
> low-resource 2D layer mode should use the same shared `ToolpathIR` architecture.
>
> For the new AnyBridge tracking item, keep requirements at the integration level only:
> select/load the relevant job file, embed the shared viewer, provide printer/build-volume context,
> translate available telemetry into exact/derived/approximate progress, and degrade honestly when
> the file or exact position is unavailable. The viewer project's own parser/renderer work should
> not be duplicated in AnyBridge.
>
> Once that tracking item is filed/linked, leave it deferred and continue to #594.

## Suggested AnyBridge tracking title

**Epic: Integrate Chestnut Labs 3D G-code Toolpath Viewer**

## Suggested relationship note

- Related to `#593`: the viewer provides visual inspection, while `#593` owns blocking
  classification/safety warnings.
- Related to `#581`: toolpath/thumbnail rendering concerns move to the shared viewer project where
  applicable.
- Blocked by the Chestnut Labs viewer's accepted consumer contract and first integration-ready
  package release.

## What should not be placed in the AnyBridge issue

- raw G-code parser implementation;
- dialect/plugin architecture;
- worker protocol or large-file memory architecture;
- Three.js geometry implementation;
- `.gcode.3mf` extraction implementation;
- toolpath package release management.

Those belong in `chestnutlabs/gcode-preview`.

