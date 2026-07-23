# test-data — fixture manifest & golden IR snapshots

Governed by [governance §11](../docs/01_GITHUB_WORKFLOW_PROJECT_GOVERNANCE_AND_DEVELOPMENT_PROCESS.md)
and [PROJECT_SETUP §1.1](../PROJECT_SETUP.md): only **small, legal, redistributable** fixtures with a
manifest entry may be tracked. Private/customer files stay in the gitignored `ProjectSource/`.

- **[`manifest.json`](manifest.json)** — one entry per fixture used by tests: stable id, path, sha256,
  origin, redistribution status, slicer/target, features, expected capabilities, size tier, limitations.
  The initial seed covers the **inherited MIT corpus, now at `test-data/gcodes/`** (moved from `demo/gcodes/` in #128; fixtures keep their inherited
  paths; the manifest references them rather than duplicating ~6 MB of files).
- **[`golden/`](golden/)** — golden `ToolpathIR` summaries (issue #28, DD-001 §8): one JSON per fixture
  with segment/layer/tool counts, rounded bounds, capability map, warning codes, and FNV-1a digests of
  every IR buffer. The suite `src/__tests__/ir-golden.ts` regenerates a summary from a fresh parse
  (inherited `Parser` + `Interpreter` → `jobToToolpathIR`) and compares it against these files —
  proving the parser or renderer can change while the IR contract stays stable.

## Updating goldens

Only when an intentional, reviewed behavior change alters the IR:

```bash
UPDATE_GOLDEN=1 npx vitest run src/__tests__/ir-golden.ts
```

Commit the regenerated files in the same PR as the change that caused them, and explain the diff in the
PR description (a golden diff without an explanation is a red flag, not a fix).
