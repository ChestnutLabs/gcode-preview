# @chestnutlabs/gcode-dialects

Slicer/firmware **dialect adapters** for the Chestnut Labs G-code Preview stack (design: DD-005).
Dialect adapters *annotate* a parse — features, object boundaries, bed geometry, thumbnails,
multi-tool metadata — and are forbidden from changing geometry (a geometry-invariance gate
enforces it).

Supported dialects: **PrusaSlicer, OrcaSlicer/Bambu Studio, Cura, Klipper, Marlin,
RepRap-flavor** — see the evidence-dated
[compatibility matrix](../../docs/compatibility/dialects-and-containers.md).

Every annotation is capability-tagged (`known | inferred | approximated | unavailable`); consumers
render what is known and disclose what is not.

This package is bundled into the parser's default *batteries* worker — most applications never
import it directly. Import it to build a **custom worker** with a chosen adapter subset, or to
register your own adapter against the annotator contract.

Part of [Chestnut Labs G-code Preview](../../README.md) · MIT
