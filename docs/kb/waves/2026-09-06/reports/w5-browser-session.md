# w5 — browser session runs shared actions

Branch `feature/w5-browser-session`, based on `main` @ `fe4f753` after the
coordinator-requested `100e889` and `fe4f753` merges.

## Commits

| commit | subject |
|---|---|
| `9e48cc7` | `feat: run browser writes through shared actions` |
| `bae2f61` | `refactor: keep browser action planner focused` |

## Browser composition root

`src/session/runtime.ts` is the one browser action boundary. It constructs a
`KbContext` from the outline store's existing `DatascriptIndex`, an in-memory
`BrowserStore`, and `MemoryTxLog`, then provides exactly `KbCtx | KbStore |
KbIndexService` to `invokeReceiptWith`.

The local registry is derived from `isomorphicActions`, so these eight actions
run through their shared Effect handlers in the browser: `node.get`,
`ontology.members`, `graph.query`, `graph.search`, `node.add`, `node.update`,
`field.define`, and `tag.define`. The registry and remote classification are
not copied into UI data: the local map derives from `isomorphicActions`, while
the remote set derives from `portActions`. Port-backed actions and unknown
extension actions use the ordered `POST /api/action` lane.

`BrowserStore` implements `EffectStore` over an in-memory node map. Hydration
and authoritative snapshot replacement install a fresh browser session; WS tx
frames advance both the browser store and the existing Datascript index. A
successful local Effect advances that same index before its invocation enters
the remote push lane, and the outline projection is refreshed from the index.

Canvas creation now uses the same `node.add` path. The backend-only
`ext.canvas.tx.apply` action also enters through `runtime.invoke`, is classified
as unknown, and stays remote.

## Deleted parallel write machinery

`actions/plan.ts` no longer clones and rewrites trees. It is 399 formatted
lines, down from the previous large planner, and emits ordered canonical action
invocations. In particular, replacement is expressed as `node.update` unset
followed by `node.update` set because the shared action owns property mutation
order.

The old planner-owned cascade deletion, detach/insert logic, property JSON
mutation, inverse tx generation, and optimistic snapshot/refetch recovery
ladder are gone. `optimistic.ts` now executes plan invocations in order and lets
the browser runtime own both local application and remote delivery. Undo/redo
stores inverse invocations and restores state through the same shared actions;
it has no direct tx applier.

## What remains UI-only

The UI still owns decisions that depend on rendered interaction state:

- split placement as first child versus next sibling from expansion state;
- merge focus id and cursor position;
- visible predecessor selection, focus restoration, and ancestor reveal;
- transient-node minting and pruning gestures;
- forest-root rank calculation;
- schema edit guards and ontology cycle prechecks;
- text debounce/coalescing and per-node FIFO flush preparation;
- toasts and selection/active-row projection.

These calculate action inputs or presentation effects; none is a second graph
writer.

## Reconciliation red case

The server still echoes every committed tx, including the origin. Applying an
equal echo is idempotent in the Datascript index and does not duplicate a node.
If a queued POST rejects or returns a failed receipt, the runtime does not
restore a stale local snapshot: it asks the live client to reconcile with
`since(currentRev)`. Only the server's `snapshot-required` response escalates
to the existing authoritative graph refetch.

Tests cover both halves of the red path: a failed remote confirmation invokes
the reconciler, and explicit WS reconciliation emits `{ op: "since", rev:
currentRev }`.

## Remaining gaps

- **IndexedDB:** `BrowserStore` is process-memory only and reports a null
  fingerprint. Reload always consults the port, and page reload/offline startup
  has no durable local replica yet. An IndexedDB adapter with a revision
  fingerprint can replace it without changing action handlers.
- **Offline queue:** the invocation lane is ordered but memory-only. Network
  loss triggers reconciliation; it does not durably retain and replay writes
  across reloads. A durable queue also needs an explicit conflict/replay policy.

The four port-backed core actions remain server-owned by coordinator decision;
this wave does not add browser `SavedQueries`, `Views`, or `Assets` adapters.

## Verification

- `bun run verify` — green (uncached before commit).
- `bun test packages` — 382 pass.
- `bun run test:ui` — 593 pass across 91 files.
- `wc -l packages/app/ui/src/actions/plan.ts` — 399.
- Direct action posting under `src/actions` — zero; the generic push site is in
  `src/session/runtime.ts`.

The manifest-required `tools/kb/bun.lock` delta was coordinator-approved. The
only other generated file outside UI is
`tools/kb/harness/lint-warn-baseline.json`, regenerated with `bun run
harness:snapshot`; its `eslint/max-lines` count fell from 2 to 1 when the old
planner was deleted.
