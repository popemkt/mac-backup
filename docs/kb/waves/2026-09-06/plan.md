# Wave 2026-09-06 — one graph, two apps: the index on both sides, a tx log, shared operations

Owner (2026-09-05, night): "keep going until we have the good end state both
backend and front end. making it simplest to reason about … proceed with the
simplification abstraction we just discussed … use opus, cursor, codex in
2:1:2 work division."

The end state, stated once:

```
domain / contract / application         shared, isomorphic
  model · query (IR, KbIndex) · contracts (ports) · operations (the actions)
                 │                                   │
   app/server ───┘                                   └─── app/ui
   infra: JsonlStore (later SqliteStore)             infra: BrowserStore (memory now, IndexedDB later)
   KbTxLog producer; WS echoes every tx              DatascriptIndex replica fed by tx frames
                                                     invokes the same actions locally, pushes the invocation
```

Two apps with different infrastructure layers, one set of shared packages,
one log. The browser's full local graph is a replica of the log, not a second
database. Recon that grounds this plan: the three reports the coordinator
commissioned on 2026-09-05 (operations backend deps; UI data layer; server tx
path) — their findings are folded into the briefs, cited by file:line there.

Base: `main` @ `5e1c0ed` (wave 2026-09-05 closed).

## Decisions

| # | Decision |
|---|---|
| 1 | **Stored queries stay EDN.** p1 §2f's "migrate `sys.f.*` props to IR JSON" is reversed: EDN is the user-authored dialect (a text prop the owner edits), IR is the compile target. `compile(parseEdn(edn))` at query time is cheap. A second engine compiles the same IR. `run(ir)` on the port serves internal callers; `runDatalog(edn)` stays the raw MCP/CLI/WS surface. |
| 2 | **The tx log is process-local this wave.** `KbTx { rev, ops: StoreTx, at, origin? }`; `KbTxLog` port `{ head, append, since, subscribe }`; one `MemoryTxLog`. `rev` keeps its documented per-server meaning; a client whose rev the log cannot cover takes a snapshot. A durable `.kb/tx.jsonl` is a later wave, recorded as a gap. |
| 3 | **The server echoes every tx to every watcher, including its origin.** Clients reconcile by rev; an optimistic local apply is idempotent under the confirming frame. This is what makes local action invocation safe and deletes the origin-suppression special case. |
| 4 | **Operations becomes `scope:shared` by moving infrastructure out, not by splitting the package.** Filesystem concerns go behind three ports (`SavedQueries`, `Views`, `Assets`) with one backend adapter package; store freshness becomes `EffectStore.fingerprint`; extension discovery moves to `runtime`. No `graph-ops` sibling. |
| 5 | **The shared preset stops lying.** `RUNTIME_PRESET_BY_SCOPE.shared` gets a `tsconfig.iso.json` without Bun types, so `Buffer` and `process` in a shared package are compile errors, not a fence hole. |
| 6 | **The Promise `Store` facade retires.** `EffectStore` is the one store interface; `KbContext.store` goes; legacy Promise handlers wrap where they need to. |
| 7 | **Ownership by file, stated in each brief. Merge order fixed below. Coordinator reviews every branch against Rule 1 before merge.** |

## Waves

| id | brief | harness | depends on | scope |
|---|---|---|---|---|
| w1 | `briefs/w1-run-ir-one-store.md` | codex | — → merged `efa4a2c` | `run(ir)` on `KbIndex`, `.handle` deleted, `backlinksQuery` as IR, `extractMentions` exported, Promise `Store` retired |
| w2 | `briefs/w2-browser-index.md` | cursor | — → merged `c560019` | UI read path: `src/ds/**` deleted, `DatascriptIndex` replica, `generation` not `rev` as memo key, `:f/*` join audit |
| w3 | `briefs/w3-operations-shared.md` | claude (opus) | w1 merged → merged `5e954b0`; fix-up on main `cb82da0` | ports + `@kb/workspace-fs` adapter, `EffectStore.fingerprint`, loader → runtime, retag shared, iso tsconfig preset |
| w4 | `briefs/w4-tx-log.md` | claude (opus) | w1, w2 merged → merged `aa6ee7e` | `KbTx`/`KbTxLog`/`MemoryTxLog`, hub consumes the log, echo, `since(rev)` over WS, watcher ingest appends once |
| w5 | `briefs/w5-browser-session.md` | codex | w3, w4 merged → merged `db277e7` after fix-up `5e9a7ef`+`1438d0b` | `BrowserStore`, browser runtime layer, UI invokes actions locally and pushes the invocation, duplicate planners deleted |

Sequencing: w1 ∥ w2 first (disjoint trees). w3 starts when w1 is on `main`;
w4 when w1 and w2 are. w3 ∥ w4 overlap on one function
(`operations/src/session.ts` `persistEffect`): w3 replaces the stat stamp,
w4 adds the log append; the coordinator resolves that hunk. w5 last.

Standing rules: `intent/gate.sh session <harness>` first; kb CLI is
`bun tools/kb/packages/app/cli/src/main.ts …` (never the `kb` shim);
`.kb/nodes.jsonl` only through it; never hand-edit
`tools/kb/harness/lint-warn-baseline.json` (`bun run harness:snapshot`);
`bun run verify`, `bun test packages`, `bun run test:ui` green before every
commit; no push; report to `docs/kb/waves/2026-09-06/reports/<id>.md`, never
the repo root. Read `AGENTS.md` and `tools/kb/AGENTS.md` (Rule 1, Effect v4)
before code. A worker that needs a file it does not own stops and names it in
its report.

## Not this wave, recorded as gaps by the worker who meets them

- Durable tx log (`.kb/tx.jsonl` under the write lock; `rev` per store).
- Virtual saved-query nodes in tx frames (today snapshot has them, frames do
  not; a `since(rev)` resync misses a `/api/queries` change).
- Subscription re-evaluation is O(clients × subs × full query) per tx.
- IndexedDB persistence for `BrowserStore` and an offline mutation queue.
- `SqliteStore` / `SqliteIndex`.
- UI ownership refactor of the four hotspots beyond what w5 deletes.

## Close-out (2026-09-05, morning)

All five waves merged to `main`; every merge ran `bun run verify` in pre-commit
and the final head passes `bun test packages` (383), `bun run test:ui` (594 —
the deleted planner tests went with the planners) and `bun run harness` (64
pass, 1 skip carrying its GAP). Each branch was reviewed against Rule 1 and
its brief before merge:

| wave | verdict | acted on |
|---|---|---|
| w1 | merge-quality, no findings | — |
| w2 | merge-quality; `ARCHITECTURE.md` still described `ds/` as a layer; three `rev`-named `generation` locals | fixed by the worker before merge (`184403d`) |
| w3 | merge-quality; `AGENTS.md` named the tests tsconfig wrong; `SavedQueries.write/remove` had no caller | fixed on main `cb82da0` (port is list/read) |
| w4 | merge-quality, no findings; one latent ordering question noted below threshold | — |
| w5 | **not** merge-quality: null fingerprint forced a full index rebuild per local write; canvas hand-merged props and called `applyTx` directly; two gaps not filed; dead `restoreSnapshot`; stale `invertPlan` docs | `briefs/w5-fix-one-writer.md` → `5e9a7ef`, `1438d0b`, then merged |

Coordinator commits this wave, all in service of unblocking a worker without
letting it copy shared logic: `100e889` moved the invoke core and the
`coreActions` pairing from `@kb/runtime` to `@kb/operations` (closing the
"hand-paired core actions" gap); `fe4f753` made handler, registered action and
invoker generic in their requirement channel and typed the eight isomorphic
actions as `RegisteredAction<IsomorphicActionEnv>`; `7969d6c` filed the
wall-clock UI test gap after one load-induced failure.

Decisions made mid-wave, recorded here as the home:

- The tx log is a third field on `KbContext` (`log`), not a Context service
  and not a per-context side table.
- `since` answers one sentinel, `snapshot-required`, for both "too old" and
  "ahead of a restarted server".
- `TxOrigin` is a `Context.Reference` read once in `persistEffect`.
- The browser runs the eight isomorphic actions locally; the four
  port-backed and every extension action take the one ordered POST lane; no
  browser HTTP Layers for the workspace ports.
- `SavedQueries` is list/read until a writer exists.

What the end state now is: `domain`, `contract`, `application` are shared and
typecheck against a preset with no Bun; the server composes JSONL store +
DataScript index + memory tx log and echoes every tx; the browser composes a
`DatascriptIndex` replica and a memory `BrowserStore`, runs the same actions
through the same invoker, and reconciles by rev. Stored queries stay EDN.

Gaps left open, all as nodes: durable tx log; virtual saved-query nodes in
frames; O(clients × subs) re-evaluation; `BrowserStore` IndexedDB
persistence; durable invocation replay (offline queue); wall-clock UI test;
plus the earlier ledger. Not started: `SqliteStore`/`SqliteIndex`, UI hotspot
refactor beyond what w5 deleted, the `#check` governance model, kb as its own
repo.

Harness notes: codex asks blocking `ask` questions that the mailbox `check`
does not surface — poll `orchestration inbox` for `type=question`. Cursor needs
per-worktree trust and an Enter after Orca's paste. Workers finish before
reading late notes; fix-ups are new tasks. A worker that lacks a shared export
will copy it unless told the export is coming — say so in the reply and land
it as a coordinator commit.
