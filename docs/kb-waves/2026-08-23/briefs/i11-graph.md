# Brief i11-graph — make the graph true, then make it good

Harness: TBD at dispatch. Protocol:
`docs/kb-waves/2026-08-23/briefs/impl-protocol.md`.

## Normative input

`docs/kb-waves/2026-08-23/reports/r10-graph-deep.md` — read it whole before
touching anything. Its §5 ordered task list is your work plan; §2's decision
table is binding on *what* to copy from CodeFlow and what to reject; §3 is
binding on *how* it lands. Where this brief and the report disagree, the report
wins and you note the conflict in your handoff.

The report exists because the previous graph wave (i2) implemented 5 of r2's 6
"copy wholesale" items, was graded A−, and the owner still said the graph was
"not polished enough" and "doesn't even have 3d". r10 drove the live UI and
found why: **three of the four renderers were built and broken in a way no test
caught**, and the owner's persisted default renderer was the one carrying none
of i2's chrome. Read r10 §1.0 first; it reframes the whole wave.

## Already fixed on main — do NOT redo

Three of r10's findings are already resolved. Verify, then build on them:

- `3b1f82f` — `readTokenColor` returned oklch (Chrome preserves the authored
  colour space in computed style) and `three-render-objects` parses via
  `polished`, which throws on oklch. That single throw aborted 3D scene init.
  Also restored the silently-dropped `alpha` option, so edge/label opacity is
  now correct in 2D, tree, and cluster. Tests: `ui/src/lib/css-color.test.ts`.
- `131877c` — `fitView`/`focusNode` fed raw post-layout coordinates to a camera
  that reads framed space, blanking the canvas on load and on Fit/Focus/search.
  Now reads `getNodeDisplayData`; fit math extracted pure. Tests:
  `ui/src/components/graph/graph-camera.test.ts`.
  **Your job on top of it:** r10 §2 row 2 wants two details this fix does not
  have — a screen-space transform and a zoom-in cap (CodeFlow caps scale at 2,
  i.e. ratio ≥ 0.5) so a 3-node lens does not zoom absurdly. Fold those in when
  you do row 2 properly.
- `64204d0` — `sys.f.lens.cluster-by` was absent on the only perspective, so all
  126 nodes resolved to the key `"none"`: one attractor, and force3d's cluster
  force pulled every node onto one point. Set to `parent` **as a data stopgap**.
  You own the real fix: decide the right default in code, make the choice
  discoverable (r10 §2 row 7), handle the >15-cluster overflow with an "other"
  bucket, and fix the force itself (row 13 — multiply by `alpha`, and clear the
  force when there are no groups).

One consequence for task 1: its acceptance says the harness must **fail**
against today's HEAD for force2d, cluster and force3d. The camera fix already
landed, so force2d's assertion may now pass. That does not weaken task 1 — write
the assertion anyway, and verify it fails by reverting `131877c` locally (or by
pointing the fixture at the pre-fix behaviour) so you have evidence the harness
has teeth. Cluster and force3d must still fail on HEAD; if they do not, find out
why before proceeding.

## Order of work

Follow r10 §5. Do not reorder it to get to the fun parts. In particular its
first item is a **rendering-truth test harness**, and that is deliberate: this
wave exists because "renders the data" was never asserted anywhere, so four
renderers could rot silently. Nothing else you build is trustworthy until a
test can fail when a canvas goes blank.

Polish-critical items (the owner's "not polished enough") outrank additive
capability. If you run short on time, ship the polish-critical set completely
and leave capability for a follow-up — say so in the handoff.

## The one structural change

r10 §3.2: chrome must stop being force2d-only. Extract a `GraphCanvasFrame`
owning toolbar, legend, info chips, cap notice, empty/error states, and the
keyboard map, with renderers declaring a capability descriptor. `graph-page.tsx`
becomes `frame(renderer)`, not `if (force2d) frame else bare`. Do this before
piling per-renderer polish on top, or you will port the same chrome four times.

## Hard rules

- Persisted vs transient is not negotiable (r10 §2 rows 7 and 17): every control
  the settings popover grows lands as a `sys.f.lens.*` prop so it survives
  reload, is queryable, and is settable from the CLI. Only genuinely transient
  state (search text, hover, transient isolation, popover open) stays in React.
- The data plane is invariant: `/api/graph` + `/ws` stay the only shared
  surface, renderers stay pure clients of `extractLensGraph`. No server change,
  no new query.
- `three` stays in its lazily-imported chunk. r10 notes there is still no test
  asserting the sigma/graph-page chunks never import it — add one (r2 §3 asked,
  i2 deferred).
- Additive data compat; `.kb/nodes.jsonl` keeps loading.
- Writing a multi-valued prop **appends** — `unset` before `set` when changing
  a single-valued lens prop. r10 §1.6 caught that a CLI writer can produce
  `renderer: ["force2d","force3d"]` and `strProp` silently takes the first.
  Add the assertion it asks for.

## Zone

`ui/src/components/graph/**`, `ui/src/lib/{graph-lens,graph-view}.ts`,
`ui/src/components/graph/*.test.*`, and the graph rows of `tokens.css` if a dim
treatment needs a token. The ontology page's local 11px chip (flagged by i10 as
a second chip path) is yours to unify if you touch that surface.

Do NOT touch `components/outline/**` or `components/canvas/**`.

## Verify (all four green before each commit)

```bash
cd tools/kb && bun install && bun test
npm run typecheck
npm run check
cd ui && ./node_modules/.bin/vp test
```

Baseline at dispatch: core 669 pass / 0 fail, typecheck clean, lint clean, UI
465 pass / 0 fail. Any failure is yours.

## Acceptance

A test fails if any renderer paints an empty canvas for a non-empty graph.
Every renderer has the shared chrome and the shared keyboard map. Drag actually
moves a node and the layout does not fight it. Cluster hulls are visible.
3D shows a labelled, navigable point cloud where clicking a node selects in
place instead of leaving the graph. Dim treatment is one theme-aware
alpha-based rule, not three colour substitutions. Self-grade honestly against
the CodeFlow/Obsidian bar and name what still falls short.

Handoff: `docs/kb-waves/2026-08-23/reports/i11-graph.handoff.md`.
