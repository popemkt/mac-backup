# w4 — the log is the one producer; the server echoes; clients catch up by rev

Branch `feature/w4-tx-log`, based on `main` @ `c560019` (w1 + w2 merged).
Three commits:

| commit | subject |
|---|---|
| `122cb2d` | `feat(kb): KbTx and the KbTxLog port; MemoryTxLog` |
| `4200f80` | `refactor(kb): the hub consumes the log` |
| `6d41560` | `feat(kb): since(rev) over WS; the client catches up instead of refetching` |

`bun run verify`, `bun test packages` (378), `bun run test:ui` (631) green at
each commit. `grep -n "diffNodes\|broadcast\b\|applyNodes"
tools/kb/packages/app/server/src` is empty. `index-rebuilds.test.ts` green.

## The port

`@kb/model` gains `KbTx { rev, ops: StoreTx, at, origin? }`, beside the
`StoreTx` it wraps. `@kb/contracts` gains `KbTxLog`:

```ts
interface KbTxLog {
  readonly head: number;
  append(ops: StoreTx, at: string, origin?: string): KbTx;
  since(rev: number): KbTx[] | "snapshot-required";
  subscribe(fn: (tx: KbTx) => void): () => void;
}
```

`@kb/tx-log` (`packages/infrastructure/tx-log`, `scope:shared`) implements it
as `MemoryTxLog`: a ring of 1000 by default, capacity a constructor argument.

Two deviations from the brief, both deliberate:

- **`at` is a parameter, not a `Clock` read.** The port is synchronous, and
  time in this codebase has exactly one owner and it is an Effect service
  (`@kb/model`'s `currentIso`, guarded by the `determinism-seam` harness test).
  A synchronous port reading the wall clock would be a second owner. Both
  callers are already inside `Effect.gen`, so they `yield* currentIso` and pass
  it.
- **`since` answers `"snapshot-required"`, not `"too-old"`, and answers it for
  a rev *ahead* of head as well as one behind the window.** `rev` is a
  per-server counter, so a restarted server has `head = 0` while its clients
  hold rev 7. Under the brief's shape `since(7)` would have returned `[]` —
  the log telling a client holding a previous process's graph that it is up to
  date. One sentinel, because a caller does the same thing in both cases; the
  wire frame uses the same word.

**`KbTxLogService` is not there.** The coordinator approved putting the log on
`KbContext` (`readonly log: KbTxLog`, beside `store` and `index`, constructed
in `openKbEffect`) rather than memoising it per-context in a WeakMap. With
`ctx.log` in hand, a Context service for the same instance is a second accessor
for one thing — the parallel path Rule 1 forbids — and it would have widened
`persistEffect`'s requirement channel into `ActionHandlerEnv`,
`operations/src/actions.ts`, `ext-canvas` and `runWithKb` for no reader.
Consequently `runtime/src/layers.ts` has **no** `Layer.succeed` hunk; my only
edit there is `log: new MemoryTxLog()` inside the `KbContext` literal, which
should merge against w3 cleanly.

## The origin carrier

`TxOrigin`, a `Context.Reference<string | undefined>` in
`contracts/src/tx-log.ts` with `defaultValue: () => undefined`.
`http.ts` reads `x-kb-origin` and pipes
`Effect.provideService(TxOrigin, …)` around the one `invokeReceiptEffect`
call; `persistEffect` does `yield* TxOrigin`.

Why ambient: no action cares who invoked it, and there are seven
`persistEffect` call sites across three packages I do not own. A `Reference`
has a default, so nothing downstream gains a requirement and an origin-less
surface (CLI, watcher, MCP) simply gets `undefined`. It is a label on the
transaction, not a filter — nothing reads it to decide whom to send to.

## What the hub deleted

`broadcast` (a private full copy of the node set as clients last saw it),
`nodesToMap`, `diffNodes`, `rev`, and `applyNodes`. Per commit that was three
node-map materialisations and a `JSON.stringify` per node, to reconstruct the
transaction `persistEffect` had just discarded.

What replaces them: the hub subscribes to `ctx.log` at construction, and each
`KbTx` becomes one `tx` frame plus the usual subscription re-evaluation.
`snapshot.rev` and the `hello` frame read `log.head`. `dispose()` detaches it,
called from the server scope's finalizer.

- `diffNodes` did not simply die — it moved to `@kb/model` as `diffTx`, beside
  the applier it inverts, because the watcher genuinely needs it: a file event
  carries no transaction. `ingestExternalWrite` (exported from `server.ts`)
  reloads, diffs `storedNodes()` before against after, and appends. The empty
  diff is the double-fire guard: an action→`fs.watch` round trip costs no rev
  and no frame.
- `http.ts` no longer calls the hub at all on the write path. It is
  `persist → log → hub`; the pre-invoke `reloadEffect` stays.

## The echo, and its red case

Decision 3: every `tx` frame goes to every watcher, the origin included.

The red case is in `packages/app/server/tests/tx-echo.test.ts`
("two clients writing in turn never see a rev gap") and in
`ui/src/api/ws.test.ts` ("a self-write echo advances rev like any other frame").
Before, the hub skipped `clientId === origin`. The origin's `rev` therefore
stayed one behind after each of its own writes, so the *next* foreign tx
arrived as `cur + 2` — a gap — and cost a full `/api/graph` refetch. Two
clients taking turns meant a snapshot per edit.

Idempotence of the echo is proved rather than asserted: the confirming frame
is keyed by node id, so applying it to the origin's optimistic state converges
that state onto the server's node set (one entity, not two), and replaying the
same frame again changes nothing. `mergeRemoteUpserts` still lets a pending
text buffer win, so `live.ts` and `outline.store.ts` needed no change.

## `since` over the wire

Client `{ op: "since", rev }`; server replies with the `tx` frames after that
rev in order, or `{ op: "snapshot-required", head }`. The hub serves `since`
regardless of `watch-tx` — asking is the opt-in.

`ws.ts` now asks instead of giving up: a gap in the stream, or a `hello` whose
rev disagrees, sends `since(cur)`; only `snapshot-required` reaches `onGap` and
the `/api/graph` refetch. One request per gap (`catchUpFrom` tracks the rev
already asked about), cleared on reconnect and on every applied delta.

## Gaps filed

| node | one line |
|---|---|
| `01M1QZMR3CYFYPEXBMC2JTFAA5` | the tx log is process-local; there is no durable `.kb/tx.jsonl` |
| `01M1QZNBFSTCM9V7DZT1XWEY2N` | saved-query virtual nodes never appear in tx frames |
| `01M1QZNM17MTGGPE517NVZYJT0` | subscription re-evaluation is O(clients × subs × full query) per tx |

`docs/kb/rules.md` regenerated with `docs.materialize`.

## Files touched outside my stated ownership

All small, all named here as the brief asks:

- `contract/contracts/src/session.ts` — `readonly log: KbTxLog` on
  `KbContext`, plus the import. Approved by the coordinator before I wrote it
  (w3 owns this file); the hunk is purely additive and reorders nothing.
- `contract/contracts/src/index.ts` — barrel lines for `KbTxLog` / `TxOrigin`.
- `domain/model/src/index.ts` — barrel lines for `KbTx` / `diffTx`.
- `app/runtime/src/layers.ts` — the one `log:` line in the `KbContext` literal,
  plus the `@kb/tx-log` import and its `package.json` dependency. (Named in the
  brief, but my hunk is smaller than it anticipated: no Layer line.)
- `application/operations/src/session.ts` — the append line and its doc
  paragraph, plus the two imports. Nothing else in that file is touched, so
  w3's `persistEffect` stat-stamp replacement should merge around it.
- `domain/model/src/tx.ts` and its new test — mine per the brief, noted because
  `diffTx` landing in the domain was not in the brief's plan.

`contract/contracts/src/actions.ts` was edited and then reverted when
`KbTxLogService` went away; it is unchanged on the branch.

## Not done

Nothing from the brief is outstanding. `operations/src/actions.ts`,
`store-jsonl`, `contracts/src/{store,workspace}.ts` and the UI write path
(`actions/**`) were not touched.
