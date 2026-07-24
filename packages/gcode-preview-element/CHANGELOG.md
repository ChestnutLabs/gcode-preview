# @chestnutlabs/gcode-preview-element

## 0.2.0

### Minor Changes

- [#175](https://github.com/ChestnutLabs/gcode-preview/pull/175) [`0dd05ca`](https://github.com/ChestnutLabs/gcode-preview/commit/0dd05caa5597d7f8f396996f033e530e7f742aeb) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add `@chestnutlabs/gcode-preview-element` — a framework-free `<gcode-preview>` Web Component over
  `gcode-preview-core` (E9 phase 5, [#149](https://github.com/ChestnutLabs/gcode-preview/issues/149), DD-009 D5).

  Attributes/properties map to the same neutral controller options and DOM `CustomEvent`s to the same
  events as the Vue/React/Svelte adapters; it passes the **shared behavioral suite** (DD-007 §4.6 parity)
  and joins the lockstep version line + pack-check/publint/attw gates + support matrix. Registration is a
  function (`defineGcodePreview()`) so the `.` entry stays side-effect-free; import
  `@chestnutlabs/gcode-preview-element/define` to auto-register. No framework peer dependency — the
  plain-HTML / Angular / vanilla path.

### Patch Changes

- Updated dependencies [[`1c2e5b0`](https://github.com/ChestnutLabs/gcode-preview/commit/1c2e5b031845630a6f82501de51e1ae902d52559), [`d4c51a3`](https://github.com/ChestnutLabs/gcode-preview/commit/d4c51a394c1078efe959646b68f42de74e7cf4de), [`11c75bd`](https://github.com/ChestnutLabs/gcode-preview/commit/11c75bd540c1490f888ec9ecee64814cafb25156), [`aceb9f2`](https://github.com/ChestnutLabs/gcode-preview/commit/aceb9f29091bec94f0de91791dd093ab0d92b834)]:
  - @chestnutlabs/toolpath-core@0.2.0
  - @chestnutlabs/gcode-parser@0.2.0
  - @chestnutlabs/gcode-renderer-three@0.2.0
  - @chestnutlabs/gcode-preview-core@0.2.0
