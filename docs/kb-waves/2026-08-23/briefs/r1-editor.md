# Brief r1 — Outline editor: defect audit + Tana-grade interaction spec

Agent: omp. Research only this wave — NO implementation, NO commits.

## Mission

The owner says the outline editor is buggy ("ghost bullet content not aligned
with the content block above it" is one example). Produce (1) a complete,
reproduced defect list and (2) an interaction spec at Tana's polish level that
the implementation wave will build against.

## Read first

- `.research/kb-refine/tana/report.md` (+ screenshots) — the bar we match
- `.research/kb-refine/kb-audit/report.md` — prior coverage baseline
- `tools/kb/DESIGN-UI.md`, `DESIGN-REFINE.md`, `DESIGN-RESKIN.md`
- `tools/kb/ui/src/components/outline/**` (all files), `ui/src/stores/outline.store.ts`
- `tools/kb/ui/src/actions/**`, `ui/src/lib/refs.ts`

## Do

1. Boot the app (`bun tools/kb/src/surface/cli.ts ui` from repo root, serves
   127.0.0.1:4321) and exercise editing hard: split/merge at boundaries,
   indent/outdent across collapse states, ghost rows (empty child placeholders),
   zoom in/out mid-edit, IME-ish input, ref autocomplete interplay, field
   editing inside rows, undo-less failure modes.
2. For every defect: exact repro steps, root cause hypothesis with file:line,
   severity, and whether the fix is local or signals a wrong abstraction.
3. Write the interaction spec: focus model, key map, selection model, ghost
   row semantics, alignment/geometry rules (row metrics must come from one
   token source), collapse/zoom edge cases, what Tana does differently and why.
4. Explicitly resolve: should ghost bullets exist at all? What alignment rule
   makes ghost content line up with real rows? Name the invariant.

## Deliverable

`docs/kb-waves/2026-08-23/reports/r1-editor.md`:
- Defect table (repro / cause / severity / fix class)
- Interaction spec (normative "MUST" statements the implementer can follow)
- Abstraction verdicts (keep vs replace, per subsystem)
- Suggested test plan (which cases get automated tests)

## Constraints

- Do not modify any file outside your report path.
- Do not commit. Leave the report uncommitted; the orchestrator collects it.
- Run `./intent/gate.sh session omp` first (repo gate).
