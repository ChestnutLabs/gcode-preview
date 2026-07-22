# DD-NNN — <Decision / System>

> Copy this file to `DD-NNN-<slug>.md` and fill in every section. Delete these quote blocks.

**Status:** Draft <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** <name(s)>
**Date:** <YYYY-MM-DD> · **Last revised:** <YYYY-MM-DD>
**Owning Epic:** E<N> · **Milestone:** M<N>
**Supersedes / Superseded by:** <DD-XXX or none>
**Related:** <RR-XXX, ADR-XXX, issues, prototypes, benchmarks>

---

## 1. Problem
What user/architecture problem this decides, and why now.

## 2. Scope
What this DD covers.

## 3. Non-goals
Explicitly out of scope.

## 4. Data contracts / API
Types, schemas, versioned payloads, public exports. Distinguish known / inferred / approximate /
unavailable states where relevant.

## 5. Lifecycle
Creation, ownership, mutation rules, disposal; worker/message lifecycle where applicable.

## 6. Errors & failure behavior
Structured errors, cancellation, bounded failure, recovery, honest capability degradation.

## 7. Security & resource limits
Untrusted-input handling, limits (file/entry/expanded-size/parse-time), traversal/zip-bomb defenses,
no code execution / no file-initiated network access.

## 8. Performance
Budgets and how they were derived from **baseline evidence** (not invented). Measurement method.

## 9. Testing
Unit, contract/fixture, property/fuzz, visual regression, and the fixtures/manifest entries required.

## 10. Migration
Impact on inherited xyz-tools structures and on consumers; compatibility adapters; breaking-change
handling and migration notes.

## 11. Observability / diagnostics
Warnings, logs, counters, and diagnostic surfaces (privacy-preserving; redact local paths/metadata).

## 12. Alternatives considered
Options weighed and why they were rejected.

## 13. Risks
Risks and mitigations.

## 14. Phased delivery
How this ships in reviewable increments.

## 15. Acceptance criteria
Concrete, testable conditions for “done”. No core package may depend on AnyBridge.
