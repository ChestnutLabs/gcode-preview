# Research Records (RR)

A Research Record captures **reproducible evidence, comparison, or experiment** that informs a
decision. Research may precede a DD but does not bypass the DD gate (governance §5).

- Naming: `RR-NNN-<slug>.md`.
- Template: [`RR-000-template.md`](RR-000-template.md).

An RR must state: the question and the decision it informs; candidates/versions/commits tested;
environment and a reproducible procedure; the fixture/corpus manifest used; measurements and observable
results; license/provenance concerns; limitations and unknowns; and a recommendation with rejected
alternatives.

## Active / planned

| ID | Title | Epic | Status |
|---|---|---|---|
| [RR-001](RR-001-upstream-baseline-and-architecture-audit.md) | Upstream Baseline and Architecture Audit | E0 | **Complete — ready for E0 acceptance.** Baseline = `develop` @ `15375e56` (maintainer-confirmed). Benchmarks (§5.5) + reference comparison (§5.4) done; inherited red suite fixed (#23). |
