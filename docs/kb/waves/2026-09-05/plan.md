# Wave 2026-09-05 — p1: the index port and the query IR (Track 2, part 1)

Owner (2026-09-04, late): "go dispatch cursor or opus or codex (share work
between them) for next wave … write plan for next wave, and I'll say when we'll
start." Start is gated on the owner's go.

Design record: `docs/kb/waves/2026-09-03/briefs/p1-persistence.md` (D3/D4), as
amended by `reports/backend-recon/README.md` §9 (r4, accepted here). This plan
maps its phases onto the tree as it stands after t3 and splits them across
three harnesses with disjoint file ownership.

Base: `main` after the t3 merge (`144baf0` or later).

## Decisions

| # | Decision |
|---|---|
| 1 | **r4 §9 accepted.** Revisit trigger is query latency (closure 1 570 ms at 1 M in DataScript vs 5.4 ms in SQLite), not memory. DuckDB and LadybugDB re-rejected on fit with dated facts; TerminusDB is a daemon, not dead. Phase 3 becomes `SqliteIndex`, a second `KbIndex` implementation, in a later wave. |
| 2 | **This wave ships Phases 0, 1, 2a–2f of p1.** Not this wave: the stored-EDN migration to IR (2f second half), `KbIndex.run(ir)` wiring, 2e's `datoms.ts` dedupe, 2g's u1 brief, Phase 3 `SqliteIndex`, Phase 4 gates. Each is one wave later, on top of the port. |
| 3 | **Reads stay synchronous** on the port (p1 §2a). A `#gap` records the async-index cost. |
| 4 | **Ownership is by file, stated once in the table below.** A worker that needs a file it does not own stops and says so in its report; it does not edit it. |
| 5 | **The two r4 defects are p1c's**: recursive `rules` never normalised (MCP throws), and the `:node/child-order` join cartesian. Both live in the query-execution half of `datascript.ts`. |

## Waves

| id | brief | harness | depends on | owns |
|---|---|---|---|---|
| p1a | `briefs/p1a-store-baseline.md` | codex | — | `packages/infrastructure/store-jsonl/**`, `packages/domain/model/src/**` (schema only), `.gitignore`, DESIGN.md §Performance and the "conn" wording in DESIGN-UI.md, `reports/p1-baseline.md` |
| p1b | `briefs/p1b-kbindex-port.md` | claude (opus, high) | — (its commit 1 unblocks p1c) | new `packages/domain/query/src/index/**`; the **builder half** of `packages/domain/query/src/datascript.ts` (moved out in commit 1); `packages/contract/contracts/src/session.ts`; `packages/application/operations/**`; `packages/app/runtime/**`; `packages/app/server/src/{session,http}.ts`; `packages/app/cli/**`; `packages/app/mcp/**`; `packages/app/test-kit/**` and the tests that build a `QueryDb` |
| p1c | `briefs/p1c-query-ir.md` | cursor (grok 4.6 high) | p1b commit 1 merged to the integration branch | new `packages/domain/query/src/ir/**`; the **query-execution half** of `datascript.ts` (`normalizeEdnQuery`, `query`, `queryRows`, `pull`, revival, rules); `packages/app/ui/src/ds/query.ts` + its test |

Sequencing: p1a and p1b start together. p1b's first commit is a
behaviour-preserving split of `datascript.ts` into builder (`index/datoms.ts`)
and execution (`datascript.ts`); the coordinator merges that commit to the
integration branch `kb-wave/2026-09-05` and starts p1c from it. Everything
else merges as it lands; p1b last.

Standing rules: `intent/gate.sh session <harness>` first; the kb CLI is
`bun tools/kb/packages/app/cli/src/main.ts …` (never the `kb` shim on PATH);
`.kb/nodes.jsonl` only through it; never hand-edit
`tools/kb/harness/lint-warn-baseline.json` (`bun run harness:snapshot`);
`bun run verify`, `bun test packages`, `bun run test:ui` green before every
commit; no push; report to `reports/<id>.md`; write the report under this
wave's `reports/`, never at the repo root.

## Not this wave, recorded

- Stored-form migration to IR (five `sys.f.*` props, `.kb/queries/todos.edn`)
  and `KbIndex.run(ir)`: wave p1-next, after p1b and p1c are both on `main`.
- `SqliteIndex` (r4 §9.3): after the port exists.
- Phase 4 benchmarks as gates: after p1a's baseline and p1b's port.
- The FOD fragility from t3 (`pkgs/kb` hashes move with the ambient `bun`): a
  `#gap` for the owner to decide, not a wave.
