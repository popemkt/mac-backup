# Brief i3-canvas — Canvas professionalism overhaul

Harness: omp. Zone: `tools/kb/ui/src/components/canvas/**`,
`tools/kb/src/canvas/**` (if it exists), `ui/src/lib/canvas-*` + tests.
Protocol: `docs/kb/waves/2026-08-23/briefs/impl-protocol.md`.

Research input: `docs/kb/waves/2026-08-23/reports/r3-canvas.md` — normative
(38-item audit). Headline requirements: full node CRUD including DELETE
(keyboard + menu; deleting a kb-node card must never touch the underlying
node), proper selection model (single + rubber-band multi-select), pointer
interaction quality (thresholds, hit targets, cursor feedback), edge UX within
"edges are drawings", JSON Canvas 1.0 round-trip stays lossless.

Respect the report's deliberate non-goals (no freehand/rotation/z-index
machines) — simplicity rule.

Order of work: data-layer correctness first (document ops as pure functions +
tests), then interaction layer, then micro-polish (cursors, hover states,
snapping stance per report). Automated tests for document ops mandatory;
interaction smoke-tested live per protocol acceptance style.

Acceptance beyond the suite: create/move/select-multi/delete/undo-or-not per
spec feels like Excalidraw-tier direct manipulation; no stuck states, no lost
cards, round-trip preserves unknown fields.
