# Brief i13-graph — finish the frame, then the capability tier

Harness: cursor. Protocol:
`docs/kb/waves/2026-08-23/briefs/impl-protocol.md`.

## Normative input

`docs/kb/waves/2026-08-23/reports/r10-graph-deep.md` — §2's decision table
binds what to copy from CodeFlow and what to reject, §3 binds how it lands,
§5 tasks **13–16** are your work plan. Read `reports/i11-graph.handoff.md`
first: it shipped tasks 2–12 and task 9's `GraphCanvasFrame`, and it names
exactly what it left unfinished.

## Task 0 — finish task 9 properly, before anything else

i11 shipped `GraphCanvasFrame` but not the **renderer capability
descriptors**. Its own handoff: "currently unsupported toolbar actions are
visible but only Sigma-backed actions execute."

A visible button that silently does nothing is worse than no button — it is the
same class of defect as this whole cycle (an affordance that lies about what it
does; the owner's "it doesn't even have 3d" was a labelled pill that rendered
nothing). Fix it first:

- Give each renderer a capability descriptor per r10 §3.2:
  `{ fit, zoom, reset, focus, search, selection, dim, drag }`.
- The frame renders the **intersection** and **disables** — visibly, with a
  reason on hover — everything the active renderer cannot do. Never render a
  live-looking control that no-ops.
- Kill the `sigmaRef: MutableRefObject<Sigma | null>` assumption in
  `GraphToolbar`: the frame must drive non-sigma renderers (tree, force3d)
  through adapters, not by assuming a `Sigma` instance.
- The keyboard map (`Esc`/`Enter`/`f`/`0`/`+`/`-`/`/`) must work in all four
  renderers or be explicitly unbound where unsupported.
- Finish **tree selection parity**, which i11 left incomplete: clicking selects
  in place; only `Open` navigates.

## Then r10 §5 tasks 13 → 14 → 15 → 16, in that order

Two priority notes that override the report's PC/A tags:

- **Task 13's `cluster-by` control is polish-critical.** Its invisibility is
  half of why the cluster renderer and 3D both degenerated (r10 §1.0), and the
  current correct value only exists because the orchestrator hand-set it as a
  data stopgap (`64204d0`). Make it a first-class, discoverable control, decide
  the right default **in code** (`seed.ts` already seeds `force2d` for the
  renderer — do the same for `cluster-by`), and handle the >15-cluster overflow
  with an "other" bucket rather than a tail of unlabeled specks.
- **Task 16(c), the in-canvas error state, rides early with task 0** — both
  touch the frame, and it is the direct guard against the silent blanks this
  cycle was spent chasing. Include `resolveNodeSet`'s `console.warn`-only path.

## Hard rules

- **Persisted vs transient is not negotiable** (r10 §2 rows 7 and 17). Every
  control the settings popover grows lands as a `sys.f.lens.*` prop so it
  survives reload, is queryable, and is settable from the CLI. Only genuinely
  transient state (search text, hover, transient isolation, popover open)
  stays in React. This is the axis where kb is structurally ahead of CodeFlow
  and it must not regress.
- Writing a multi-valued prop **appends**. `mutations.setLensProp` must
  **unset before set**, and you must add the assertion r10 §1.6 asks for — it
  caught a CLI writer producing `renderer: ["force2d","force3d"]` with
  `strProp` silently taking the first.
- Data plane invariant: `/api/graph` + `/ws` stay the only shared surface;
  renderers stay pure clients of `extractLensGraph`. No server change, no new
  query.
- `three` stays in its lazily-imported chunk, and task 16(a) finally asserts
  it. Task 16(b) asserts every colour handed to the 3D renderer matches
  `/^(#|rgba?\()/` — that is the rule behind `3b1f82f`, where an `oklch()`
  token thrown into `polished` blanked the entire scene.
- `metro` layout is explicitly **not** implemented (r10 §2 row 8).
- Additive data compat; `.kb/nodes.jsonl` keeps loading.

## Zone

`ui/src/components/graph/**`, `ui/src/lib/graph-*.ts`,
`ui/src/actions/mutations.ts`, `ui/src/components/graph/*.test.*`,
`tools/kb/src/foundation/seed.ts` for the `cluster-by` default, and the graph
rows of `tokens.css` if a treatment needs a token.

**Do not touch `tools/kb/ui/package.json`, lockfiles, or anything Playwright** —
a concurrent wave (i12-render-harness) owns those and is adding a browser test
suite. If it adds a `data-testid` hook inside your files, rebase onto it rather
than reverting it. Do not touch `components/outline/**` or
`components/canvas/**`.

## Verify (all four green before each commit)

```bash
cd tools/kb && bun install && bun test
npm run typecheck
npm run check
cd ui && ./node_modules/.bin/vp test
```

Baseline: core 680 pass / 0 fail, typecheck clean, lint clean, UI 470 pass / 0
fail. Any failure is yours.

## Acceptance

No toolbar control is ever visible-but-inert. Every renderer carries the shared
chrome and keyboard map. Changing any settings control twice leaves exactly one
value on its prop, and a reload preserves it. `kb set` from the CLI moves the
UI. Clicking a node in 3D keeps you in 3D. A thrown renderer error draws a
message inside the canvas frame and leaves the rest of the page interactive.
Self-grade against the CodeFlow/Obsidian bar and name what still falls short.

Handoff: `docs/kb/waves/2026-08-23/reports/i13-graph.handoff.md`.
