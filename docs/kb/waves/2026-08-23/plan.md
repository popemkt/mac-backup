# kb refinement wave — 2026-08-23 (overnight)

Owner is asleep. Orchestrator: opencode (this session). Workers: Orca-managed
worktrees running omp / opencode / codex / claude agents (omp + opencode priority).

## Mission

Bring `tools/kb` to the polish level of its inspirations (Tana, CodeFlow, nxus,
Logseq, Excalidraw) — professional, thoughtful UX — while fixing half-baked
backend abstractions ground-up so nothing subtle breaks later. Plus two research
tracks and one new feature core.

## Quality bar (applies to every wave)

1. **Inspiration parity is the acceptance criterion.** Every interaction should
   feel as considered as Tana's outliner / CodeFlow's graph / nxus's skin.
   "Works" is not done; "feels designed" is done.
2. **Ground-up correctness over patches.** If an abstraction is wrong, replace
   it; do not bolt on special cases. Simplicity rule stands (INSPIRATIONS.md):
   features that demand heavy edge-case plumbing get simplified or dropped.
3. **CLI/backend stays source of truth.** UI is a projection; anything UI does
   must be reachable through data.
4. **Never regress the check suite**: `bun test`, `npm run typecheck`,
   `npm run check`, `vp test` green before any merge.
5. **Data compat**: additive schema evolution OK; existing `.kb/nodes.jsonl`
   must keep loading; TODO content preserved.

## Work items

| # | Item | Type | Wave |
|---|---|---|---|
| A | Outline editor bugs (ghost-bullet alignment etc.) → Tana-grade editing | fix+polish | I1 |
| B | Graph view polish to CodeFlow level ("one graph, many lenses") | overhaul | I1 |
| C | Canvas professionalism (delete nodes minimum; selection, undo, zoom quality) | overhaul | I1 |
| D | Backend abstraction hardening (half-baked internals made perfect) | refactor | I1 |
| E | Performance/storage research — "reliable as a db", long-term scale | **research only** | R |
| F | Ontology — ambitious design, implement core only | research → impl | R → I2 |
| G | Extension public type surface — how non-bundled `.kb/extensions/*.ts` get internal types | design → small impl | R → I1/I2 |
| H | Whole-surface UX audit (palette, search, views, sidebar, systemic states) | research → polish wave | R → I3 |

Owner directive (2026-08-23 late): find and polish as much as possible — the
named items are examples, not the full list. Every researcher sweeps their
surface beyond the brief; r7 owns the rest of the app.

## Waves

### R — Research & design (parallel, ~6 workers)

Deliverables land in each worker's worktree at
`docs/kb/waves/2026-08-23/reports/<name>.md` (uncommitted); orchestrator reads,
curates, commits centrally to main.

- r1-editor (omp): reproduce every outline editor defect; produce defect list +
  Tana-grade interaction spec. Inputs: tana/report.md distillation,
  kb-audit/report.md, ui/src/components/outline/**.
- r2-graph (opencode): CodeFlow parity plan for graph view. Inputs:
  .research/kb-refine/graphviz/report.md (CodeFlow study), nxus/report.md;
  may re-clone github.com/braedonsaunders/codeflow to /tmp. Output: renderer
  catalog gaps, layout-engine decision (may propose modern libs), interaction
  spec, perf notes.
- r3-canvas (omp): canvas professionalism plan. Inputs:
  .research/kb-refine/canvas/report.md, current canvas components. Must cover:
  node delete + full CRUD, selection model, undo/redo stance, zoom/pan quality,
  edge UX within Logseq "edges are drawings" rule.
- r4-perf (codex): storage/performance architecture research ONLY, no code.
  Question: how does kb stay reliable-as-a-db at 10x–1000x growth? Evaluate:
  append-log JSONL durability/crash-safety, compaction/snapshots, indexing,
  server-side DataScript vs alternatives, query performance, memory profile,
  migration story. Deliver options analysis + staged roadmap recommendation.
- r5-ontology (claude): ambitious ontology design (full scope) + core-only
  implementation spec. Ontology ≈ supertag sets/tree/graph as a scoping lens:
  entering an ontology shows only its member nodes and how they connect.
  Design data model on top of everything-is-a-node, editing experience,
  interplay with tags/fields/#graph-perspective queries, migration compat.
- r6-ext-sdk (opencode): public type surface for external extensions. How can
  `.kb/extensions/*.ts` authors import ActionDefinition etc.? Study loader
  resolution (src/extensions.ts, Bun semantics), decide between package
  exports map / generated d.ts SDK / ambient types; verify type-only imports
  erase at runtime for out-of-package files. Output: chosen design + impl spec.
- r7-ux-sweep (codex): whole-surface audit of every UI area not owned by
  r1–r3 (palette, search, node panel, views, sidebar, query page, prefs,
  systemic loading/empty/error states, keyboard consistency). Output: ranked
  findings + i5-polish task proposal.
- r8-zerolang (omp): study Vercel's zerolang (talk-directly-to-the-compiler,
  .0-file projections) against kb's projection/view/extension seams; extract
  adoptable ideas ranked by value/effort. Owner directive 2026-08-23 late.

## Harness policy (owner directive, late 2026-08-23)

- opencode tends to stall asking questions on scoped tasks: keep opencode
  sessions short-scoped and WATCHDOGGED — if one runs long without terminal
  progress, orchestrator stops it and re-dispatches to another harness.
- cursor (`cursor-agent`) joins the pool from wave i4 onward.
- Priority order now effectively: omp > cursor ≈ codex ≈ claude > opencode
  (for dispatch of new waves).

### I1 — Implementation round 1 (parallel ×4)

File ownership partition (workers MUST NOT edit outside their zone):

| Worker | Zone |
|---|---|
| i1-editor | `tools/kb/ui/src/components/outline/**`, `stores/outline.store.ts` + own tests |
| i2-graph | `tools/kb/ui/src/components/graph/**` + own tests |
| i3-canvas | `tools/kb/ui/src/components/canvas/**` + own tests |
| i4-backend | `tools/kb/src/foundation/**`, `src/operations/**`, `src/extensions.ts`, `tools/kb/package.json`, extension SDK surface |
| i5-polish | r7 findings outside the other zones: palette, search, views, sidebar, systemic states (spawned when research lands) |

Shared-file policy: `App.tsx`, `index.css`, `tokens.css`, `ds/**`,
`surface/ui.ts` wire format are coordination points — keep edits minimal/
additive and list every shared-file touch in the worker handoff note.
i4-backend must keep the HTTP/WS API backward compatible this wave.
New deps allowed per component (`ui/package.json` additions are additive;
merge conflicts there resolve trivially).

### I2 — Ontology core (sequential after I1 merge)

Single worker implements r5's core spec against merged main. Mostly new files
(`src/foundation/ontology*`, `ui/src/components/ontology/**`) to avoid churn.

### F — Final integration (orchestrator + 1 reviewer agent)

Cross-feature regression pass, docs updates (DESIGN*.md, INSPIRATIONS.md
lineage rows for anything adopted), full check suite, final report for owner.

### X — Repo-wide DX & functionality polish (after F)

Owner directive: "once you're done, find stuff and polish the repo, both dx
wise and functionalities wise." Sweep beyond tools/kb: script ergonomics,
hook latency, stale docs vs reality, confusing errors, missing conveniences.
Fix what's safe; log the rest as findings for owner review.

## Merge protocol (per implementation branch)

1. In worktree: `bun install && bun test`; `npm run typecheck`;
   `npm run check`; `vp test`.
2. Worker commits on its branch (conventional `<type>: <desc>` style).
3. Orchestrator merges --no-ff into main sequentially, resolving shared-file
   conflicts centrally; re-runs suite on main after each merge; smoke-tests
   `kb ui` boot.
4. Push policy (owner directive 2026-08-23 late): after merges complete,
   orchestrator PUSHES everything to origin (main and merged worker
   branches). Individual workers still never push.

## Risks

- Shared-chrome conflicts → minimized by ownership zones + orchestrator merges.
- Dep duplication across graph/canvas → orchestrator reconciles versions at merge.
- Ontology scope creep → r5 explicitly separates "design (ambitious)" from
  "implement tonight (core only)".
- Research quality drift → orchestrator reviews reports against briefs before
  spawning implementation waves; weak reports get a follow-up pass.

## Status log

- [x] W0 baseline: dirty leftover work committed (packaged-ui build fix, pins,
      docs), main clean @ 4c43d5b+ , gates green.
- [x] R wave: r1–r7 delivered; r8 redispatched omp→codex after stall, delivered.
- [x] I wave: i1/i2/i3/i4/i5/i6 all merged & pushed; suites green
      (607 core + 397 UI tests).
- [x] F/X waves merged & pushed (docs integration, repo DX).
- [ ] Owner-feedback wave (post-merge review, 6 items):
      r9 editor-deep research (claude) → i8 editor-core fix (omp, after r9);
      i7 tags+alignment (omp); i9 component architecture (cursor).
      Items: tag chip sizing/space/configure-removal; ghost/plus bugs
      (click failures, wrong insert position, delete gaps, cursor jumps);
      inline palette verification; multiline-collapse question; field/prefs
      alignment; component encapsulation + catalog.
