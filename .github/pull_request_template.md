<!-- Governance §9. Draft PRs are welcome but do not satisfy a missing DD gate. -->

## Summary
<The user/architecture outcome this PR delivers.>

## Linked issue & Epic
- Closes #<issue> <!-- or explain why this is non-closing -->
- Owning Epic: E<N> · DD/ADR/RR: <DD-NNN / none>

## Changes
- <material behavior and API changes>

## Inherited / upstream code incorporated
<Upstream commits/files adopted, and the method (merged / cherry-picked / adapted), or "none".>

## Tests & fixtures
- [ ] Tests added/updated (would fail before this change)
- [ ] Fixtures added with manifest entries (provenance + redistribution status), or N/A
- [ ] Before/after measurements for performance-sensitive work, or N/A
- [ ] Visual evidence for rendering/UI changes, or N/A

## Documentation
- [ ] User- and maintainer-facing docs updated in this PR (docs are part of the feature)
- [ ] Support matrix / migration notes updated, or N/A
- [ ] **Release promotion (`dev` → `main`) only:** `npm run docs:release-check` is green — the
      `docs/README` current-state narrative + history name this version, `RELEASE_NOTES_DRAFT.md` is
      folded in and deleted, and the enforced **`RELEASE_REVIEW.md`** (Public Product + Docs + Visual
      review) is present for this version with every disposition resolved (each changed package
      `reviewed` / `no-change-needed` / `not-applicable`; Product / Docs / Visual markers `resolved`).
      The gate blocks promotion until it is — or N/A for a normal `dev` PR.

## Impact
- Security: <untrusted-input / limits impact, or none>
- Licensing / provenance: <third-party notices updated, or none>
- Compatibility / breaking change: <label `breaking-change` + migration note if breaking, or none>

## Checklist
- [ ] Targets `dev` (or a justified branch per governance §6.3)
- [ ] Approved scope & dependency direction; no reusable package imports AnyBridge
- [ ] Conventional Commit messages
- [ ] No unrelated cleanup
