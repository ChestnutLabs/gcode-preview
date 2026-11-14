# @chestnutlabs/gcode-dialects

Slicer/firmware **dialect adapters** for the Chestnut Labs G-code Preview stack (design: DD-005).
Dialect adapters *annotate* a parse — features, object boundaries, bed geometry, thumbnails,
multi-tool metadata — and are forbidden from changing geometry (a geometry-invariance gate
enforces it).

Supported dialects: **PrusaSlicer, OrcaSlicer/Bambu Studio, Cura, Klipper, Marlin,
RepRap-flavor** — see the evidence-dated
[compatibility matrix](https://github.com/ChestnutLabs/gcode-preview/blob/dev/docs/compatibility/dialects-and-containers.md).

Every annotation is capability-tagged (`known | inferred | approximated | unavailable`); consumers
render what is known and disclose what is not.

Slicer comments are untrusted file data. A comment whose value cannot be true is left out of the
metadata. That covers a print time or filament total that overflows or is not a number (Cura `;TIME:`
included), a print height of zero or less, a bed outline that encloses no area, and a comment thumbnail
that is malformed (dimensions outside 1..65535, over the size cap, longer than declared, not base64,
or never closed). The parse records one `dialect-metadata-invalid` warning for these, with a count. A bed
point that is not finite gives no bed, with the `dialect-bed-unparsed` warning. When a file carries more
of something than the annotator keeps (thumbnails, object names, filament slots), the extra entries are
dropped with a `dialect-annotation-truncated` warning. It never reports `NaN` or `Infinity`, and it
never fails the parse. Filament colours may be `#RRGGBB` or `#RRGGBBAA`; the alpha is ignored.

A custom adapter gets the same treatment. Sink input that cannot be used (an object value outside
1..10,000, a tool id that is not a whole number, a colour that is not a string) is dropped with a
`dialect-metadata-invalid` warning. If an adapter's annotations still fail to apply, none of them are
kept, and the parse records `adapter-failed`. An adapter that reads comment thumbnails with
`ThumbnailCollector` should call `collector.close(sink)` in `finalize`, so a block left open at the end of
the file is reported instead of dropped silently.

This package is bundled into the parser's default *batteries* worker — most applications never
import it directly. Import it to build a **custom worker** with a chosen adapter subset, or to
register your own adapter against the annotator contract.

Part of [Chestnut Labs G-code Preview](../../README.md) · MIT
