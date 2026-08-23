# Handoff — kb refinement wave 2026-08-23 (orchestrator → next orchestrator)

Handed off by opencode (orchestrator). Date: 2026-08-23 (late). The owner is
reviewing live; you are continuing the nightly orchestration. Read this fully
before acting. Plan + briefs + reports live in `docs/kb-waves/2026-08-23/`.

## TL;DR of where we are

Mostly done. Seven implementation waves are merged to `main` and committed;
editor Phase 2/3 is partially done on a branch and all owner polish items feed
into a fresh round. There is one uncommitted `.kb/nodes.jsonl` on main to
reconcile, and one rate-limit/disk incident to work around.

### Main HEAD: `d556b9f` — merged & pushed (origin/main current)

Merged via `--no-ff` (each is a single revertible commit):
- `i1-editor` Tana-grade outline rebuild (ghost rows removed, transient empty
  nodes, undo/redo, caret geometry, Mode A/B keymaps)
- `i2-graph` CodeFlow-parity overhaul (select-in-place, animated camera, worker
  layout, search/filter, arrows, weighted edges, legend, tooltips)
- `i3-canvas` professional canvas (delete nodes, rubber-band multi-select,
  undo/redo, zoom-to-fit, snap guides, sticky tools, z-order)
- `i4-backend` extension SDK (`kb ext sdk --write` → `.kb/sdk.d.ts`, freshness
  test) + JSONL write hardening (write-lock + fsync durable-replace)
- `i5-polish` whole-surface polish (palette frecency, search, view config, states)
- `i6-ontology` core ontology (`#ontology` kind, membership union, cycle-safe
  extends, `ontology.members` action, scoped reading mode)
- `i7-tags` tag chips (10px token, no reserved hover space, configure removed,
  click→tag page) + field-row baseline alignment + prefs popover alignment
- `i9-arch` component architecture (`ui/ARCHITECTURE.md`, error boundaries on
  all surfaces, colocated story modules + `vp` smoke tests; Storybook/ladle
  REJECTED as overkill for 6 primitives)
- `f-docs` design-doc integration (DESIGN.md/DESIGN-UI.md/INSPIRATIONS.md truth)
- `x-dx` repo DX (pre-commit admission speedup, doc corrections)

Research reports (all collected to `docs/kb-waves/2026-08-23/reports/`):
r1 (editor defects/spec), r2 (graph CodeFlow plan), r3 (canvas plan),
r4 (perf/storage → SQLite WAL roadmap, NO IMPL), r5 (ontology design),
r6 (extension type surface), r7 (UX sweep), r8 (zerolang — steal
conditional-write preconditions + projection identity, not artifact ownership),
r9 (editor deep study → the r9 report driving Phase 2/3).

Owner acceptance / activity: 6 feedback items delivered (tag styling, editor
cursor/delete fixes incl. multiline collapse + palette + alignment,
component architecture). Item 2's Phase 1 merged; Phase 2/3 in flight.

---

## Session update — 2026-08-24 (claude orchestrator, owner asleep)

Everything under "IMMEDIATE" below is DONE. Current main: see `git log`.

Done this session:
- **Disk/ENOSPC root-caused and fixed.** `/` was at 97%. `uv cache clean
  --force` freed 8.3G but Time Machine local snapshots held it; a real TM
  backup existed (2026-08-24 00:48) so the six oldest local snapshots were
  deleted. `/` went 7.8G → 16G free. The "pre-existing 50k benchmark timing
  failure" and the `palette-index` perf flake were host disk pressure — both
  pass now. Treat a reappearance as a real regression.
- **i8b merged** (`--no-ff`, tasks 10–12). Only the 3 CODE commits were merged;
  `5a6e7f5` (the pre-baked `.kb/nodes.jsonl`) was deliberately NOT merged
  because main's data had diverged under live owner edits. `migrateOrderKeys`
  runs automatically in `openKbEffect`, so restarting the UI migrated main's
  live data instead. Verified purely additive: 187 → 187 nodes, none lost or
  added, no field but `order` changed except the owner's own live renderer
  switch on `lens.all-mentions`. Committed separately.
- **One real regression caught by the merge**: `ontology migration > seeding
  into a pre-ontology store leaves every existing line byte-identical` failed,
  because the order migration rewrites every legacy line. codex had never run
  the full core suite. Assertion re-scoped to compare lines with `order`
  stripped, keeping its teeth (content must survive; new lines must be seed
  rows). Suite green before push.
- Verified green on main and pushed: core 643/0, typecheck clean, lint clean,
  UI 433/0.
- **UI restarted** on the merged build; serving 127.0.0.1:4321.
- **3D exists** — contrary to the owner's report. `force3d-graph.tsx`,
  `3d-force-graph@^1.80.0`, lazy chunk, and a "3D" pill in
  `renderer-switch.tsx`. So the complaint is discoverability or scene quality,
  not absence. Chasing that empirically is r10's Q1.

### Waves in flight (dispatched this session)

| Wave | Brief | Harness | Worktree |
|---|---|---|---|
| i8c | `briefs/i8c-editor-core.md` (r9 tasks 13–17) | codex, gpt-5.6-terra high | `kb-i8c-editor-core` |
| i10-polish | `briefs/i10-polish.md` (owner's live-review round) | cursor, Grok 4.5 High | `kb-i10-polish` |
| r10-graph | `briefs/r10-graph-deep.md` (research only) | claude | `kb-r10-graph` |

omp was dispatched for i10 first and pulled back: its good model is still
capped and it fell back to `gemini-3.7-flash-tiered`, too weak for a
taste-heavy typography/layout-shift round. Load is now spread one wave per
provider.

**r10-graph is new scope from the owner**, verbatim: "I feel like we need
careful consideration at which codeflow's graph to copy for what. and how to
pull it here properly. I think the graph is still not polished enough, and it
doesn't even have 3d." It is research-only and produces the ordered task list
for an i11 impl wave — that wave still needs dispatching once r10 lands.

---

## IMMEDIATE — verify/wrap up main state

1. `git status` shows `M .kb/nodes.jsonl` on main. Investigate: this is from
   the orchestrator's own `kb set <id> status done` bookkeeping (or a stray
   materialize). Decide: commit it (it's just todo-status bookkeeping; harmless)
   or `git checkout -- .kb/nodes.jsonl` to keep main clean. Prefer committing
   it with a `docs:` note so `docs/kb/*` stays materialized — run
   `bun tools/kb/src/bin/docs-materialize.ts` then stage, OR discard.

2. The UI is serving from the MAIN checkout at http://127.0.0.1:4321 (I restarted
   it on the merged build earlier; it auto-rebuilds `ui/dist` on source change,
   but RESTART it after you merge i8b — `kill <pid on :4321>` then
   `(nohup bun tools/kb/src/surface/cli.ts ui >/tmp/kb-ui-live.log 2>&1 &)`).
   Node count ~191 on live data.

---

## ACTIVE WAVE — i8b (editor Phase 2/3), partial

Worktree: `/Volumes/Data/workspace/repos/.dotfiles/kb-i8b-editor-core`
Branch: `popemkt/kb-i8b-editor-core` (4 commits, NOT merged).
Normative input: `docs/kb-waves/2026-08-23/reports/r9-editor-deep.md` §7 tasks
10–17. Brief: `docs/kb-waves/2026-08-23/briefs/i8b-editor-core.md`.

DONE (4 commits):
- `1b90a62` serialize text writes before structural mutations (task 10 MutationQueue)
- `3d40d05` cascade node deletion + graph tx validation (task 11)
- `14f736c` persist sibling order keys (task 12)
- `5a6e7f5` additive migration of `.kb/nodes.jsonl` order keys (task 12)

REMAINING (tasks 13–17): `13 CaretIntent` one-shot model · `14 FocusRegistry`
validated activation · `15 WS origin exclusion` → touches `src/surface/ui.ts` +
`protocol.ts` · `16 NodeTextHost` consolidation (md-view/table/board/title) ·
`17` spec reconciliation (r1 report + DESIGN-UI.md).

Why codex stopped: hit a HOST-LEVEL **ENOSPC** while running the full UI test
suite, then its model 5-hour usage limit (429) blocked omp. It self-reported:
"Focused task regressions and typechecks passed. The recursive Bun suite retains
its pre-existing 50k benchmark timing failure; a full UI run also encountered
host-level ENOSPC."

### Actions for i8b

1. Disk: `/Volumes/Data` is fine (57%, 8.9G for .dotfiles) BUT the system
   volume `/` is at **96% (only ~9.5G free)** — that's the ENOSPC source.
   Before re-running the full suite, free space on `/`: clear `~/Library/Caches`,
   `~/.npm/_cacache`, `~/.bun/install/cache`, stale `/tmp/kb* logs`, and remove
   node_modules from STALE merged worktrees (see cleanup section). Do NOT delete
   worktree sources still referenced by open Handoff.
2. Merge the 4 done commits into main FIRST (they're solid; the migration is
   additive and invisible). Then re-dispatch tasks 13–17 as a fresh session.
3. Harness for 13–17: codex worked well (fast, reliable) — reuse codex. omp's
   model (muse-spark) hit its usage cap; avoid omp until reset (~rest). If
   codex is also capped, use cursor-agent — after `worktree create --agent
   cursor`, you MUST send `a` to approve its "Workspace Trust Required" dialog,
   then re-send the task (its initial prompt is otherwise swallowed).
4. Reminder: `routa-coordination` HTTP 421 + `direnv .envrc blocked` + codex
   "Update available" menu are all environmental noise — dismiss (send `2` for
   codex update menu) and proceed; they are not task failures.

---

## NEXT ROUND — owner polish round (new feedback, no brief yet)

Owner just tested the live UI and wants a quick, thorough polish pass. Spawn a
new wave (suggest `i10-polish`, omp or codex) with this brief content:

1. **Font weight feels a bit big.** Try the Inter variable font — Tana uses
   Inter. Evaluate swapping the UI font stack to Inter var (self-host via
   `@fontsource-variable/inter` under Vite, or fallback). Consider body font-size
   and font-weight tokens in `tokens.css`. This is a designed decision: set
   `--font-sans` token, verify dark/light + all surfaces, ensure no layout shift
   on font load (use `font-display: swap` + preload subset).
2. **Eliminate layout shifts — be thorough (Tailwind is in use).** The tag pill
   × reveal on hover currently changes the pill LENGTH (shift). Research says
   the × is on the right of the label; Tana puts × over/near the hash. Fix so
   hover NEVER resizes the chip: fixed-width × slot that is always occupied
   (reserve a tiny fixed slot, or overlay/absolute position, or set a min-width
   with the name truncated). Sweep the whole UI for other hover/state-induced
   reflows (e.g. value row expansions, palette width jumps, toolbar toggles,
   board/table column widths, sidebar collapse).
3. **Tag font size still reads like node content.** We set 10/12px in i7 but the
   perceived size is still large — audit whether the inline tag render path in
   `node-content.tsx` uses the same small token as `TagChip`, and whether any
   place still hardcodes a bigger size. There may be TWO tag render paths
   (inline striped tags in node content vs the TagChip component) — unify them.
4. **Tag config → show as fields, not a special config panel.** The config panel
   was removed; the owner wants tags configured like any NODE (it IS a node).
   When you "configure"/open a tag, you should land on its node page showing its
   fields/props — with proper per-field-type renderings (color swatch picker for
   `sys.f.color`, text, ref, etc.). Treat tags un-specially; make the tag node
   page field editing work well. Add color-picker field rendering so `sys.f.color`
   edits from the field editor, not a bespoke panel.
5. **General mandate:** find MORE unpolished spots and fix them; make it solid.
   Sweep surfaces: outline row focus state, ghost/creation affordances after
   i8, graph chrome, canvas controls, palette keyboard coverage, empty/loading
   states, consistent reduced-motion, consistent focus rings, a11y roles on
   interactive row divs (`NodeRow` role/keyboard — flagged by i9 as a follow-up).

Constraints to give the worker: zone = `ui/src/components/outline/**`,
`ui/src/tokens.css`, `index.css`, `components/prefs/**`, tag node page rendering
in `node-panel`/`schema-section`, plus a font/package.json addition for Inter.
Do NOT touch graph/canvas internals (merged; separate concern) except where the
shift sweep flags an easy win — flag those in handoff instead.
Protocol: `docs/kb-waves/2026-08-23/briefs/impl-protocol.md` (gate first, zone
ownership, verify suite, conventional commits, never push/merge).

After this round pick a NEW worktree name (`kb-i10-polish`), merge, push, then
restart the UI.

---

## FLEET / worktrees (left for inspection — do NOT delete sources referenced here)

Active-ish:
- `kb-i8b-editor-core` → finish + merge (see above)
- `kb-i9-arch`, `kb-i8-editor-core`, `kb-i7-tags` → ALREADY merged (stale, safe to rm)

Merged & stale (safe to `orca worktree rm --force` to reclaim ~node_modules
disk, AFTER re-dispatching i8b + arch follow-ups): kb-i1-editor, kb-i2-graph,
kb-i3-canvas, kb-i4-backend, kb-i5-polish, kb-i6-ontology, kb-i7-tags,
kb-i8-editor-core, kb-i9-arch, kb-f-docs, kb-x-dx, kb-r1..r9.
If you free space on `/`, remember worktree node_modules live on /Volumes/Data
(not `/`), so deleting worktrees frees /Volumes/Data, not `/` — clear caches on
`/` to actually fix ENOSPC.

---

## Recurring gotchas (learned tonight)

- **omp/Pi**: reliable but its underlying model can hit a 5-hour usage cap
  (429). Check `terminal read` for "usage limit reached" before assuming a
  stall. It sometimes ends a turn at an empty prompt — NUDGE with "continue"
  via `terminal send` before killing.
- **opencode**: owner says it stalls asking questions on scoped tasks. Watchdog
  it (kill + redispatch) if it stalls; prefer other harnesses. (i9/r8 were
  opencode and succeeded; i8 phase-1 was omp.)
- **cursor-agent**: always hits "Workspace Trust Required" → send `a`, then
  RE-SEND the task prompt (initial prompt is swallowed). `--yolo` does NOT
  bypass it.
- **codex**: clean. Occasionally shows an updater menu — send `2`.
- Commit style: `<type>: <desc>`, `<type>` in feat/fix/docs/refactor/chore.
- Pre-commit runs FULL nix + kb checks on every commit → can be slow; success
  prints "kb docs out of date → run docs-materialize.ts" if generated docs
  drifted — materialize then re-stage.
- Never push branches individually unless instructed; orchestrator pushes main
  + merged worker branches per owner directive "push everything after merging".

## Quality bar (unchanged, briefs cite it)

Tana/CodeFlow/Excalidraw-level polish; ground-up correctness over patches;
CLI/backend source of truth; additive data-compat; suite green at every merge;
data `.kb/nodes.jsonl` never loses content; TODO content preserved.

## Harness priority (owner directive)

omp > cursor ≈ codex ≈ claude > opencode. Use omp for priority work; codex for
long model-heavy jobs; cursor for fresh zones (with trust approval); claude for
design/UX research (r5/r9 did well).
