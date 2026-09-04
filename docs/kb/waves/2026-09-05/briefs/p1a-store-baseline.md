# p1a-store-baseline — measure, then batch the decode

Wave `p1a` of `docs/kb/waves/2026-09-05/plan.md` (p1 Phases 0 and 1).
Harness: codex. Branch from the wave base. Runs in parallel with `p1b`
(claude) which owns `packages/domain/query`, `operations`, `runtime`, `server`,
`cli`, `mcp` — do not touch those. You own:
`tools/kb/packages/infrastructure/store-jsonl/**`,
`tools/kb/packages/domain/model/src/**` (schema declarations only),
`.gitignore`, the §Performance paragraph of `tools/kb/DESIGN.md` and the
"conn" / "transacts deltas" wording in `tools/kb/DESIGN-UI.md`, and your report.

Read first: `docs/kb/waves/2026-09-03/briefs/p1-persistence.md` §0 (as amended
at its head), §1, Phase 0, Phase 1, §5; `tools/kb/DESIGN.md` §Persistence and
§Performance; `packages/infrastructure/store-jsonl/src/jsonl-store.ts` and
`tests/benchmark.test.ts`; `AGENTS.md` Rule 1 and the Effect section, then
`tools/kb/node_modules/effect/AGENTS.md` before writing any Effect.
Run `intent/gate.sh session codex` first.

## 1. Phase 0 — measure (commit 1: `test(kb): store benchmark as a table, not a gate`)

- `tests/benchmark.test.ts` asserts `< 1000 ms` and fails. Turn it into a
  benchmark that times, separately, at 50k synthetic nodes: read, decode,
  datom build (import the builder from `@kb/query` as it is on your base — do
  not change it), one query, one `kb set`-shaped commit (load + one upsert +
  persist), one interactive edit (reload + persist). Print a markdown table;
  assert nothing but "ran". Keep it out of `bun test packages` if it is slow:
  a `bench` script already exists (`bun run bench`); make it the only entry.
- Commit the table to `docs/kb/waves/2026-09-05/reports/p1-baseline.md` with
  the machine, Bun version, and node count. Phase 4 (a later wave) asserts
  against this.
- `DESIGN.md` §Performance: replace "streaming line parse" with what the code
  does (read whole file, split, decode) and the target p1 sets. `DESIGN.md` and
  `DESIGN-UI.md`: fix "conn" / "transacts deltas" — there is no conn today; say
  "rebuilds the DataScript db from nodes on every load" until p1b lands.
- `.gitignore`: add `.kb/nodes.jsonl.lock` and `.kb/cache/`. The harness has a
  `gitignore-covers-derived` check; make sure it stays green and, if it lists
  derived paths explicitly, that these two are the same statement not a second.

## 2. Phase 1 — batched decode (commit 2: `perf(kb): decode JSONL in one Effect.try`)

- `jsonl-store.ts` `decodeNodeLine`: per-line `Effect.gen` + `Effect.try` +
  `mapError` → one `Effect.try` around a loop of `Schema.decodeUnknownSync`,
  tracking the line index so the first bad line still fails the whole load with
  a line-numbered `DomainError`. Keep `onExcessProperty: "preserve"`.
  `store-roundtrip.property.test.ts` must still pass byte-identical.
- `@kb/model` `KbNodeSchema`: declare `order` as optional instead of relying on
  excess-property preservation (`exactOptionalPropertyTypes` is on);
  `Schema.Number` → `Schema.Finite` for `num` prop values (JSON cannot carry
  NaN; tsgo's `schemaNumber` lane). Both additive to the file format; the
  roundtrip property test proves it.
- Re-run the benchmark; add the after-column to `p1-baseline.md`. p1 measured
  170 → 84 ms decode at 50k; report what you get.

## Acceptance

- `bun run verify`, `bun test packages`, `bun run test:ui` green. `bun run
  bench` prints the table and exits 0.
- `git grep -n "streaming line parse" tools/kb` is empty; `git grep -n "conn"
  tools/kb/DESIGN*.md` shows no claim that a conn exists.
- Effect lane: `bun run harness:snapshot` shows no new ledger entries.

## Report

`docs/kb/waves/2026-09-05/reports/p1a-store-baseline.md`: the two tables,
the decode diff summary, anything in the store you would flag for p1b.
