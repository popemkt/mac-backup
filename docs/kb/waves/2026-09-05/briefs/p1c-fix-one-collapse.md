# p1c-fix-one-collapse — one child-order mechanism, honest round-trip test, rule-clause typing

Fix-up wave for `p1c` after the coordinator's review of merge `50695be`.
Harness: cursor (grok 4.6 high). Branch from `main` **after p1b is merged**
(the coordinator gives you the base). You own exactly what p1c owned:
`packages/domain/query/src/ir/**`, the execution half of
`packages/domain/query/src/datascript.ts` (`query`, `queryRows`, `pull`,
revival, `runIr`, `normalizeQueryInput`), and
`packages/domain/query/tests/{datascript,ir}.test.ts`. Not `index/**`, not
any consumer package. Run `intent/gate.sh session cursor` first; standing
rules in `docs/kb/waves/2026-09-05/plan.md` apply; report to
`docs/kb/waves/2026-09-05/reports/p1c-fix-one-collapse.md`.

## Blocker — two implementations of the child-order fix (Rule 1)

`datascript.ts` `rewriteChildOrderCartesian` + `dropUnusedFindVars` (regex
string rewrite, used by `query()`) and `ir/parse.ts` `collapseChildOrder` +
the `children` clause in `ir/compile.ts` (AST transform, used by
`compile(parseEdn())`) solve the same defect with two mechanisms. The regex
one is also fragile: `dropUnusedFindVars` counts occurrences without a word
boundary, so `?ord` inside `?ordinal` inflates the count and the `:find` var
survives while its binding clause is gone.

Required shape: **one mechanism.** `query(edn)` routes through
`compile(parseEdn(edn))` (structured IR when the subset parses, `raw` when it
does not) and then executes. Delete `rewriteChildOrderCartesian` and
`dropUnusedFindVars`. The existing red test (3 children → 3 rows, not 9) must
still pass through `query()`. If a stored query stops parsing to structured IR
because of this, that is a parser gap to fix, not a reason to keep the regex.
`query()`'s docblock says what it now is: the raw-EDN entry that compiles
through the IR and revives every position (legacy behaviour), versus `runIr`
that revives only `node-ref` positions.

## Should-fix

1. **The "generated corpus" test is four constants.** `ir.test.ts` wraps
   `fc.constantFrom(...4 strings)` in `fc.assert`. Build a real generator over
   `Clause`/`FindPos` shapes (pattern clauses over `:node/*` and `:f/*` against
   the fixture graph, joins, optional `children`, one `reach`), round-trip
   `compile(parseEdn(compile(ir)))` and compare rows against `query(edn)` on
   the fixture. Keep the nine stored-query fixtures as exact cases.
2. **Rule-clause typing.** `collectNodeRefVars` in `ir/parse.ts` never looks
   at `kind: "rule"` clauses, so a `:find` var bound only by a rule call
   (`(has-tag ?n ?tag)`) is `scalar` and `runIr` returns the raw eid. Treat
   rule-call args conservatively as `node-ref` unless bound elsewhere as a
   scalar, and add the `has-tag`/`subtag` red case through `runIr`.
3. **`runIr` input normalisation.** `query()` maps `inputs` through
   `normalizeQueryInput`; `runIr` passes them raw, so a rules vector supplied
   as the `%` input bypasses `normalizeEdnQuery` — the exact bug commit 1 of
   p1c fixed for `query()`. Normalise in one place both entries share.

## Acceptance

`bun run verify`, `bun test packages`, `bun run test:ui` green.
`grep -n "rewriteChildOrderCartesian\|dropUnusedFindVars" tools/kb` empty.
`grep -n "child-order" tools/kb/packages/domain/query/src` hits only
`ir/parse.ts` (the collapse) and `index/datoms.ts` (the emit, p1b's).
Report: the three red cases' outputs, the generator's shape, and what the
`run(ir)` wave still needs.
