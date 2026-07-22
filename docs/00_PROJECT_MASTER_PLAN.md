# Chestnut Labs G-code Preview — Project Master Plan

**Status:** Proposed · **Version:** 0.1  
**Prepared:** 2026-07-22  
**Project:** Chestnut Labs G-code Preview / Toolpath Stack  
**Target repository:** `chestnutlabs/gcode-preview`  
**Initial upstream:** `xyz-tools/gcode-preview`  
**Initial consumer:** AnyBridge

---

## 1. Executive decision

Create `chestnutlabs/gcode-preview` as a public GitHub fork of
`xyz-tools/gcode-preview`. Preserve the upstream Git history and MIT attribution, but give the
Chestnut Labs fork its own roadmap, governance, release cadence, test corpus, and package APIs.

The repository should be allowed to evolve from one parser/viewer package into a small toolpath
monorepo. Its reusable core must not depend on AnyBridge. AnyBridge will consume published
Chestnut Labs packages and provide application-specific file access, printer connectivity,
permissions, job context, and live progress telemetry.

This project is the proper home for the interactive layer/toolpath viewer deferred from AnyBridge
`#593` and related to AnyBridge `#581`. The safety/classification work in `#593` remains bounded and
continues independently.

---

## 2. Vision

Build a modern, reusable, cross-vendor G-code parsing and visualization stack for browser and
Electron applications. A consumer should be able to load a plain G-code file or supported
container, parse it off the UI thread, inspect a normalized toolpath, render it interactively in
3D, scrub by layer or source position, and optionally overlay live printer progress.

The project should become useful beyond AnyBridge without being forced to become a complete
slicer, printer controller, or manufacturing application.

### Product promise

> Give applications one dependable way to understand and visualize real 3D-printer toolpaths
> across slicers, firmware dialects, material systems, and file sizes.

---

## 3. Why this is a separate project

The viewer is a subsystem, not a small AnyBridge status check. It requires whole-file or streaming
parsing, stateful motion interpretation, layer and object segmentation, GPU rendering, large-file
memory controls, source-position indexing, and a reusable progress contract.

Keeping it separate provides:

- a clear open-source identity and release lifecycle;
- a legitimate GitHub fork relationship to the MIT-licensed upstream;
- reusable parser, dialect, container, and renderer packages;
- an independent corpus and performance program;
- freedom for AnyBridge to integrate without owning every toolpath concern;
- a path to replace inherited subsystems gradually instead of requiring a formal clean-room
  rewrite before useful work can ship.

---

## 4. Guiding principles

### 4.1 Architecture before application UI

Define the intermediate representation, parser contract, worker boundary, and resource model before
building a polished AnyBridge panel. The first UI is a diagnostic/demo harness for proving the
engine.

### 4.2 Reusable core, application-owned behavior

The toolpath stack owns parsing and visualization. Consumer applications own printer protocols,
authentication, permissions, operational workflows, and product-specific presentation.

### 4.3 Eventual 3D architecture from the first phase

Do not build a disposable 2D viewer. A later low-resource 2D layer mode may render the same
`ToolpathIR`, but the core representation and parser must support the intended 3D system from the
start.

### 4.4 Worker-first and resource-aware

Parsing untrusted files must not freeze the UI. Large-file behavior, bounded memory, cancellation,
progress reporting, and recovery are architectural requirements, not late optimizations.

### 4.5 Cross-vendor, not AnyBridge-shaped

Orca, Bambu, Prusa, Cura, Klipper, Marlin, RepRap-style, MMU, AMS, IDEX, and toolchanger cases are
handled through explicit capabilities and adapters. The neutral core must not assume a single
printer vendor, slicer, or transport.

### 4.6 Evidence over appearance

Viewer candidates are judged with the same file corpus and measurements. A polished demo or rough
technical harness is not evidence of architectural quality.

### 4.7 Preserve attribution and optional upstream exchange

Chestnut Labs may diverge substantially, but inherited MIT notices and provenance remain intact.
Upstream fixes are evaluated deliberately; nothing syncs automatically.

### 4.8 Replace incrementally, not performatively

The near-term goal is a Chestnut-maintained engine, not a claim of clean-room authorship. Inherited
subsystems may be replaced behind stable contracts when tests, performance, or product needs
justify the cost.

### 4.9 Parsing is not print safety simulation

The viewer describes commanded toolpaths. It does not prove that a print is mechanically safe,
collision-free, correctly sliced, or compatible with a target printer. AnyBridge safety and
dispatch gates remain separate.

### 4.10 Tests and fixtures are product assets

A versioned, provenance-aware, redistributable cross-slicer corpus is a core deliverable. Parser
correctness, render regression, resource use, and live-position mapping must be reproducible.

---

## 5. Scope

### 5.1 In scope

- Stateful parsing of common additive-manufacturing G-code.
- Normalized toolpath representation with layers, movements, extrusion, tools/materials, object
  and feature metadata, bounds, and source positions.
- Streaming or chunked parsing in a Web Worker.
- Interactive Three.js/WebGL rendering.
- Rotatable 3D view, pan, zoom, camera reset, and build-volume context.
- Layer/range scrubbing and current-position display.
- Tool/material, feature, speed, flow, and other coloring modes as data permits.
- Travel/retraction/tool-change visibility controls.
- Plain `.gcode` input.
- Container adapters, beginning with `.gcode.3mf` after safe extraction is designed.
- Extension point for future `.bgcode` support.
- Dialect/metadata adapters for prioritized slicer and firmware families.
- A normalized, confidence-aware progress overlay contract.
- An optional later low-resource 2D/layer renderer using the same IR.
- Framework-neutral core packages plus a Vue integration package.
- A public demo/diagnostic application and benchmark harness.
- Package publication under the `@chestnutlabs` scope, subject to repository release approval.

### 5.2 Explicitly out of scope for the initial program

- Slicing STL/3MF geometry into G-code.
- Editing or rewriting production G-code.
- Sending commands to printers.
- Printer discovery, authentication, file transfer, or telemetry protocols.
- AnyBridge permissions, dispatch, or safety decisions.
- Mechanical collision detection or physical print simulation.
- Guaranteed visual parity with PrusaSlicer/libvgcode.
- A formal clean-room rewrite.
- A server-side rasterization or media pipeline.
- CNC, laser, or subtractive-machine correctness beyond incidental compatibility.
- Full `.bgcode` implementation before its own scoped DD.

### 5.3 Future candidates, not promises

- Low-resource 2D current/adjacent layer mode inspired by Fluidd's resource strategy.
- Object selection and exclusion interaction.
- Belt-printer, delta, non-planar, multi-axis, and toolchanger-specialized views.
- Progressive network streaming.
- Pluggable WebGPU renderer.
- A clean Chestnut-native renderer or libvgcode/WASM research project. That would be separately
  chartered and is not required for this project to succeed.

---

## 6. Users and consumers

### Primary consumers

1. **AnyBridge** — file inspection, pre-dispatch visualization, active-job progress, and printer
   context.
2. **Chestnut Labs demo and diagnostics** — public compatibility testing, issue reproduction, and
   benchmark evidence.
3. **Third-party web/Electron applications** — reusable parser and viewer packages without an
   AnyBridge dependency.

### Primary user workflows

- Open a G-code file and quickly see whether a useful preview can be rendered.
- Rotate, zoom, and inspect the full toolpath.
- Scrub to a layer or range of layers.
- Switch coloring and visibility modes to understand tools, materials, features, or motion.
- Follow the current print position when a host application supplies live progress.
- Fall back gracefully when metadata or an exact live file position is unavailable.

---

## 7. System boundary

```text
plain G-code / .gcode.3mf / future formats
                    |
             container adapters
                    |
       worker-based parser + dialect plugins
                    |
                ToolpathIR
              /            \
     3D Three.js renderer   later 2D layer renderer
              \            /
             framework-neutral viewer API
                    |
             Vue integration package
                    |
    AnyBridge or another consumer application
                    |
     normalized live-progress signal supplied by consumer
```

The dependency direction is downward toward neutral packages. No reusable package may import
AnyBridge code or an AnyBridge domain model.

---

## 8. Founding technical direction

These are initial constraints to validate in Epic DDs, not permission to implement them without
review.

### 8.1 Upstream baseline

- Begin as a GitHub fork of `xyz-tools/gcode-preview`.
- Audit the upstream published stable line and current development line before selecting the first
  Chestnut baseline.
- Treat Sindarius/Mainsail as a proven live-viewer comparison.
- Treat Fluidd's worker/parser and 2D layer view as a low-resource reference.
- Treat BambuBuddy/PrettyGCode as behavioral history, not a foundation.
- Keep libvgcode as separate future R&D, not a dependency of the initial program.

### 8.2 Intermediate representation

Create a versioned `ToolpathIR` that can represent at least:

- source identity, parser version, dialect decisions, and warnings;
- machines/coordinate systems and units;
- layers and Z ranges;
- ordered movements and compact segment buffers;
- XYZ/E state, extrusion versus travel, retraction, wipe, and arc-derived geometry;
- tool/extruder/material/color identifiers;
- feature roles and object identifiers when known;
- feed rate, flow, width, height, temperatures, and fan state when known;
- spatial bounds;
- source byte/line ranges and lookup indexes;
- capability flags distinguishing known, inferred, approximated, and unavailable data.

The IR should favor compact typed/transferrable data over millions of reactive JavaScript objects.

### 8.3 Parsing

- Run parsing outside the UI thread.
- Support incremental input, progress events, cancellation, warnings, and bounded failure.
- Separate generic machine-state interpretation from slicer/firmware metadata adapters.
- Preserve source positions required for scrubbing and live progress.
- Never use `eval` or execute file-provided content.

### 8.4 Rendering

- Standardize initially on Three.js/WebGL.
- Consume `ToolpathIR`; do not reparse raw G-code in the renderer.
- Keep camera, rendering, and UI controls separable.
- Render from compact buffers and allow quality reduction or data thinning when required.
- Treat WebGL context loss and low-GPU environments as recoverable conditions.

### 8.5 Live progress

The viewer accepts a normalized progress signal. It does not connect to Moonraker, MQTT,
OctoPrint, or vendor APIs.

The signal should support exact and approximate observations:

- source byte position;
- source line or command index;
- current layer;
- completed percentage;
- elapsed/remaining time when supplied;
- confidence/quality of the mapping;
- stale/disconnected state.

AnyBridge owns translation from printer telemetry to this contract.

---

## 9. Quality and non-functional requirements

### 9.1 Correctness

- Maintain parser state correctly across absolute/relative XYZ and E modes, units, coordinate
  resets, homing, tool changes, and arcs.
- Preserve unsupported commands as warnings/metadata rather than silently asserting false meaning.
- Expose approximations and missing data through capability flags.

### 9.2 Performance

The benchmark corpus must include approximately 10 MB, 100 MB, and 250 MB files, plus a larger
stress case when redistributable fixtures are available. Measure:

- time to first useful preview;
- total parse time;
- peak main-thread and worker memory;
- transferable-buffer size;
- frame rate and interaction responsiveness;
- layer/range scrub latency;
- cancellation and recovery time.

Hard budgets are approved in the parser/worker and renderer DDs after baseline measurement. A
target without baseline evidence must not be invented merely to fill a checklist.

### 9.3 Security and resilience

- Treat all inputs as untrusted.
- Enforce configurable file, entry-count, expanded-size, and parse-time limits.
- Protect container extraction against path traversal, malformed archives, and decompression bombs.
- Permit worker cancellation/termination.
- Avoid remote fetches initiated by file content.
- Redact local paths and user-identifying metadata from reports unless explicitly included.

### 9.4 Compatibility

The initial validation matrix should include:

- OrcaSlicer/Bambu Studio `.gcode.3mf` and extracted G-code;
- PrusaSlicer G-code;
- Cura G-code;
- Klipper- and Marlin-targeted output;
- single-tool and multi-tool/material files;
- AMS/MMU, IDEX, and toolchanger examples where fixtures are available;
- G2/G3 arcs;
- spiral vase and scarf-seam examples;
- object/exclude-object metadata;
- start G-code with coordinate resets, purge lines, and non-print moves.

Support claims must be evidence-based and versioned. “Loads without crashing” is not equivalent to
“faithfully interpreted.”

### 9.5 Accessibility and UX

- Viewer controls must be keyboard operable.
- Color modes must not be the sole carrier of critical state.
- Users must be told when data is approximated or unavailable.
- Reduced-motion and low-resource operation must be considered in the UI DD.

---

## 10. Repository shape

The fork should begin with minimal disruption. Package extraction occurs only after the package
boundary DD is approved.

Proposed eventual shape:

```text
gcode-preview/
├── apps/
│   ├── demo/                  # public feature/compatibility harness
│   └── benchmark/             # repeatable corpus measurements
├── packages/
│   ├── toolpath-core/         # ToolpathIR, capabilities, shared contracts
│   ├── gcode-parser/          # stateful parser + worker protocol
│   ├── gcode-dialects/        # slicer/firmware metadata adapters
│   ├── gcode-containers/      # plain file and archive/container adapters
│   ├── gcode-renderer-three/  # Three.js renderer
│   ├── gcode-preview/         # framework-neutral viewer facade
│   └── gcode-preview-vue/     # Vue integration
├── test-data/
│   ├── fixtures/              # small redistributable fixtures
│   └── manifest.*             # provenance, license, expected capabilities
├── docs/
│   ├── design/
│   ├── adr/
│   ├── research/
│   └── compatibility/
└── tools/                     # corpus, benchmark, and fixture utilities
```

Names are proposed. The package-boundary DD decides whether every package is justified and when it
is extracted.

---

## 11. Roadmap

### Phase 0 — Founding and evidence baseline

**Goal:** Create the project safely and understand the inherited system before restructuring it.

Deliverables:

- Chestnut Labs GitHub fork and protected branch setup.
- Founding documents committed unchanged or with reviewed repository-specific edits.
- `origin`/`upstream` relationship documented.
- Exact upstream baseline tag/commit recorded.
- License/notice inventory.
- Architecture and code audit of stable versus current upstream development.
- Reproducible baseline demo, tests, and build.
- Initial corpus manifest and redistributability review.
- Same-corpus comparison record for xyz-tools, Sindarius/Mainsail behavior, and Fluidd concepts.
- Baseline parse, memory, and render measurements.

**Exit gate:** Research Record approved; the fork builds unchanged; inherited behavior is measured;
E1 DD is ready for review.

### Phase 1 — Stable core contracts

**Goal:** Establish boundaries that allow inherited implementation to be replaced without breaking
consumers.

Deliverables:

- `ToolpathIR` DD and versioning policy.
- Package/dependency boundary DD.
- Public parser, renderer, and viewer facade contracts.
- Capability/warning model.
- Fixture manifest schema and expected-output snapshots.
- Migration adapter from inherited xyz-tools structures where necessary.

**Exit gate:** Neutral core contract tests pass and no core package depends on AnyBridge.

### Phase 2 — Worker parsing and large-file architecture

**Goal:** Make parsing responsive, cancellable, measurable, and safe for real print files.

Deliverables:

- Worker protocol and lifecycle.
- Incremental/chunked input.
- Compact transferable representation.
- Source-position indexes.
- Limits, cancellation, structured warnings, and recovery.
- Parser correctness tests and fuzz/property-test strategy.
- 10/100/250 MB benchmark reports.

**Exit gate:** Approved performance budgets are met on the reference environments, or deviations
are documented and explicitly accepted.

### Phase 3 — 3D renderer and viewer MVP

**Goal:** Deliver the first genuinely usable Chestnut Labs viewer without binding it to AnyBridge.

Deliverables:

- Three.js renderer consuming `ToolpathIR`.
- Full model, layer, and layer-range rendering.
- Camera controls and build-volume display.
- Tool/material and movement visibility.
- Basic feature coloring where metadata exists.
- Layer/source scrubber.
- Public demo and visual-regression coverage.
- Quality/resource controls.

**Exit gate:** MVP acceptance corpus renders correctly enough for a public preview; UI remains
responsive during supported workloads.

### Phase 4 — Dialects, containers, and cross-vendor maturity

**Goal:** Expand real-world compatibility through adapters rather than vendor branches in the core.

Deliverables:

- Safe `.gcode.3mf` extraction.
- Prioritized Orca/Bambu, Prusa, Cura, Klipper, Marlin, and RepRap-style metadata adapters.
- Multi-tool/material, AMS/MMU, IDEX, and toolchanger support.
- Arc, object, feature-role, and slicer metadata improvements.
- Compatibility matrix and evidence-backed support levels.
- Extension contract for future `.bgcode` work.

**Exit gate:** The approved vendor/slicer matrix passes and unsupported/partial cases degrade
honestly.

### Phase 5 — Live progress contract and AnyBridge integration

**Goal:** Let AnyBridge show both planned toolpaths and normalized live progress without moving
printer protocol code into the viewer.

Deliverables:

- Versioned progress-signal contract.
- Exact/approximate mapping logic and confidence states.
- Viewer progress overlay and stale/disconnected behavior.
- `@chestnutlabs/gcode-preview-vue` integration surface.
- AnyBridge adapter layer and application UI under a separate AnyBridge issue/Epic.
- Cross-repository contract tests or pinned integration fixtures.

**Exit gate:** AnyBridge can display a selected file and an active job without the viewer importing
AnyBridge code or speaking printer protocols.

### Phase 6 — Release hardening and public package program

**Goal:** Make the stack dependable for external consumers.

Deliverables:

- Semantic versioning and changelog automation.
- API documentation and migration guides.
- Compatibility/support policy.
- Package size and dependency review.
- Security and malformed-input review.
- Public example integrations.
- Stable package release criteria.

**Exit gate:** First stable Chestnut Labs package line is published with documented support and
upgrade expectations.

### Later phases

- Low-resource 2D/layer renderer using the same IR.
- Additional machine kinematics and toolpath domains.
- WebGPU evaluation.
- Independent Chestnut-native rendering research.
- `.bgcode` decoding after licensing, format, and architecture research.

---

## 12. Proposed Epic map

The GitHub bootstrap document contains the initial issue hierarchy. The strategic Epic map is:

| Epic | Purpose | Architecture DD required? |
|---|---|---:|
| E0 — Fork Foundation & Upstream Audit | Preserve baseline, establish evidence and repository controls | Research Record; limited bootstrap DD |
| E1 — ToolpathIR & Package Contracts | Neutral data model, capability model, package boundaries | Yes |
| E2 — Worker Parser & Large-File Pipeline | Streaming, transfer, cancellation, limits, indexes | Yes |
| E3 — Three.js Renderer & Viewer MVP | Render architecture, controls, scrubbing, quality modes | Yes |
| E4 — Dialect & Container Compatibility | Adapter contracts, `.gcode.3mf`, support matrix | Yes |
| E5 — Live Progress Mapping | Consumer-supplied exact/approximate progress | Yes |
| E6 — AnyBridge Consumer Integration | Vue package use and AnyBridge-specific workflow | Yes, primarily in AnyBridge with cross-link |
| E7 — Release, Documentation & Ecosystem | Packages, versioning, support and examples | Yes for public API/release policy |
| E8 — Low-Resource Layer Mode | Optional 2D view over the same IR | Yes; future/deferred |

---

## 13. Design Document program

This master plan does not pre-write implementation DDs. Each architecture-sensitive Epic begins
with a child issue that authors its DD. At minimum:

1. **DD-001 — ToolpathIR and Capability Model**
2. **DD-002 — Package Boundaries and Public API Versioning**
3. **DD-003 — Worker Parsing, Streaming, Transfer, and Resource Limits**
4. **DD-004 — Three.js Rendering, Geometry, Layer Clipping, and Quality Modes**
5. **DD-005 — Dialect Plugin and Container Adapter Contracts**
6. **DD-006 — Normalized Live Progress and Source-Position Mapping**
7. **DD-007 — Vue Integration and AnyBridge Consumer Boundary**
8. **DD-008 — Package Release, Compatibility, and Deprecation Policy**

Each DD must include problem, scope, non-goals, data contracts, lifecycle, errors, security,
performance, testing, migration, observability/diagnostics, alternatives, risks, phased delivery,
and acceptance criteria.

---

## 14. Validation and benchmark program

### Corpus tiers

| Tier | Purpose | Typical content |
|---|---|---|
| Tiny | Unit and parser-state tests | Hand-authored minimal commands and metadata snippets |
| Small | PR integration and visual snapshots | Redistributable models under roughly 10 MB |
| Medium | Scheduled performance and compatibility | Representative 50–100 MB plates |
| Large | Release/performance gate | Approximately 250 MB or larger real plates |
| Adversarial | Security and recovery | Malformed lines, extreme coordinates, archive attacks, cancellation cases |

Every fixture needs a manifest entry with provenance, redistribution status, slicer/version,
target/firmware family, features present, expected capabilities, and whether exact output is stable.

### Reference comparison

The project may compare observable behavior with xyz-tools, Sindarius/Mainsail, Fluidd, slicer
previews, and BambuBuddy. Reference code may only be incorporated when its license is compatible
and attribution is recorded.

### Regression classes

- Parser state and normalized IR snapshots.
- Geometry/bounds and layer counts.
- Source-position mapping.
- Rendered visual snapshots within controlled tolerances.
- Interaction/cancellation tests.
- Memory and timing trend reports.
- Public API and package-size checks.

---

## 15. AnyBridge relationship

### Chestnut Labs toolpath project owns

- Raw G-code interpretation.
- Dialect and slicer metadata adapters.
- Safe supported-container extraction.
- `ToolpathIR` and capability/warning model.
- Three.js rendering.
- Layer/source scrubbing.
- Framework-neutral viewer behavior.
- Vue wrapper package.
- Normalized progress-display contract.

### AnyBridge owns

- Printer/vendor adapters and network communication.
- File discovery, authorization, download, caching, and job/file matching.
- Target-printer capability and fit/safety decisions.
- Permissions and operational controls.
- Translation of Moonraker/MQTT/OctoPrint/vendor telemetry into normalized progress.
- VueKit composition and AnyBridge application UX.
- Failure policy when files are unavailable or telemetry is approximate.

### Cross-project rule

AnyBridge may import Chestnut Labs packages. The Chestnut Labs toolpath repository must never import
AnyBridge packages or depend on an AnyBridge runtime.

---

## 16. Risks and mitigations

| Risk | Consequence | Mitigation |
|---|---|---|
| Upstream stable/development lines differ sharply | Fork starts on an unstable or obsolete base | Phase 0 code/behavior audit; record exact baseline; isolate public facade |
| Large files exhaust memory | Browser/Electron crash or freeze | Worker parsing, typed buffers, limits, cancellation, measured budgets |
| “Dialect support” becomes scattered conditionals | Unmaintainable vendor coupling | Explicit adapter contract and capability model |
| Rich metadata differs by slicer | False fidelity claims | Known/inferred/approximate/unavailable states and evidence matrix |
| Renderer couples to parser internals | Future replacement becomes expensive | Versioned `ToolpathIR` boundary and contract tests |
| AnyBridge concerns leak downward | Library is not reusable | Dependency checks and cross-repository boundary tests |
| Upstream sync overwrites Chestnut architecture | Regressions and provenance loss | Never auto-sync; Research Record and PR for each adoption batch |
| Public fixtures expose private data | Privacy/licensing problem | Fixture manifest, sanitization, explicit redistribution review |
| Container files become an attack surface | Zip bombs/path traversal | Safe-extraction DD and strict limits |
| MVP expands toward slicer parity | Schedule collapse | Scope gates and non-goals; phase advanced features |

---

## 17. Success measures

The project is succeeding when:

- a consumer can parse and render representative multi-vendor files without UI-thread stalls;
- `ToolpathIR` is stable enough that the parser or renderer can be replaced independently;
- support claims are backed by a documented corpus and compatibility matrix;
- large-file resource behavior is measured and bounded;
- AnyBridge can integrate through packages without protocol logic entering the viewer;
- live progress distinguishes exact from approximate mappings;
- upstream-derived code and Chestnut modifications remain traceable;
- the package can be used by a second application without importing AnyBridge;
- defects produce minimal reproducible fixtures and regression tests.

---

## 18. Open decisions and their gates

| Decision | When decided | Evidence required |
|---|---|---|
| Exact xyz-tools commit/branch used as Chestnut baseline | E0 | Build/test audit and comparison of published stable vs development |
| Workspace/package manager and monorepo tooling | E1 DD | Upstream migration cost, release needs, contributor ergonomics |
| Exact `ToolpathIR` binary/object layout | E1 DD | Corpus shapes, transfer costs, renderer requirements |
| Worker streaming mechanism | E2 DD | Browser/Electron compatibility and benchmark evidence |
| Geometry strategy and quality levels | E3 DD | GPU/memory/render comparison |
| First officially supported dialect versions | E4 DD | Redistributable fixtures and expected-output evidence |
| `.gcode.3mf` extraction dependency | E4 DD | Security, bundle size, license, streaming capability |
| Live progress matching fallback hierarchy | E5 DD | Real telemetry surfaces from AnyBridge adapters |
| Initial stable package set | E7 DD | API maturity and actual consumer demand |

---

## 19. Immediate starting point

Do not begin by moving files into the proposed monorepo or writing the AnyBridge panel.

Start in this order:

1. Create the Chestnut Labs GitHub fork and record the upstream relationship.
2. Add and adopt the founding documents.
3. Configure branches, protections, labels, milestones, issue templates, and CI baseline.
4. Create E0 and its research/audit children.
5. Build and test the inherited project unchanged.
6. Record exact upstream baseline, license notices, architecture, behavior, and benchmarks.
7. Create E1 and author DD-001/DD-002.
8. Begin implementation only after those DDs are approved.

The complete GitHub hierarchy and handoff prompt are in
`04_GITHUB_BOOTSTRAP_EPICS_MILESTONES_AND_NEXT_STEPS.md`.

---

## 20. Primary references

- xyz-tools G-code Preview: <https://github.com/xyz-tools/gcode-preview>
- GitHub fork model: <https://docs.github.com/en/pull-requests/reference/forks>
- Configuring an upstream remote: <https://docs.github.com/en/pull-requests/how-tos/work-with-forks/configuring-a-remote-repository-for-a-fork>
- Syncing a fork: <https://docs.github.com/en/pull-requests/how-tos/work-with-forks/syncing-a-fork>
- Sindarius viewer: <https://github.com/Sindarius/npm_gcodeviewer>
- Mainsail viewer integration: <https://github.com/mainsail-crew/mainsail>
- Fluidd parser/viewer reference: <https://github.com/fluidd-core/fluidd>
- PrusaSlicer libvgcode: <https://github.com/prusa3d/PrusaSlicer/tree/master/src/libvgcode>
- BambuBuddy vendored viewer notice: <https://github.com/maziggy/bambuddy/blob/main/gcode_viewer/VENDORED.md>

