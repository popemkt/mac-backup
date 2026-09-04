# Brief r10-graph-deep — what to steal from CodeFlow's graph, for what, and how

Harness: claude. **RESEARCH ONLY** — no implementation, no commits to code.
Your deliverable is one report; an impl wave (i11) will execute it.

## Why this exists

The owner reviewed the live graph after i2-graph merged and said, verbatim:

> "I feel like we need careful consideration at which codeflow's graph to copy
> for what. and how to pull it here properly. I think the graph is still not
> polished enough, and it doesn't even have 3d."

Two things follow. First, the last graph wave shipped real work but did not
land as polish in the owner's hands — so this is a **gap-of-the-gap** study,
not a fresh survey. Second, the 3D remark is factually wrong in a way that is
itself the most important finding to chase: a `force3d` renderer DOES exist
(`ui/src/components/graph/force3d-graph.tsx`, `3d-force-graph@^1.80.0`,
lazy-loaded, with a "3D" pill in `renderer-switch.tsx`). The owner did not
experience it. **Find out why, empirically, before theorising.** Candidate
causes: the pill is not discoverable; the lazy chunk fails at runtime; the
scene loads without fit-to-view so it reads as an empty or unreadable blob;
the perspective's persisted renderer never gets switched. Actually run it and
report what happens.

## Prior art already in the repo — read before starting

- `reports/r2-graph.md` — the previous CodeFlow-parity plan. Its §1 gap table,
  §1.2 "copy wholesale" list, §2 renderer decision, and its §3 verdict that
  "3D is exploratory, not primary navigation" are all now **up for review**.
  The owner's signal is evidence against that verdict; re-argue it either way
  on the merits.
- `reports/i2-graph.handoff.md` — what i2 actually shipped and what it cut.
- `.research/kb-refine/graphviz/report.md` — the original CodeFlow study; it
  locked "one graph, many lenses" (every viz = datalog query →
  `{nodes, edges}` → renderer). That principle is NOT up for review.
- `.research/kb-refine/viz/report.md`, `.research/kb-refine/nxus/report.md`.
- `tools/kb/INSPIRATIONS.md` rows "Graph renderer types" and "Graph
  interaction vocabulary"; `tools/kb/DESIGN-UI.md`; `DESIGN-REFINE.md` §W6.
- CodeFlow source: `github.com/braedonsaunders/codeflow`. A clone from the
  previous wave survives at `/tmp/codeflow-study` (`index.html`, ~10.8k
  lines). Re-clone fresh if it is stale; cite line numbers either way.
- Current implementation: `tools/kb/ui/src/components/graph/**` and
  `ui/src/lib/{graph-lens,graph-view}.ts`.

## The four questions to answer

**Q1 — Ground truth: what does the graph actually do today?**
Run the live UI (`kb ui`, 127.0.0.1:4321, ~187 nodes of real data) and drive
every renderer: force2d, tree, cluster, force3d. Report per renderer what
works, what is broken, what is merely unpolished, and specifically what
happens when a user tries to reach 3D. Separate "i2 never built it" from
"i2 built it and it regressed" from "it works and is undiscoverable" — the
fix differs completely in each case. Screenshots or precise observed
behaviour, not inference from source.

**Q2 — Which CodeFlow subsystem to copy, for what, and which to reject.**
This is the owner's central ask and the core of the report. Produce a decision
table, one row per CodeFlow graph subsystem (layout engine and its sub-modes,
node drag/reheat, select-in-place + blast-radius colouring, animated camera
verbs, settings popover, legend-as-filter, info chips, label truncation and
density, edge aggregation/arrows/curvature, hull rendering, the 3D scene
setup, adaptive params by size). Each row: **Copy wholesale / Adapt / Reject**,
what kb gets from it, what it costs, and *why* — including what kb should NOT
take because kb's data model is better (persisted queryable perspectives,
configurable cluster-by, sys-node elision). A reject with a reason is as
valuable as a copy; do not pad the table with everything.

**Q3 — How to pull it in properly.**
CodeFlow is a single ~10.8k-line `index.html`. Say concretely how its
behaviour crosses into kb's architecture: which parts are portable logic vs
which must be rewritten against sigma/graphology/three; where each piece lands
in the existing component layout; what stays in the data plane (`/api/graph`,
`/ws` — invariant) vs the renderer clients; how state that CodeFlow keeps in
ephemeral React state becomes a persisted `sys.f.lens.*` prop on a perspective
node (kb's rule: UI actions reachable through data); and the bundle discipline
(three.js stays a lazy chunk; no new heavy deps without justification). Flag
anything that cannot be ported cleanly and say what to build instead.

**Q4 — 3D: what it should be.**
Re-decide, with the owner's signal on the table: is 3D exploratory or a
first-class navigation mode? Then specify what "has 3D" should mean here —
fit-to-view on load, camera controls, autorotate, curved links, directional
particles on selected links, link width by weight, label sprites, cluster
forces (kb already has Fibonacci-sphere cluster forces per r2), selection and
hover parity with 2D, and how a user discovers it at all. Assess whether
`3d-force-graph@1.80` remains the right vehicle or whether the scene should be
driven against three.js / react-three-fiber directly — answer on quality,
bundle size, maintenance, and license, and pick one.

## Deliverable

`docs/kb/waves/2026-08-23/reports/r10-graph-deep.md`, committed on your
branch. It must contain:

1. Q1 ground-truth findings, per renderer, from actually running it.
2. The Q2 decision table (copy / adapt / reject + rationale).
3. The Q3 porting plan, mapped onto real file paths.
4. The Q4 3D verdict and its specification.
5. **An ordered, independently-shippable task list for i11** in the shape of
   r9 §7: each task names its acceptance test and its file zone, ordered so
   each lands on the one before it. Mark which tasks are polish-critical (the
   owner's "not polished enough") versus additive capability.
6. A named list of what you deliberately excluded and why.
7. Sources with line-level citations for every CodeFlow claim.

## Rules

- Research only. You may run the UI, read, clone, and experiment in `/tmp`;
  do not modify `tools/kb/**`. Commit only your report.
- MUST-statements in your report become normative for i11, so only write a
  MUST you would defend to an implementer at 3am.
- Where you contradict r2, say so explicitly and give the reason. r2 was
  competent work against less evidence than you have.
- Quality bar: CodeFlow/Obsidian-level graph feel. "Renders the data" is not
  the bar; "a user wants to keep exploring" is.
- Run `./intent/gate.sh session claude` before starting.
