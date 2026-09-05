# w5-fix-one-writer — one writer, no rebuild per keystroke

Fix-up for `w5` after the coordinator's review of `feature/w5-browser-session`
(`9e48cc7`, `bae2f61`, `605a7f1`). Harness: codex, same worktree and branch.
You own `tools/kb/packages/app/ui/**`, `tools/kb/DESIGN-UI.md` §undo/redo and
the UI `README.md`, `.kb/nodes.jsonl` via the CLI, and the w5 report.

1. **Fingerprint.** `BrowserStore.fingerprint` is `Effect.succeed(null)`, so
   the shared `reloadEffect` can never skip and every local write does a full
   `DatascriptIndex.rebuild`. Give the store a monotonic generation as its
   fingerprint (bump on `commitEffect` and on WS ingest); `reloadEffect` then
   short-circuits. Test: fifty local `node.update`s on the fixture graph leave
   `index.rebuilds` at its construction value (mirror
   `server/tests/index-rebuilds.test.ts`).
2. **Canvas is not a second writer.** `lib/canvas-api.ts` `persistCanvasDoc`
   hand-merges `setProps`/`unsetProps` into `WireNode`s and calls
   `store.applyTx` directly after the remote `ext.canvas.tx.apply` receipt.
   Route the local effect through the runtime: either express the canvas
   write as `node.update {setProps, unsetProps}` invoked locally (the shared
   handler owns prop-mutation order) with `ext.canvas.tx.apply` staying the
   remote lane, or, if `ext.canvas.tx.apply`'s semantics differ from
   `node.update` in a way you can name, apply the server's echoed tx frame
   only and delete the hand merge. No `applyTx` call from the write path
   outside `session/runtime.ts` and the WS ingest.
3. **Gaps as nodes.** File `#gap` nodes via the CLI (`expected`, `current`,
   `impact`, `closes`) for: `BrowserStore` is memory-only (IndexedDB); the
   invocation lane is memory-only (offline queue with replay/conflict policy).
   Materialize docs.
4. **Dead seam.** `outline.store.ts` `restoreSnapshot` has no caller. Delete it
   and its interface line.
5. **Docs.** `DESIGN-UI.md` and `packages/app/ui/README.md` still describe
   `invertPlan`/"plan → local tx → POST". Describe the runtime push lane and
   `restoreInvocations`.
6. Commit messages carry the scope: `fix(kb-ui): …`, `docs(kb-ui): …`.
   Report: append a "Fix-up" section with the rebuild-count test output and
   the actual `bun run verify` / `bun test packages` / `bun run test:ui`
   numbers.
