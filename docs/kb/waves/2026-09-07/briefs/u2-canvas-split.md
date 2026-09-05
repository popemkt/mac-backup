# u2-canvas-split — canvas-page.tsx becomes a shell over a pure pointer machine

Wave `u2` of `docs/kb/waves/2026-09-07/plan.md` (Decision 6). Harness: codex.
Branch from `main` @ `bd2303b`; rebase onto `main` once `u1` (UI import
matrix) lands, before your final verify. You own everything under
`tools/kb/packages/app/ui/src/components/canvas/**`, new pure modules under
`tools/kb/packages/app/ui/src/lib/canvas-*.ts` (+ tests), the god-components
row for `canvas/canvas-page.tsx` in `tools/kb/packages/app/ui/ARCHITECTURE.md`
(u1 edits a different section of that file — keep your hunk to that row),
and your report. Nothing else in `ui/src`.

Read first: `components/canvas/canvas-page.tsx` — all of it, once: :74-141
(`Drag`, seven kinds), :204 `CanvasPage` (one 1630-line component; 19
`useState`/`useRef`, doc IO with debounce + history at :204-300, pointer
handlers, overlays, the render tree from :1699), the pure modules that already
exist and that you build on, never duplicate: `lib/canvas-doc.ts`,
`lib/canvas-history.ts`, `lib/canvas-selection.ts`, `lib/canvas-tool.ts`,
`lib/canvas-color.ts`, `lib/canvas-api.ts` (each with a test), the sibling
components `canvas-card.tsx`, `shape-card.tsx`, `edge-inspector.tsx`,
`node-picker.tsx`, `canvas-toolbar.tsx`; `ARCHITECTURE.md` ("God components"
plan for this file: page shell / tool machine / selection / render layer;
"Stores" and "Side effects" rules); `src/catalog/*canvas*` stories if any;
`AGENTS.md` Rule 1; the two-mechanism rule for any `complexity` disable you
would otherwise add. Run `intent/gate.sh session codex` first.

## Why

The page is the largest unit in the repo and the only one with no test of its
own. Its pure parts were already extracted (doc, history, selection, tool);
what remains tangled is the pointer/drag state machine, the persistence
debounce, and the render tree, all inside one closure sharing nineteen pieces
of state. Splitting it is not about line count: it is about the drag machine
becoming a function that can be tested from the rejecting side.

## Shape (behaviour-preserving; the UI does exactly what it does today)

Commit 1 — `test(kb-ui): characterize CanvasPage before splitting it`.
A component test `canvas-page.test.tsx` that renders `CanvasPage` against a
fixture store (use the reset fixture if `u3` has landed; otherwise the literal,
and note it) and drives pointer events through the existing DOM: select a
card, drag it, marquee two cards, pan with space, resize a corner, draw an
edge between ports, undo. Assert on the doc the persist path receives (mock
the api at the `lib/canvas-api.ts` seam). This is the gate for every commit
that follows; it must pass unchanged at the end.

Commit 2 — `refactor(kb-ui): the canvas pointer machine is a pure reducer`.
`lib/canvas-pointer.ts`: `type PointerState = { drag: Drag | null; marquee; snapGuides; … }`,
`pointerReduce(state, event: PointerEvent', ctx: { doc, selection, zoom, pan, byId })
→ { state, doc?: CanvasDoc, selection?: CanvasSelection, guides }` — the seven
`Drag` kinds and `closestPort`/`snapOffset` (:142-203) move here. The
component keeps one `useReducer`/ref pair and dispatches. Property/unit tests
in `lib/canvas-pointer.test.ts` from the rejecting side: a move without a
prior down is a no-op; resize never inverts a rect; snapping only ever moves
toward a guide; an edge drag that ends off-port creates nothing. No React in
this file.

Commit 3 — `refactor(kb-ui): persistence and history leave the component`.
`lib/canvas-persist.ts` or a hook `use-canvas-doc.ts` in `components/canvas/`:
`applyDoc`/`applyDocSilent`/`schedulePersist*`/`flushPersist` and the
dirty/timer refs (:246-300) as one unit with one contract: "the last doc
applied is the one persisted, at most once per debounce window, and flushed
on unmount". Test that contract with fake timers.

Commit 4 — `refactor(kb-ui): canvas render layer`.
The JSX from :1699 becomes `canvas-stage.tsx` (cards, shapes, edges, marquee,
guides — props in, callbacks out) and `canvas-overlays.tsx` (inspectors,
picker, toolbar anchoring). `canvas-page.tsx` is left as the shell: store
selectors, the pointer reducer, the persist hook, and composition — target
under 300 lines, but the number is a symptom, not the goal; if a piece does
not have a name that a reader could guess, it is in the wrong file.

Rules: no new `complexity`/`max-lines` disables — if a function still trips
`complexity`, split it. No new store fields. Selectors, not the whole store.
No behaviour change; if you find a bug, leave it, file a `#gap`, and mention it
in the report. Update the god-components row to what remains.

## Report

`docs/kb/waves/2026-09-07/reports/u2.md`: the file map before/after with line
counts, the reducer's event vocabulary, which of the seven drag kinds had
hidden behaviour you had to preserve verbatim (and where), the characterization
test's coverage of the interactions list, bugs found and gapped, verify /
`test:ui` output.
