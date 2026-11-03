---
'@chestnutlabs/gcode-containers': patch
'@chestnutlabs/gcode-model-renderer': patch
---

The archive-wide expanded-size cap (`maxExpandedBytesTotal`, default 1 GiB) is now enforced. It was
declared but never checked, so a crafted model 3MF could expand far past 1 GiB (up to 512 MB per part,
thousands of parts) when loaded into the model viewer. Every entry extracted from one archive now
counts toward the total. Re-reading the same entry (for example, re-opening a plate) counts once. Going
over fails with `E_CONTAINER_LIMIT_TOTAL`, which the model viewer reports as `E_MODEL_TOO_LARGE`. The
model viewer's total is fixed at 1 GiB, about twice what the default 5M-triangle limit lets through.

`ContainerLimits` values are now validated: a field that is present but not a non-negative integer
(`NaN`, `Infinity`, negative, fractional) throws `E_CONTAINER_OPTION` before anything is extracted,
instead of silently switching that cap off. An absent field still uses its default.

New export: `ExpansionBudget`, plus an optional `budget` argument on `extractEntry` and `streamEntry`,
for callers that extract several entries from one archive themselves.

The model 3MF loader now reports every extraction failure of its parts (corrupt data, CRC mismatch) as
a `ModelParseError` (`E_MODEL_PARSE`); a few paths used to surface a raw `ContainerError`.
