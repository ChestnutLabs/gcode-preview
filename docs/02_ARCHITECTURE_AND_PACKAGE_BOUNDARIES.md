# Chestnut Labs G-code Preview — Architecture & Package Boundaries

**Status:** Founding constraints pending Epic DDs · **Version:** 0.1  
**Prepared:** 2026-07-22

This document prevents the new project from becoming an AnyBridge subfolder in everything but
name. It defines initial ownership, dependency direction, and separation of concerns. Detailed
data structures and APIs are decided by Epic-level DDs.

---

## 1. Core rule

> `chestnutlabs/gcode-preview` may provide packages to AnyBridge, but no reusable toolpath package
> may import AnyBridge or require an AnyBridge runtime.

This is a separate repository and a possible toolpath monorepo. It is not physically inside the
AnyBridge monorepo and is not a Git submodule of AnyBridge.

---

## 2. Responsibility map

| Concern | G-code Preview project | AnyBridge |
|---|---:|---:|
| Raw G-code parser/state machine | Owns | Consumes |
| Slicer/firmware metadata dialects | Owns | May consume results |
| `.gcode.3mf` and supported container extraction | Owns | Supplies bytes/file handles |
| `ToolpathIR` | Owns and versions | Consumes |
| Three.js toolpath rendering | Owns | Embeds |
| Layer/range/source scrubbing | Owns | Composes into application |
| Framework-neutral viewer API | Owns | Consumes |
| Vue wrapper | Owns reusable component boundary | Wraps with VueKit/product UI |
| Printer discovery/protocols | Never | Owns |
| File authorization/download/caching | Never | Owns |
| Job-to-file matching | Never | Owns |
| Fit/Z/mismatch/safety gates | Never | Owns |
| Permissions and control actions | Never | Owns |
| Telemetry normalization | Defines display input contract only | Owns protocol translation |
| Dispatch/re-slice workflow | Never | Owns |

---

## 3. Layered architecture

```text
Layer 7  AnyBridge / other consumer application
         - protocols, permissions, workflows, job/file identity

Layer 6  Framework integration
         - gcode-preview-vue

Layer 5  Viewer facade
         - renderer lifecycle, camera, layer controls, progress overlay

Layer 4  Renderer(s)
         - Three.js 3D renderer
         - later optional 2D layer renderer

Layer 3  ToolpathIR and indexes
         - normalized data, capabilities, source lookup

Layer 2  Parser and dialect adapters
         - generic machine state + slicer/firmware metadata

Layer 1  Container/input adapters
         - plain stream/file, .gcode.3mf, future formats
```

Dependencies point downward. Lower layers must not import higher layers. Rendering must not parse
raw G-code, and dialect adapters must not manipulate UI state.

---

## 4. Proposed packages

Package extraction is phased. The E1 package DD may combine packages until boundaries prove useful.

### `@chestnutlabs/toolpath-core`

Owns:

- `ToolpathIR` contracts and version markers;
- compact segment/layer/tool/object data;
- capability, warning, confidence, and source-position types;
- shared math/units primitives that do not depend on Three.js;
- validation utilities and compatibility helpers.

Must not depend on DOM, Vue, Three.js, archive libraries, or AnyBridge.

### `@chestnutlabs/gcode-parser`

Owns:

- generic tokenization and stateful command interpretation;
- worker protocol/client;
- incremental input, progress, cancellation, and limits;
- conversion to `ToolpathIR`;
- parser diagnostics.

It may depend on `toolpath-core` and approved dialect contracts. It must not render.

### `@chestnutlabs/gcode-dialects`

Owns:

- metadata/comment recognition for slicer/firmware families;
- layer/object/feature/tool/material markers;
- declared dialect capabilities and evidence fixtures;
- plugin/adapter registry.

Generic G0/G1/G2/G3 and machine-state rules remain in the parser. Do not create a vendor adapter
merely because one vendor emits standard commands.

### `@chestnutlabs/gcode-containers`

Owns:

- input sniffing and supported container selection;
- safe extraction of G-code and allowed metadata from `.gcode.3mf`;
- archive/resource limits and structured extraction warnings;
- future container extension points.

It must not download files or access printer networks.

### `@chestnutlabs/gcode-renderer-three`

Owns:

- Three.js scene/resource lifecycle;
- toolpath geometry and material strategies;
- layer/range clipping;
- build-volume, travel, toolhead, and progress visualization;
- camera-neutral render controls and quality modes;
- WebGL context recovery and cleanup.

It consumes `ToolpathIR` and does not parse text.

### `@chestnutlabs/gcode-preview`

Owns:

- framework-neutral orchestration facade;
- load/cancel/state lifecycle;
- parser/renderer coordination;
- layer and source scrub APIs;
- normalized progress overlay input;
- capability and error events.

It must allow advanced consumers to use lower packages directly.

### `@chestnutlabs/gcode-preview-vue`

Owns:

- thin Vue components/composables around the framework-neutral API;
- lifecycle-safe mounting/unmounting;
- accessible reusable controls when truly generic.

It does not import VueKit, Pinia, AnyBridge stores, printer adapters, or application routes.

---

## 5. `ToolpathIR` boundary

`ToolpathIR` is the central replacement seam. The parser writes it; renderers and analyzers read it.

### Required semantic areas

- document metadata and provenance;
- coordinate/unit/extrusion state summary;
- ordered movements and segment buffers;
- layers and Z ranges;
- tool/material/color changes;
- feature and object annotations;
- travel, extrusion, retraction, wipe, seam, and other movement kinds as supported;
- spatial bounds;
- source byte/line/command positions;
- warnings, unsupported constructs, and capability quality;
- optional values such as width, height, speed, flow, temperature, fan, and estimated time.

### Rules

- Unknown is a valid state and must not be represented as a fabricated zero/default.
- Inferred/approximate values are distinguishable from directly declared values.
- The renderer may create private GPU buffers/caches but cannot mutate the canonical IR.
- Serialized/persisted IR requires an explicit schema version and migration/invalidating policy.
- Internal in-memory layouts may evolve faster until a persistence DD approves storage.

---

## 6. Dialect model

“Dialect” includes two related but distinct sources:

1. **Machine command semantics** — common G-code families and firmware behaviors.
2. **Slicer metadata conventions** — comments/markers that describe layers, objects, features,
   colors, thumbnails, estimates, and other rich context.

The parser owns generic machine state. Dialect adapters recognize extensions and metadata. An
adapter must declare:

- identifier and version;
- detection evidence and confidence;
- commands/comments handled;
- produced annotations/capabilities;
- conflicts/precedence;
- fixtures and tested versions;
- behavior when partial or ambiguous.

Adapters may enrich neutral output; they must not create AnyBridge printer models or UI elements.

---

## 7. Worker and data-flow boundary

```text
consumer input
   -> input/container adapter
   -> parser worker messages
   -> progress/warnings/cancel
   -> compact ToolpathIR transfer
   -> renderer-owned GPU representation
   -> viewer state/events
```

The worker DD decides chunk sizes, stream ownership, transferables, partial results, and recovery.
Founding constraints:

- no full parser loop on the UI thread for supported production flows;
- cancellation is first-class;
- message payloads are versioned/tested;
- worker errors become structured consumer events;
- resource limits are configurable and safe by default;
- input contents do not cause code execution or arbitrary network access.

---

## 8. Rendering boundary

The 3D renderer is the primary initial renderer. A later 2D mode must consume the same IR rather
than create a second parser path.

The renderer DD decides:

- line, tube, instanced, or other geometry by quality mode;
- segmentation and GPU buffer strategy;
- layer/range clipping and progressive reveal;
- coloring/material strategy;
- precision/origin handling for large coordinates;
- camera and build-volume conventions;
- context-loss and disposal lifecycle;
- thresholds for fallback/quality reduction.

Renderer-private models must be rebuildable from `ToolpathIR` and must not become a second public
IR by accident.

---

## 9. Live progress boundary

### Viewer input concept

```ts
type ToolpathProgressObservation = {
  sourceByte?: number;
  sourceLine?: number;
  commandIndex?: number;
  layerIndex?: number;
  completion?: number;
  elapsedMs?: number;
  remainingMs?: number;
  observedAt: number;
  quality: 'exact' | 'derived' | 'approximate' | 'unknown';
  state: 'active' | 'paused' | 'stale' | 'complete' | 'disconnected';
};
```

This is illustrative only; DD-006 owns the final type.

### AnyBridge translation examples

- Moonraker file byte position -> exact/derived source progress.
- Vendor MQTT layer number -> layer-level progress.
- Printer-reported percentage only -> approximate completion.
- Telemetry/file mismatch -> unknown or disabled overlay, not fake precision.

The viewer maps observations onto parsed indexes. It does not subscribe to telemetry directly.

---

## 10. Container boundary

AnyBridge may provide a `File`, stream, buffer, or application-defined byte source after it has
authorized and acquired the content. The toolpath project determines how supported containers are
interpreted.

Container extraction must:

- allow only intended entries;
- normalize and validate paths;
- cap compressed/expanded sizes and entry counts;
- avoid extracting arbitrary files to disk when possible;
- surface multiple candidate G-code entries instead of guessing silently;
- preserve metadata provenance;
- remain independently testable outside AnyBridge.

---

## 11. Consumer integration boundary

The Vue package may expose a generic viewer component, but AnyBridge owns:

- panels, cards, routes, menus, and VueKit styling;
- file selection and download state;
- printer/job identity and active-job selection;
- fit/safety/mismatch messaging;
- live status and operational actions;
- persistence of user settings within AnyBridge;
- feature gating and product modes.

The toolpath package may expose generic settings, but it must not read AnyBridge local storage keys
or Pinia stores.

---

## 12. Dependency guardrails

CI should eventually enforce:

- core/parser/dialect/container packages cannot import renderer, Vue, demo, or AnyBridge modules;
- renderer cannot import parser internals or dialect recognizers;
- Vue wrapper can import the facade but not AnyBridge;
- test fixtures are accessed through manifest helpers, not hard-coded private paths;
- public exports are explicit and circular package dependencies fail CI.

---

## 13. Decisions intentionally deferred to DDs

- exact package manager/workspace tool;
- exact typed-array versus object representation;
- streaming APIs and partial-render policy;
- worker bundling strategy;
- upstream stable versus development baseline;
- Three.js version/migration approach;
- geometry implementation;
- package count and publication order;
- serialized IR persistence;
- `.bgcode` support;
- low-resource renderer timing.

Deferral means “decide with evidence,” not “let the first implementation PR choose silently.”

