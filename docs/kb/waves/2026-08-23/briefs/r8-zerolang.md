# Brief r8 — ZeroLang study vs kb's projection seam

Agent: omp (fresh instance). Research only — NO implementation, NO commits.

## Mission

Owner pointer: Vercel's **zerolang** has "a pretty interesting idea of talking
directly to the compiler and projecting the .0 files themselves." kb has a
kindred mechanism: projections/views — rendered HTML views over datalog
queries (`render.views` / `ui://kb/view/*` MCP resources / `render_view`
tool), materialized docs (`docs/kb/*.md` via `docs-materialize`, guarded by
pre-commit), live query nodes in the outline, and the extension action seam
(`.kb/extensions/*.ts` + registry namespacing).

Study zerolang deeply, then answer: what should kb steal?

## Do

1. Web-research zerolang (Vercel): find repo/docs/posts (websearch + webfetch;
   clone source to /tmp if public). Extract its actual architecture: what are
   `.0` files, who writes/reads them, how do agents/tools talk to the
   compiler, what does "projecting the files themselves" mean concretely,
   caching/incrementality story, how round-trips stay lossless.
2. Map kb's current projection surfaces precisely:
   - `tools/kb/src/render/**` backbone + view JSON/template shape
   - `tools/kb/src/operations/docs/**` materialize/check contract
   - `src/surface/protocol.ts` subscriptions + MCP view resources
   - `#query` nodes rendering live results while expanded
   - extensions producing/consuming actions (`ext.*`)
3. Comparison: for each zerolang idea worth stealing, name the kb analog,
   the delta, and whether adopting it strengthens the ground-up model or
   violates simplicity rule. Candidates to evaluate honestly:
   - artifacts-as-source-of-truth (views/materializations becoming first-
     class committed artifacts agents read/write directly, with compiler
     (kb) validating rather than regenerating blindly)
   - direct-to-compiler protocol for agents (instead of text-in/text-out)
   - incremental/cached projections keyed by content hash
   - lossless round-trip guarantees as an API contract
4. Recommendation: 2–4 concrete adoptable ideas ranked by value/effort, each
   with a small design sketch + which future wave could implement it.
   Explicitly mark NOT-worth-stealing ideas and why (simplicity rule).

## Deliverable

`docs/kb/waves/2026-08-23/reports/r8-zerolang.md`.

## Constraints

- `./intent/gate.sh session omp` first.
- Clone/scratch only in /tmp; modify nothing tracked except your report.
