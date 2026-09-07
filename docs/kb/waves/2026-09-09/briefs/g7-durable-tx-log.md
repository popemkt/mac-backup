# g7-durable-tx-log — the transaction log survives the process, and the virtual set is a logged transaction

Wave `g7` (batch 2) of `docs/kb/waves/2026-09-09/plan.md`. Harness: claude.
Branch `kb-g7-tx-log` from **`kb-merge-origin`** (batch 1 merged). Run
`intent/gate.sh session claude` first. Read each gap node
(`bun tools/kb/packages/app/cli/src/main.ts get <id>`), then
`packages/contract/contracts/src/{store,tx-log}.ts` (or wherever `KbTxLog`
and `EffectStore` live — `grep -rn "interface KbTxLog"`), the two adapters
(`infrastructure/store-jsonl`, `infrastructure/store-sqlite`),
`application/operations/src/session.ts` (persist / reload, which g6 just
reworked around `StoreCommit`), `app/server/src/session.ts` (`publish`, which
g6 keyed by query), the memory log implementation, and
`docs/kb/waves/2026-09-07/reports/s1.md` (the sqlite store wave: `storeContract`
in `@kb/test-kit`, the `.kb/kb.sqlite` selection rule, `kb store migrate`).
`tools/kb/DESIGN.md` → persistence sections are the canonical prose; you will
extend them.

You own: `packages/contract/contracts/src/**` (log contract), both store
adapters, the memory log, `application/operations/src/session.ts`,
`app/server/src/**` where it reads the log, `app/runtime` store selection if
the log is selected with the store, `@kb/test-kit`'s `storeContract` (and a
`logContract` beside it), `kb store migrate` if the log migrates with the
store, DESIGN.md persistence prose, your report. **Not yours**: `ui/**`,
`.oxlintrc.json`, `constraints.ts`, the baseline.

## Gaps

1. `01M1QZMR3CYFYPEXBMC2JTFAA5` — the tx log is process-local; no durable
   `.kb/tx.jsonl`. `closes`: write each append to `.kb/tx.jsonl` inside the
   JSONL store's write lock; load the tail at `openKbEffect` and seed the
   memory log's window and `rev` from it; make `rev` per-store.
2. `01M1RYY9HVDNB1RNNKCSYF2H47` — the tx log is `MemoryTxLog` on both stores;
   a sqlite root could have a durable one as a table. `closes`: a schema for
   the log table, a decision on whether `KbTxLog` gains a durability contract
   or a second adapter, and what the JSONL store does about it.
3. `01M1QZNBFSTCM9V7DZT1XWEY2N` — saved-query virtual nodes never appear in
   tx frames. `closes`: make the virtual set a logged transaction (watch
   `.kb/queries/` alongside the store, diff `savedQueryNodes()` across the
   change, append it) — or drop `withVirtual`. Decide, and say which.

## Shape (Rule 1 first)

Gaps 1 and 2 are **one** gap seen from two stores. Do not solve them twice.

- **One contract.** `KbTxLog` gains durability: `append` persists before it
  returns, `since(rev)` reads from the durable tail when the window is cold,
  `head` is per-store and survives reopen. The memory log becomes the
  *window* over a durable tail, not a separate kind of log. If that makes
  `MemoryTxLog` a misnomer, rename it.
- **One durable tail per store, owned by the store.** The JSONL store's tail
  is `.kb/tx.jsonl`, appended inside the same write lock as `nodes.jsonl`
  (so a crash between the two cannot leave a node write without its log
  entry, or an entry without its write — say which order you chose and why).
  The sqlite store's tail is a `tx` table written in the same transaction as
  the node rows. The store therefore *is* the log's persistence; `EffectStore`
  grows whatever the log needs (`appendTx` / `txSince` / `txHead`, or the
  store returns the log as a capability — your call, one mechanism), and the
  log adapter is one class parameterised by the store, not two log classes.
- **One contract test.** `logContract(name, makeStore)` in `@kb/test-kit`
  beside `storeContract`, run by both adapters: append/reopen/since round
  trip, `rev` monotonic across reopen, `since` beyond head ⇒
  `snapshot-required`, an append that fails leaves head unchanged, and the
  crash-order property (kill between node write and log write, whichever
  order you chose, and show reopen is consistent).
- **`kb store migrate --to`** carries the log tail across (s1 made the node
  migration byte-identical; do the same for the tail, or state why the tail
  is not migrated and truncate it explicitly with a logged reason).
- **Gap 3**: if `withVirtual` stays, the virtual set change is an ordinary
  `StoreTx` appended to the same log with an `origin: "virtual"` (or the
  existing origin field), so the WS hub sees it through the one path. If you
  drop `withVirtual`, delete it and everything that only existed for it, and
  say what the saved-query sidebar does instead. Either way, one path.

`DESIGN.md`: one subsection under persistence — the contract, the two tails,
the crash-order choice, the migration rule. Update the `#gap` nodes'
`current`/`closes` if anything stays open (unset before set).

## Commits

1. `refactor(kb): KbTxLog is a window over a store-owned durable tail`
   (contract + memory-window rewrite + `logContract`; both adapters return
   an empty tail; all existing tests green).
2. `feat(kb): JSONL store persists its tx tail in .kb/tx.jsonl`
3. `feat(kb): sqlite store persists its tx tail in a tx table`
4. `feat(kb): kb store migrate carries the tx tail` (or the explicit
   truncation).
5. `refactor(kb): saved-query virtual nodes are a logged transaction` (or
   `refactor(kb): drop withVirtual`).
6. `chore(kb): close tx-log gaps` — statuses, docs.

Gates before each: `bun run verify`, `bun test packages`, `bun run test:ui`.
Background commits. Both committed stores (`.kb`, `tools/kb/.kb`) must load
and round-trip byte-identically; a new `.kb/tx.jsonl` is **gitignored**
(check `gitignore-covers-derived` in the harness and `docs/backup-strategy.md`
— the tail is state, not intent, so it is a backup concern; add the line
there).

## Ownership answers

Contracts, adapters, operations, server, test-kit, runtime selection,
`.gitignore`, `docs/backup-strategy.md`: yes. `ui/**`: no — if the UI must
change for gap 3, report it and leave that half open. Anything else: smallest
call, record, continue.

## Report

`docs/kb/waves/2026-09-09/reports/g7.md`: the contract as landed; the
crash-order decision and its test; the migration rule; what happened to
`withVirtual`; `logContract` case list; both stores' round-trip proof; test
output; "Calls I made"; gaps left open with their new `closes`.
