# p1b-kbindex-port — one index behind one port, and the owners that use it

Wave `p1b` of `docs/kb/waves/2026-09-05/plan.md` (p1 Phase 2a–2d). Harness:
claude (opus, high effort). Branch from the wave base. Runs in parallel with
`p1a` (codex: store-jsonl, model schema, DESIGN §Performance) and, after your
commit 1 is merged, `p1c` (cursor: query IR and the execution half of
`datascript.ts`). Ownership is in the plan's table; the split with p1c is the
point of your first commit.

Read first: `docs/kb/waves/2026-09-03/briefs/p1-persistence.md` §0 (amended),
§1, §2, Phase 2a–2d, §5, §6; `reports/backend-recon/README.md` §7 and §9;
`docs/kb/waves/2026-09-03/reports/recon-kb.md` B.2 and B.9;
`packages/domain/query/src/datascript.ts`; every consumer of `@kb/query`:
`packages/contract/contracts/src/session.ts` (`qdb: QueryDb` on the session
context), `packages/application/operations/src/{session,ontology,actions,map}.ts`,
`packages/application/operations/src/docs/docs.ts`,
`packages/app/runtime/src/layers.ts`, `packages/app/server/src/{session,http}.ts`
(`http.ts:93` reloads before every action). `AGENTS.md` Rule 1 and the Effect
section; `tools/kb/node_modules/effect/AGENTS.md` completely.
Run `intent/gate.sh session claude-code` first.

## Commit 1 — split `datascript.ts` (behaviour-preserving; unblocks p1c)

Move the **builder half** out of `packages/domain/query/src/datascript.ts` into
`packages/domain/query/src/index/datoms.ts`: `IdMap`/`buildIdMap`,
`nodesToDatoms` and the schema derivation, `buildQueryDb`, the `QueryDb` type.
Leave in `datascript.ts` the **execution half**: `normalizeEdnQuery`, `query`,
`queryRows`, `pull`, `reviveValue`/`revivePull`, `DatalogError`, the rules
handling. `src/index.ts` re-exports both so no consumer changes in this commit.
Tests move with their code. `bun run verify` and `bun test packages` green.
Tell the coordinator this commit's hash in your first heartbeat; p1c starts
from it.

## Commit 2 — the port and its DataScript implementation (2a, 2b)

`packages/domain/query/src/index/index.ts`:

```ts
export interface KbIndex {
  readonly generation: number;
  rebuild(nodes: ReadonlyArray<KbNode>): void;
  applyTx(tx: StoreTx): void;
  runDatalog(edn: string, ...inputs: ReadonlyArray<unknown>): Array<Array<unknown>>;
  pull(pattern: string, id: NodeId): unknown;
  getNode(id: NodeId): KbNode | undefined;
  allNodes(): Iterable<KbNode>;
  search(text: string, limit?: number): Array<KbNode>;
  withVirtual(nodes: ReadonlyArray<KbNode>): void;
}
export class KbIndexService extends Context.Service<KbIndexService, KbIndex>()("kb/KbIndex") {}
```

`index/datascript-index.ts` — `DatascriptIndex implements KbIndex`:

- Stable eids: allocate monotonically per new `NodeId`, never reuse; the map is
  owned by the index. `reviveValue`/`revivePull` (p1c's half) only need eid →
  NodeId, so expose exactly that lookup.
- `applyTx`: delete → `[:db/retractEntity eid]`; upsert → retract the entity's
  old datoms, add the node's new ones (`nodesToDatoms` becomes per-node
  `nodeToDatoms(node, ids)` returning the schema contribution). Apply with
  `d.db_with`. First appearance of a ref-typed attribute → fall back to
  `rebuild` for that tx and count it (schema is data-derived, recon-kb B.2).
- `search` owns the substring scan now in `operations` (find it; it is the
  `graph.search` implementation). `getNode`/`allNodes` own the node map.
- `withVirtual`: saved-query nodes exist in the index and not the store
  (`operations/src/saved-query.ts`); model that here once and delete the ad-hoc
  merge at the rebuild site.
- Reads are synchronous (p1 §2a). File the `#gap` for the async cost with the
  kb CLI (`… add "GAP: …" --tag gap --create --prop expected=… --prop
  current=… --prop impact=… --prop closes=…`).

## Commit 3 — re-home the owners (2c)

- `contracts/src/session.ts`: the session context carries `index: KbIndex`
  instead of `qdb: QueryDb` (and no separate `nodes` map if the index owns it).
- `operations/src/session.ts` open/reload/persist call `index.rebuild` /
  `index.applyTx`; the diff `applyNodes` already computes feeds `applyTx`;
  `generation` replaces any hand-kept `rev`. `runtime/src/layers.ts` provides
  `KbIndexService`. Any `kb init` path that bypasses the normal persist goes
  through it. Delete `buildQueryDb`, `QueryDb`, and every direct `d.*` call
  outside `packages/domain/query`.
- `KbStore`'s `FileSystem` requirement moves inside its Layer
  (`leakingRequirements`); `loadEffect()` → `load: Effect<…>` (`lazyEffect`).
- Tests that built a `QueryDb` directly migrate to `DatascriptIndex`. No shim.

## Commit 4 — the HTTP path (2d)

`server/src/http.ts` reloads before every action. With the watcher already
feeding `applyNodes`, that is a second mechanism for one concern. Replace it
with a cheap staleness check (file size + mtime) and reload only on change.
One interactive edit performs zero full rebuilds; assert it with a counter in
a test.

## Do not

- Touch `normalizeEdnQuery`, `query`, `queryRows`, `pull`, revival, or rules —
  p1c owns them. If the port needs something from that half, call it as it
  is and name the need in your report.
- Touch `packages/app/ui/**`, `store-jsonl`, `model`, or `.gitignore`.
- Introduce the IR or `run(ir)`; that is p1c and the next wave.

## Acceptance

`grep -rn "buildQueryDb\|QueryDb\b\|init_db"` finds only `datascript-index.ts`
(one `init_db`) and the UI (`packages/app/ui/src/ds/**`, out of scope).
`bun run verify`, `bun test packages`, `bun run test:ui` green. Effect lane
unchanged or lower. Red cases in the report: an `applyTx` with a first-seen
ref attribute (rebuild counted once); an interactive edit (zero rebuilds).

## Report

`docs/kb/waves/2026-09-05/reports/p1b-kbindex-port.md`: every deleted
symbol, the eid allocation rule, rebuild counts from the benchmark, what the
next wave needs to wire `run(ir)`.
