# w5-browser-session — the UI runs the same actions against its own store

Wave `w5` of `docs/kb/waves/2026-09-06/plan.md`. Harness: codex. Branch from
`main` **after w3 and w4 are merged**. You own `tools/kb/packages/app/ui/**`
and your report. If a shared package lacks something you need (an export, a
Layer), stop and name it in a heartbeat; do not edit outside the UI.

Read first: `docs/kb/waves/2026-09-06/reports/{w2-browser-index,w3-operations-shared,w4-tx-log}.md`;
`packages/app/runtime/src/layers.ts` (the server composition root you mirror);
`packages/application/operations/src/{session,actions}.ts` (now shared);
`packages/app/runtime/src/registry.ts` (`invokeEffect`, `CORE_ACTIONS` —
runtime is `scope:backend`; you may not import it: build the browser's
registry from `@kb/operations` definitions directly and say so);
`ui/src/actions/{plan,mutations,optimistic}.ts`, `ui/src/lib/canvas-api.ts`;
`AGENTS.md` Rule 1; `tools/kb/AGENTS.md` incl. Effect. Run
`intent/gate.sh session codex` first.

## Why

`actions/plan.ts` (1334 lines) and `mutations.ts` (831) re-implement
`nodeAddEffect`/`nodeUpdateEffect`: cascade delete, detach, insert-at,
prop append/remove by JSON equality, tag → `sys.f.type` ref, the `sys.*`
guard. Every planner collapses to four action ids (`node.update` ×21,
`node.add` ×11, `field.define`, `tag.define`). With operations shared and the
server echoing every tx, the browser can run the action locally against its
own store and push the *invocation*; the echo confirms or corrects.

## Commit 1 — `feat(kb-ui): BrowserStore and the browser runtime layer`

- `src/session/browser-store.ts`: `EffectStore` over memory
  (`{ path: "browser", loadEffect, commitEffect, fingerprint }`); `commitEffect`
  updates the in-memory node map only. IndexedDB is a later wave (gap).
- `src/session/runtime.ts`: the browser composition root mirroring
  `layers.ts`: `KbStore` (BrowserStore), `KbCtx` (`{ root: "browser", store,
  index }` with the `DatascriptIndex` w2 installed), `KbIndexService`, a static
  `TemplateRegistry`, **no** `FileSystem`, `SavedQueries`/`Views`/`Assets`
  Layers that call the server's HTTP endpoints. `invoke(id, input)` parses
  input with the action's schema, runs the effect locally, and returns the
  receipt — the same shape the server returns.
- Push: every local `invoke` of an `apply`-mode action also enqueues
  `POST /api/action` with the same `{id, input}` and the client's origin id.
  In-order per client; on a failed receipt from the server, `since(rev)`
  reconciles (w4) and the failure surfaces as today's toast.

## Commit 2 — `refactor(kb-ui): planners that duplicate operations are deleted`

Delete from `plan.ts`: `planDelete`, `planIndent`, `planOutdent`, `planMove`,
`planSetProp`, `planUnsetProp`, `planAddTag`, `planRemoveTag`,
`planDefineField`, `planDefineTag`, and every planner that only wraps
`planSetProp`/`planSetLensProp` — they become **input builders** for
`node.update`/`node.add`, not tree rewriters. `mutations.ts` verbs call
`runtime.invoke`. `optimistic.ts`'s recovery ladder shrinks to: server
receipt failed ⇒ `since(rev)`; keep the text debounce and per-node FIFO in
`mutations.ts`; keep undo/redo, now as inverse *invocations*.

Keep, as UI-only: `planSplit`/`planMergeInto`'s focus/cursor half
(`focusId`, `focusCursor`, `revealIds`), the `expandedIds`-driven
`asFirstChild` decision (pass it down as `{parent, position}`; never push view
state into operations), transient-node minting, pin toggling, forest-root
ordering, toasts. `canvas-api.ts` keeps posting `ext.canvas.tx.apply` (a
backend extension) unless w3 made it shared — check its report.

## Commit 3 — `test(kb-ui): the write-path tests assert invocations`

The nine tests under `actions/*.test.ts` (~1800 lines) mock `postAction` and
assert payloads. Re-target them at `runtime.invoke`: same action ids, same
inputs, plus the new assertions that the local index changed before the POST
and that an echoed `tx` frame equal to the local state is a no-op.

## Acceptance

`bun run verify`, `bun run test:ui` green; `wc -l src/actions/plan.ts` under
400; `grep -c "postAction(" src/actions` equals the one push site; a
keystroke edits the local index before any network call (test). Report:
`docs/kb/waves/2026-09-06/reports/w5-browser-session.md` — what was deleted,
what stayed UI-only and why, the reconciliation red case, and the gaps
(IndexedDB, offline queue).
