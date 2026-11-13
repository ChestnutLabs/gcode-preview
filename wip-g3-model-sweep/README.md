# WIP: G3 model-renderer mutation sweep (parked for the v0.24.0 wind-down)

No source change yet. Lead-approved scope is option (c) (see footprint.md and the lead decision in
ProjectSource/team/journal-g3.md): D1 listener isolation, D2 per-op replay -> E_CONTROL_REJECTED,
D4 drop controls after dispose, D3 null/undefined = unset (model-renderer only), close the 20 test gaps,
proofs for the 3 equivalents. D5 is filed as a separate P2 issue.

- footprint.md: findings + options + recommendation
- red.py / check.py / red-base.log: base RED 219/242
- probe.test.ts.txt / probe.out: D1-D5 evidence (renamed so vitest does not collect it)

Delete this folder when the real sweep PR is cut from a fresh origin/dev.
