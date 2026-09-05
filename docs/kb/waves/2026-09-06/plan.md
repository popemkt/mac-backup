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
| w1 | `briefs/w1-run-ir-one-store.md` | codex | — | `run(ir)` on `KbIndex`, `.handle` deleted, `backlinksQuery` as IR, `extractMentions` exported, Promise `Store` retired |
| w2 | `briefs/w2-browser-index.md` | cursor | — | UI read path: `src/ds/**` deleted, `DatascriptIndex` replica, `generation` not `rev` as memo key, `:f/*` join audit |
| w3 | `briefs/w3-operations-shared.md` | claude (opus) | w1 merged | ports + `@kb/workspace-fs` adapter, `EffectStore.fingerprint`, loader → runtime, retag shared, iso tsconfig preset |
| w4 | `briefs/w4-tx-log.md` | claude (opus) | w1, w2 merged | `KbTx`/`KbTxLog`/`MemoryTxLog`, hub consumes the log, echo, `since(rev)` over WS, watcher ingest appends once |
| w5 | `briefs/w5-browser-session.md` | codex | w3, w4 merged | `BrowserStore`, browser runtime layer, UI invokes actions locally and pushes the invocation, duplicate planners deleted |

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
