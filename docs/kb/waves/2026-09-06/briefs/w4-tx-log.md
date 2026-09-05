# w4-tx-log — the log is the one producer; the server echoes; clients catch up by rev

Wave `w4` of `docs/kb/waves/2026-09-06/plan.md`. Harness: claude (opus, high).
Branch from `main` **after w1 and w2 are merged**. Runs beside `w3`
(operations shared). You own: `tools/kb/packages/domain/model/src/tx.ts`,
`tools/kb/packages/contract/contracts/src/{protocol,tx-log}.ts`, a **new**
`tools/kb/packages/infrastructure/tx-log/**` (`scope:shared`),
`tools/kb/packages/app/server/**`, the log-append lines in
`operations/src/session.ts` `persistEffect` (w3 owns the rest of that file;
touch only what appends to the log), `tools/kb/packages/app/runtime/src/layers.ts`
(provide the log Layer; w3 also edits this file — keep your hunk to the Layer
line), `tools/kb/packages/app/ui/src/api/{ws,live,graph}.ts` and their tests,
`tools/kb/packages/app/ui/src/stores/outline.store.ts` only where it applies a
tx / handles a gap, and your report.

Read first: `server/src/session.ts` (`SubscriptionHub`: `broadcast`,
`diffNodes`, `rev`, `applyNodes`, the `clientId !== origin` skip at ~:220),
`server/src/server.ts` (`watchNodesFile`, `makeReloadDebounce`),
`server/src/http.ts` (:93 reload, :99 `applyNodes(…, origin)`),
`operations/src/session.ts` (`persistEffect`), `contracts/src/protocol.ts`
(`rev` doc :37-39, `ServerMessageSchema`), `model/src/tx.ts` (`StoreTx`),
`ui/src/api/ws.ts` (:218-240 hello/tx/gap), `ui/src/api/live.ts`,
`packages/app/server/tests/index-rebuilds.test.ts` (a gate you must keep
green); `AGENTS.md` Rule 1; `tools/kb/AGENTS.md` incl. Effect. Run
`intent/gate.sh session claude-code` first.

## Why

`persistEffect` holds the real `StoreTx` and discards it; the hub then
re-derives an equivalent tx by diffing a private full copy of the last
broadcast node set against `storedNodes()` — three node-map materialisations
and a `JSON.stringify` per node per commit. External writes arrive as a file
event → full parse → full rebuild → diff. The origin client never sees its own
tx, so its rev falls behind after every self-write and the next foreign tx
forces a full snapshot refetch. One authored log deletes all of it.

## Commit 1 — `feat(kb): KbTx and the KbTxLog port; MemoryTxLog`

- `model/src/tx.ts`: `KbTx { rev: number; ops: StoreTx; at: string; origin?: string }`.
- `contracts/src/tx-log.ts`: `KbTxLog { head: number; append(ops, origin?): KbTx; since(rev): KbTx[] | "too-old"; subscribe(fn): () => void }`
  and `KbTxLogService extends Context.Service`. Synchronous, like `KbIndex`.
- `infrastructure/tx-log/src/memory-tx-log.ts`: ring buffer (capacity a
  constructor arg, default 1000). `since(rev)` returns `"too-old"` when the
  window does not cover `rev+1`. `at` from `Clock` at append. Property test:
  `since(head)` is empty; `since(k)` concatenated with the appends since
  equals the log; `too-old` exactly at the ring boundary.

## Commit 2 — `refactor(kb): the hub consumes the log`

- `persistEffect`: after `commitEffect` + `index.applyTx`, `log.append(tx, origin)`.
  (`origin` threads from `x-kb-origin` through the action invocation — find
  the least invasive carrier; a `FiberRef` or an explicit parameter; say
  which.)
- Watcher ingest (`server.ts`): on a file event, `reloadEffect` then **diff
  once** (`storedNodes` before vs after) and `log.append(diff)`. Idempotency:
  the action→watch double-fire diffs to nothing; do not append empty txs.
- `SubscriptionHub`: delete `broadcast`, `nodesToMap`, `diffNodes`, `rev`,
  `applyNodes`. Subscribe to the log at construction; on each `KbTx` send the
  `tx` frame (`rev = tx.rev`) **to every watcher including the origin**
  (Decision 3), then re-evaluate subscriptions as today. `snapshot.rev = log.head`.
- `http.ts`: no more `hub.applyNodes`; the action path is `persist → log →
  hub`. Keep the pre-invoke `reloadEffect` (it is cheap after w3's
  fingerprint).
- `index-rebuilds.test.ts` stays green; add: two clients, one writes, both
  receive the same rev; the origin's local optimistic state is unchanged by
  the echo (idempotent apply).

## Commit 3 — `feat(kb): since(rev) over WS; the client catches up instead of refetching`

- `protocol.ts`: client `{ op: "since", rev }`; server replies with a batch of
  `tx` frames or `{ op: "snapshot-required", head }`. `rev` doc unchanged
  (per-server counter; a rev the log cannot cover ⇒ snapshot).
- `ui/src/api/ws.ts`: on `hello` mismatch or a `tx` gap, send `since(cur)`;
  apply the batch in order; on `snapshot-required` fall back to today's
  `/api/graph` refetch. Remove the rev-behind-after-self-write failure mode:
  the origin now receives its own tx and advances `rev` like everyone else.
- `ui/src/api/live.ts` / `outline.store.ts`: applying a `tx` frame whose
  content equals the local optimistic state is a no-op on the index
  (`applyTx` diffs per entity); `mergeRemoteUpserts` (pending text buffer
  wins) stays.
- Tests: `live.test.ts` gap path uses `since`; a self-write then a foreign
  write no longer triggers a snapshot.

## Gaps to file (via the CLI), not to build

Durable log (`.kb/tx.jsonl` under the write lock; per-store rev); virtual
saved-query nodes absent from frames; O(clients × subs) re-evaluation.

## Do not

- Touch `operations/src/session.ts` beyond the append. Not `store-jsonl`,
  not `contracts/src/{store,session,workspace}.ts` (w3).
- Change the UI write path (`actions/**`) — w5.

## Acceptance

`bun run verify`, `bun test packages`, `bun run test:ui` green.
`grep -n "diffNodes\|broadcast\b\|applyNodes" tools/kb/packages/app/server/src` empty.
`index-rebuilds.test.ts` green. Report:
`docs/kb/waves/2026-09-06/reports/w4-tx-log.md` — the port, the origin
carrier, what the hub deleted, the echo red case, the three gap ids.
