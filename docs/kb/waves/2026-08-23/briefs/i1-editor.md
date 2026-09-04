# Brief i1-editor — Outline editor: Tana-grade rebuild

Harness: opencode. Zone: `tools/kb/ui/src/components/outline/**`,
`ui/src/stores/outline.store.ts`, `ui/src/actions/**`, `ui/src/lib/refs.ts` +
their test files. Protocol: `docs/kb/waves/2026-08-23/briefs/impl-protocol.md`.

Research input: `docs/kb/waves/2026-08-23/reports/r1-editor.md` — normative.
Its headline verdicts: remove permanent ghost rows entirely (Tana-style
transient empty nodes, auto-pruned on blur-empty), One-Row Metric Invariant
via a single token source, visual-line caret navigation replacing naive
offset checks, collapse-safe indent mutations. Fix every defect in its table,
including D04 (IME destruction) and D05 (critical indent/focus loss).

Order of work: invariants/token source first, then store/plan contract fixes,
then interaction spec conformance, then polish passes. Add automated tests for
the report's suggested test plan before considering done.

Acceptance beyond the suite: boot the app and run the report's repro steps —
every listed defect must be unreproducible; typing must feel instant at the
ghost/creation boundary with zero caret jumps.

Shared-file touch policy applies strictly (`node-block.tsx` consumers outside
the zone: coordinate via handoff note only).
