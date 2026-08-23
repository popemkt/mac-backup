# f-docs — Documentation integration handoff

**Wave:** f-docs (2026-08-23) · **Harness:** claude ·
**Branch:** `popemkt/kb-f-docs` (branch point = `961c79b`, identical to `main`)
**Gate:** `./intent/gate.sh session claude` → exit 0,
`SOFT_MISSING: shellcheck actionlint nvfetcher` (soft). Nothing pushed, nothing
merged.

Commits:

```
31e5737 docs(kb): reconcile design docs with the 2026-08-23 wave
<this>  docs: f-docs integration handoff
```

## Method

Handoffs were treated as leads, not as truth. Every claim written into a design
doc was re-derived from merged code on `main` (`SYSTEM_IDS`, `seed.ts`,
`foundation/ontology.ts`, `operations/ontology.ts`, `storage/write-lock.ts`,
`storage/durable-replace.ts`, `registry.ts`, `ui/src/**`), or from running the
command. Three handoff statements did **not** survive that check and are
corrected below.

## What shipped

### `tools/kb/DESIGN.md`

- **New section "Ontologies — a lens over the graph"** (between Query layer and
  Action registry). Covers: `#ontology` as a node *kind* not a *type*, with
  membership on the ontology so a non-member carries zero props; all six
  `sys.f.onto.*` fields with their **real** seeded types; the union+veto
  algebra with `exclude` applied last and absolute; cycle-safe `extends`
  (DFS + `visiting` set, `DEFAULT_MAX_DEPTH` 32, back-edges warn); the
  warnings-never-throws posture including `DEFAULT_WARN_ABOVE` 5000; the pure
  isomorphic resolver with an injected EDN runner shared through `@kb/ontology`;
  provenance (`MemberReason`); `ontology.members` plus CLI sugar; the
  projection-not-sandbox invariant; and the r5 §2.9 parked list.
- **Storage** gained a "Write hardening" bullet — `write-lock.ts` (exclusive
  `.kb/nodes.jsonl.lock` wrapping the *whole* reload → merge → replace via
  `Effect.acquireRelease`, 25ms `Effect.sleep` spin, 15s ceiling, stale-pid
  steal, `conflict` only on timeout) and `durable-replace.ts` (tmp fd + fsync,
  `.bak` rotation, rename, best-effort dir fsync). The old "atomic write
  (tmp + rename)" phrasing was replaced, and "No WAL/leases — atomic rename
  suffices" was qualified: the lock serializes *writers* and does not make a
  *reader's* snapshot binding.
- **Operations table** now lists every registered action. Five were live and
  undocumented: `ontology.members`, `asset.upload`, `render.view`,
  `render.views`, `ext.canvas.tx.apply`.
- The Extension SDK paragraph i4 added was audited, not rewritten — every claim
  in it (`src/ext-sdk/surface.ts`, `scripts/gen-ext-sdk.ts`, the committed
  `sdk-dts.text.ts` string, `tests/ext-sdk-fresh.test.ts`, `kb ext sdk --write`)
  checks out.

### `tools/kb/DESIGN-UI.md`

- **New section "Interaction model (as shipped, 2026-08-23 wave)"** with four
  subsections:
  - **Outline editor (i1)** — transient nodes replacing ghost rows
    (`createTransientNode` / `transientIds` / `data-create-child-zone` /
    `pruneOutgoingTransient`), the Mode A / Mode B split with the file that owns
    each, measured caret geometry (`readCaretGeometry`, `verticalArrowDecision`,
    `nearestOffsetForX`, `focusX`, `focusSeq`, serialized-offset measurement in
    `md-edit.ts`), action-level undo/redo (`invertPlan` / `inversePlanActions`,
    `HISTORY_LIMIT` 50) with its two honest gaps stated, atomic ref pills, and
    the `sys.*` read-only door.
  - **Ontology scope (i6)** — the four `/o` routes, scope as a single
    `projectWire()` projection with `queryDb` deliberately over the *full*
    snapshot, `WeakMap` snapshot-identity memoization, the never-dead-end rule,
    the synthetic-depth caveat, and `restrictTo` on the graph lens.
  - **Graph (i2)** — select-in-place, animated camera, FA2 worker with 2.5s
    settle and rAF fallback, search × legend-filter intersection with the
    ephemeral/persisted split, `EdgeArrowProgram` + `√weight` widths, empty /
    error / capped states, `LARGE_GRAPH_THRESHOLD` 1500 degraded mode, plus the
    named cuts.
  - **Canvas (i3)** — `CanvasSelection` as a set, `MAX_HISTORY` 30 undo ring,
    `DRAG_THRESHOLD` 4px + pointer capture + 80×40 clamp, `SNAP_TOL` 5px guides,
    `Shift+1` zoom-to-fit, 0.1–3.0 zoom, the one-shot/sticky tool reducer with
    the real hotkeys, edges-as-drawings polish, and the named cuts.
- The stale v1 line ("No drag-drop, no undo/redo, no table/board views") is
  struck through and annotated rather than deleted — the original contract stays
  legible, and the annotation says precisely which third is still true (outline
  row drag-and-drop).

### `tools/kb/INSPIRATIONS.md`

Five new lineage rows plus two corrections:

| Row | Source | Note |
|---|---|---|
| Ontologies (scoped lenses) | kb-original + Tana | Anatomy cloned from `#graph-perspective`; Tana supplies the tag-names-a-set vocabulary; tag **inheritance explicitly not copied** (no evidence in the capture — r5 §4); RDF/OWL/SKOS a named non-adoption |
| Canvas direct manipulation | Excalidraw | Marquee, drag threshold, magnetic guides, zoom-to-fit, sticky tools, undo ring |
| Editor transient rows | Tana | Why ghost rows lost: input-sync bugs (r1 §3.3) |
| Graph interaction vocabulary | CodeFlow *(research-adopted)* | The interaction layer inside one renderer, distinct from the existing renderer-catalog row |
| Conditional semantic writes | Zerolang *(researched, parked)* | Recorded as lineage-if-adopted, with the non-adoptions |

Corrections: the canvas row said z-order was "deliberately cut" — it shipped
this wave. The preamble gained a `*(researched, parked)*` marker convention, and
the standing-rules list gained the warnings-never-throw rule this wave proved.

### `tools/kb/ui/README.md`

Rewritten command block, plus a shape paragraph pointing at DESIGN-UI.md. See
finding 3 — the documented commands did not run.

## Corrections to handoff claims

1. **`sys.f.onto.closure` is not a checkbox.** The i6 handoff describes a
   "closure toggle"; the seeded field is `str` with `"none"` (default) |
   `"descendants"` (`seed.ts`, `ONTOLOGY_CLOSURE_MODES`). Documented as the
   latter.
2. **Scope memoization is not keyed on snapshot identity alone.** The handoff
   says "per snapshot IDENTITY, not per `rev`". `resolveScope` is a `WeakMap`
   on the `wireNodes` array whose inner key is `` `${rev}\0${ontologyId}` `` —
   rev participates so a same-array resync still re-resolves. Documented as
   implemented.
3. **Conditional-write preconditions are parked, not shipped.** r8 §1 proposes
   `expect`; i4 explicitly skipped "revision/CAS manifest". Verified: no action
   input accepts `expect`, and the only `conflict` producer in `src/` is the
   write-lock timeout. DESIGN.md and INSPIRATIONS.md both say so plainly, so a
   later reader cannot mistake the lock for a CAS guarantee.

## Verification — every documented command was run

| Command | Result |
|---|---|
| `kb ontology list` | lists the `#ontology` node |
| `kb ontology members <id> --reasons` | on a scratch root: tag member (`{kind:"tag",via}`), pin (`{kind:"member"}`), and a tagged node **excluded** — veto beats tag membership, exactly as the algebra claims |
| extends cycle | `"extends cycle ignored: A → B → A"` in `warnings`, correct union still returned |
| malformed `onto.query` | `"onto.query failed …: Unexpected EOF …"` in `warnings`, resolution succeeds |
| `kb set <o> onto.include <tag> --type ref` | required — see finding 1 |
| `kb ext sdk --write` | `wrote .kb/sdk.d.ts (kb 0.1.0)`, 127 lines |
| `bun run gen:ext-sdk` | regenerates to a **zero-diff** committed string (freshness holds) |
| `kb ext list` | 3 bundled actions + aliases |
| `kb action-invoke '{"id":"ext.docs.check","input":{}}'` | `clean: true` (1 view) — no generated input changed, so **`docs-materialize` was correctly not run** |
| `bun test` (tools/kb, recursive) | **607 pass / 0 fail**, 81 files |
| `bun test tests/` (backend only) | 234 pass / 0 fail; benchmark 50k nodes total 365ms |
| `npm run typecheck` (backend) | clean |
| `npm run check` (backend) | 0 warnings / 0 errors, 83 files |
| `cd ui && vp test` | **397 pass / 0 fail**, 61 files |
| `cd ui && bun run typecheck` | clean |
| `cd ui && bun run check` | 0 errors, 13 warnings (pre-existing) |
| `cd ui && bun run build` | builds in ~1s |
| pre-commit hook | passed on the docs commit (kb docs clean, both typechecks, media-backup ownership) |

The global `kb` binary is a **pinned Nix build** (`kb-0.1.0` in the store) and
predates tonight's merges — it has no `ontology` subcommand. Everything above was
run as `bun tools/kb/src/surface/cli.ts` from this worktree. Anyone verifying
these docs before the next `rebuild` must do the same.

## Findings for other zones (not touched — out of my zone)

1. **`kb set` on a ref-typed field silently writes a string.**
   `kb set <onto> onto.include <tagId>` stores `{t:"str"}`; the resolver counts
   only `{t:"ref"}`, so the ontology resolves to zero members with **no warning**
   — the failure is silent and looks like a resolver bug. `--type ref` is
   required. Documented as a workaround in DESIGN.md, but the real fix is for
   `node.update` to coerce (or reject) by the field's declared
   `sys.f.field-type`. Owner: a backend wave.
2. **`.kb/nodes.jsonl.lock` and `.kb/sdk.d.ts` are not gitignored.** Both are
   new this wave and both are runtime/local artifacts; `.gitignore` already
   covers `.bak` and `.tmp`. Two lines. Owner: **x-dx** (owns `.gitignore` and
   repo docs accuracy).
3. **`tools/kb/ui/package.json` pins `devEngines.packageManager npm@12.0.2`**
   while the machine ships npm 10.9.8, so *every* `npm` command in that package
   dies with `EBADDEVENGINES` — including `npm install`. I fixed the README to
   document the `bun` path that works, but the pin itself is either intentional
   (then say so) or accidental (then drop it). Owner: **x-dx** / UI package
   owner.
4. **The `kb ext sdk --write` one-liner is still missing from root `CLAUDE.md` /
   `AGENTS.md`.** i4 deferred this to "the orchestrator / F docs pass", but root
   `CLAUDE.md` is not in the f-docs zone. Same for a `kb ontology list|members`
   line in the kb block. Owner: **x-dx** (owns `AGENTS.md` accuracy) or the
   orchestrator. Suggested text: `kb ontology list|members <id> [--reasons]` and
   `kb ext sdk --write   # .kb/sdk.d.ts for external extensions`.
5. **Stale bunfig ignore** — `tools/kb/bunfig.toml:9` still ignores the deleted
   `ghost-node-row.component.test.tsx`. Harmless, already flagged by i1.
6. **`DESIGN-REFINE.md` and `DESIGN-RESKIN.md` are historical wave plans**
   (rev 3 / rev 2) whose "wave plan" and "out of scope" sections no longer
   describe the system. I left them untouched: they read as dated plans rather
   than current-state specs, and rewriting them is a different job from
   reconciliation. Flagging so nobody mistakes them for live contracts.

## Self-grade

**A−.**

Strong: nothing was written from a handoff alone. The three corrected claims
(closure type, memo key, preconditions parked) are exactly the kind of drift
that makes a design doc worse than no doc, and each was caught by reading the
merged code. Every command in the touched docs was executed, including the
ontology algebra end to end — the absolute-veto rule is *demonstrated* in the
verification table, not asserted. Finding 1 (silent str-vs-ref) and finding 3
(`npm` cannot install the UI package) are real defects that only surfaced
because the "verify every command" instruction was taken literally.

Honest gaps:

- **No browser.** Like i6 before me, I never clicked through `/o` or the canvas.
  The UI section is written from source and tests; the interaction *claims*
  (e.g. "guides are magnetic within 5px") are traced to constants and code
  paths, not observed on screen.
- **`DESIGN-REFINE.md` / `DESIGN-RESKIN.md` left stale**, deliberately (finding
  6) — but "the design docs must match what shipped" arguably covers them, so
  this is a scope judgment a reviewer may disagree with.
- **The i5-polish wave has no handoff report** in `reports/`, and I found no
  commit carrying one, so anything it shipped that is not visible in the code I
  read is undocumented. The brief named six waves; I could reconcile five with
  their own written record.
- INSPIRATIONS.md rows are lineage prose; they are my synthesis of what the
  research reports claim, and the owner is the authority on what he actually
  drew from. Worth a skim.
