---
'@chestnutlabs/gcode-renderer-three': patch
---

fix(renderer): tube memory budget counts only extrude segments, not travel/wipe (RR-006 correction)

The `tubes` budget check passed `totalSegmentsIncluded` — which sums extrude **and** travel/wipe segments —
to `tubeRadialForBudget`, but tube geometry is only built for `extrude` chunks (travel/wipe always render as
flat lines). On a plate with heavy inter-part travel (e.g. an 814-part full sheet), the non-tube travel
segments wildly inflated the count, so a file whose actual tube geometry would fit the budget fell back to
lines prematurely. The budget now counts only the extrude (tube-eligible) segments, so travel-heavy plates
render as continuous tubes instead of dropping to lines. `autoDecimation` was already extrude-only and is
unchanged; this only corrects the tube byte-budget check.
