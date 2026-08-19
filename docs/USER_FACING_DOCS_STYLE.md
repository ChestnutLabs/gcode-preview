# User-facing documentation style

This is the standard for **user-facing** documentation in this repository: the root
`README.md`, consumer-facing package READMEs, the getting-started and manual pages under
`docs/manual/`, feature guides, tutorials, and the runnable examples under `tools/`.

It does **not** govern maintainer/internal documents — Design Documents (`docs/design/`),
Research Records (`docs/research/`), ADRs (`docs/adr/`), the founding planning set
(`docs/0*_*.md`), compatibility audits, security reviews, or release/governance records. Those
are written for maintainers and reviewers and have a different job. Do not flatten their precision
to match this guide, and do not import their epic-status / gate / issue-number vocabulary into
user-facing pages.

If you are creating or materially changing any user-facing document, follow this standard.

---

## 1. Audience first

A user-facing page is read by someone deciding whether this project solves *their* problem —
a web developer, a print-management or farm-software author, a slicer-adjacent tool builder, a
CNC/laser hobbyist. Most have never seen the codebase and do not care about its internal structure
yet.

Write for that reader. Explain the **product** before the **implementation**. Lead with what the
thing does and what it looks like; move architecture, package topology, IR schema, worker protocol,
and governance further down for the reader who has decided to go deeper.

Never open a user-facing page with internal vocabulary: "worker-based toolpath stack", "versioned
intermediate representation", "lockstep-versioned packages", epic/gate status, or governance
process. Those belong in the technical-depth sections and the maintainer docs.

## 2. Progressive disclosure

Structure every user-facing page so a reader can stop at any layer and still have a complete,
correct understanding:

- **30 seconds** — what it is, one strong visual, the core value, supported environments.
- **2 minutes** — major capabilities, integrations, format/compatibility, install path.
- **10 minutes** — architecture, packages, API concepts, progress model, format details.
- **Deep** — link out to design docs, plans, internals, and exhaustive compatibility evidence.

Push depth *down* the page and *out* to linked docs. The root README is a front door, not a manual.

## 3. Evidence over adjectives

State what a feature does, with a specific fact. Delete the adjective if the fact makes it
redundant. Ban these unless the same sentence already contains the concrete evidence that would
make them unnecessary: *powerful, flexible, seamless, robust, next-generation, revolutionary,
best-in-class, enterprise-grade, production-ready, blazing-fast, cutting-edge*.

> ❌ A powerful and flexible rendering solution for all your G-code needs.
>
> ✅ Parse G-code in a Web Worker and render it with Three.js — or the Canvas 2D fallback for
> low-GPU devices — without blocking the page.

Never invent capabilities, benchmarks, compatibility, or validation claims. If a claim needs a
qualifier, keep the qualifier — the honesty *is* the differentiator here (see §7).

## 4. The paste test

Apply this to every substantive paragraph:

> Could this paragraph be pasted, unchanged, into an unrelated project's README by swapping only
> the product name?

If yes, it is filler. Make it specific to *this* project or delete it. Generic mission statements,
"getting started is easy!", and feature-list preambles all fail the test.

## 5. Prose quality (unslop)

Influenced by Cursor's `pstack/unslop` skill
(<https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md>), applied as a quality
filter, not a mechanical rulebook:

- Concrete nouns and verbs; active voice; say exactly what happens.
- Cut filler ("in order to", "it is worth noting that", "when it comes to").
- Vary sentence length and structure. Avoid the rule-of-three tic ("fast, simple, and reliable")
  and repeated "Not only… but also…" / "Whether you're… or…" scaffolds.
- Prefer specific facts to summarizing adjectives.

This is technical writing, so keep the tools that make technical writing clear: tables, code
identifiers, parentheses, colons, and structured lists are fine when they communicate faster than
prose. Do not turn documentation into marketing copy in the name of "voice". The target is **clear,
confident, visual, technically credible, and human**.

## 6. Visuals

Screenshots carry the product. Rules:

- **Real software only.** Every image is a render from the current build (see
  [`tools/screenshots/`](../tools/screenshots/README.md)). Never mock, composite, or hand-paint a
  screenshot, and never show UI the software doesn't have.
- **Put a strong visual near the top** of the root README, above the fold. It should demonstrate
  the product, not decorate the page.
- **Consistency:** hold viewport size, framing, crop, sample models, filenames, and UI state steady
  across a set so a grid reads as one system. The capture harness encodes these defaults.
- **Show, don't pad.** Prefer an image that demonstrates a capability (a clip, a color mode, a
  progress overlay) over a second angle of the same model. Use markdown tables for side-by-side
  pairs and small grids instead of one full-width image per feature.
- **Motion only when motion is the point.** A GIF/video is justified when the thing being shown is
  temporal (a scrub, a live-progress sweep). Don't build a wall of GIFs.
- **Alt text describes the content**, not the file: "3DBenchy clipped to layer 73 of 174, exposing
  perimeters and infill with feature coloring" — not "screenshot" or "benchy.png".
- **Keep images honest and current** (see §8). Optimize file size for GitHub (reasonable
  resolution, PNG) without making labels unreadable.

## 7. Preserve the honesty model

This project's defining behavior is that it discloses what it knows and refuses to fabricate what
it doesn't. Do not weaken this in user-facing writing to sound more impressive:

- Explain the confidence tiers (`known`, `inferred`, `approximated`, `unavailable`) in plain
  language *before* introducing the vocabulary.
- Keep validation distinctions accurate. Only claim hardware validation where it exists (today:
  GRBL/LightBurn **laser** only; GRBL-mill and LinuxCNC are experimental/`inferred`). Geometry
  always parses; only *semantic* claims are tier-gated — a safe, repeatable framing.
- Disclose unsupported paths (e.g. the 2D renderer's `renderer-unsupported` for non-planar
  toolpaths) rather than implying everything works everywhere.

## 8. Docs are part of "done"

When a change adds or materially changes a **user-visible** capability, deliberately answer these
before considering the work complete (a screenshot is not required every time — deliberate
consideration is):

1. Does the root README need to change?
2. Does a package README or user guide need to change?
3. Does an existing screenshot now misrepresent the software?
4. Would one new screenshot make this feature substantially easier to understand?
5. Do the quick-start and example code still show the recommended API?

If a visible behavior changed, regenerate the affected media with the capture harness rather than
leaving a stale image in place.

## 9. Links and legal

- Link to deeper docs instead of inlining every detail: compatibility matrix, progress contract,
  support policy, design docs, API reference.
- Verify links, image paths, and documented package names resolve before publishing
  (`npm run docs:links`).
- Keep example code runnable and current with the shipped API. The `tools/example-*` apps and the
  demo consume the packages exactly as an external consumer would — keep them that way.
- Preserve attribution and license material. This project is a fork; upstream copyright, the
  `NOTICE.md` / provenance record, and the MIT terms must remain intact and accurate. Never delete
  or weaken them to shorten a page.

## 10. Length

Do not optimize for a short README. Optimize for useful communication. Move content rather than
deleting important technical material to save space; cut only what fails §3 or §4.

---

### Self-review before publishing

Read the finished page as four visitors and make sure each is served:

- **New user** — "I don't know this project. Do I understand it in a minute?"
- **Application developer** — "Does this solve my problem, and how do I install it?"
- **Technical evaluator** — "Can I find compatibility, architecture, API, quality, and limits
  without reading the whole repo?"
- **Maintainer** — "Will the next person keep this a product front door, not a release log?"
