# Brief i2-graph — Graph view: CodeFlow-parity overhaul

Harness: omp. Zone: `tools/kb/ui/src/components/graph/**`,
`ui/src/lib/graph-lens.ts` + graph tests. Protocol:
`docs/kb-waves/2026-08-23/briefs/impl-protocol.md`.

Research input: `docs/kb-waves/2026-08-23/reports/r2-graph.md` — normative,
including its dependency proposal and perf budget. Headline fixes in order:

1. CRITICAL: select-and-explore in graph (click selects with blast-radius
   recolor; navigation to outline becomes a deliberate action, not a
   click-away accident).
2. HIGH: live force layout with settle animation + node drag w/ reheat;
   animated camera (+/−/fit/reset); label truncation + density-aware hide.
3. HIGH: directed edges (arrows for mentions), kind distinction, edge width ∝
   multiplicity.
4. In-graph search/filter + legend/toolbar chrome per report §5.
5. tree renderer pan/zoom + fit-view; cluster hull smoothing.

Keep the locked principle intact: renderers stay pure clients over
datalog → {nodes, edges}; no data-plane changes. New deps only per report's
proposal; pin exact versions; reconcile any overlap with other waves' deps
in your handoff note.

Acceptance beyond the suite: 10k-node synthetic graph stays interactive
(report's budget); every interaction in its spec table has hover/select/
camera feedback matching CodeFlow feel; zero giant untruncated labels at any
zoom.
