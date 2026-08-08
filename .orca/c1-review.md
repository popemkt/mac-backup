# C1 Review — canvas MVP (44902e9)

Range: `main..HEAD` (single commit). Read-only. Authoritative: research canvas report, DESIGN.md, DESIGN-RESKIN §0. Locked defaults checked: directed-only native, drift auto-remove, prop-only binding, #canvas required, new edges default layout.

---

## Findings

tools/kb/ui/src/components/canvas/canvas-page.tsx:88-94: [RED] Any store `rev` bump (WS from CLI, reconcile persist echo, peer tx) re-reads canvas JSON from the store and `setDoc`s it, with no drag/dirty guard. In-progress card moves that are only in local React state are discarded; worse, `reconcileAndMaybePersist` then may `persistCanvasDoc` the stale positions and overwrite the user's layout. Fix: skip store→doc overwrite while `dragRef` is active or a local dirty flag is set; merge foreign host-node updates carefully; never persist reconcile output that is older than `docRef`.

tools/kb/ui/src/lib/canvas-api.ts:56-73: [RED] Reconciler writes pruned docs back (`void persistCanvasDoc`) on every load/rev. Combined with the rev→setDoc path above, a foreign prop unset during an edit session can persist a stale full document (positions/cards from store, not local). Fix: debounce reconcile persist; base persist on `docRef` merge (drop only orphan edge ids); or prune in-memory until idle, then one atomic write.

tools/kb/ui/src/components/canvas/canvas-page.tsx:294-342: [RED] Toggling mode to `native` without a selected `fieldId` still persists `kbLink.mode: "native"` with `fieldId: ""`. Next WS rev runs reconcile, finds no matching prop, and drops the edge — silent data loss. Fix: refuse native without fieldId (keep layout); or demote empty-field native to layout before reconcile; do not persist native until field is chosen.

tools/kb/src/canvas/doc.ts:105-131: [YELLOW] JSON Canvas 1.0 `file` / `link` node types (and any unknown type) are silently dropped; unknown extra fields are not preserved on round-trip (`stringify` only emits known keys). Spec/research call for forward-compatible extras. Fix: passthrough unknown nodes as opaque `{type, …raw}` or preserve unrecognized fields on known types.

tools/kb/extensions-bundled/canvas.ts:128-174: [YELLOW] `ext.canvas.tx.apply` does not require `#canvas` / `sys.tag.canvas` on the host node — any user node can receive `sys.f.canvas`. Locked default: canvas tag required. Fix: reject apply unless host has type ref to `sys.tag.canvas` (or resolved `#canvas`).

tools/kb/ui/src/components/canvas/canvas-card.tsx:35-39,84-113: [YELLOW] `activateNode(card.nodeId)` / `NodeContent` omit `instanceKey`; `onKeyDown={() => {}}` disables outline structural keys. W8e instance identity and in-card editing are incomplete (duplicate cards of same node both look active; Enter/indent noop). Fix: stable canvas instanceKey per card id; wire selection keymap or a canvas-safe subset.

tools/kb/ui/src/lib/canvas-api.ts:160-178: [YELLOW] Ref-field picker sorts `fieldType=ref` first but still offers non-ref fields and never checks W8e `targetTag` / `targetQuery` against the edge target before `setProps`. Fix: filter to ref fields only (MVP); validate target with existing field-type helpers before native bind.

tools/kb/ui/src/components/canvas/canvas-page.tsx:319-325: [YELLOW] Native bind always `setProps` appends; re-toggle / re-pick same `(field, target)` can duplicate multi-valued refs. Research: duplicate triple should be idempotent. Fix: unset-then-set or skip set when value already present.

tools/kb/ui/src/lib/canvas-api.ts:140-158: [YELLOW] `createCanvasNode` POSTs `node.add` but never optimistic-`applyTx`s the new node; navigate to `/canvas/:id` can render "Canvas not found" until WS arrives. Fix: local upsert from receipt/plan before navigate.

tools/kb/ui/src/lib/router.ts:1-46: [YELLOW] New path router module is justified (no prior `/graph` route in App — checklist assumption was wrong), but §0 pattern economy: routing logic is split across `router.ts` + `App.tsx` matchers with no shared route table for future `/graph`. Fix: tiny route table in one place; fine to keep zero-deps router.

tools/kb/src/canvas/doc.ts:232-251: [YELLOW] `bindingId` is stored but unused — no collision / idempotent unset / duplicate-edge merge. Multiple native edges same `(source, field, target)` are allowed in JSON; delete unsets the single prop and reconcile then drops siblings. Fix: dedupe on bind by bindingId or triple; on delete, only drop edges sharing that bindingId.

tools/kb/ui/src/components/canvas/edge-inspector.tsx:44-48: [YELLOW] Inspector is a one-off fixed portal (acceptable popover pattern) but not shared with `tag-config-panel` anatomy; fine for MVP, watch duplication.

tools/kb/tests/canvas.test.ts:1-425: [YELLOW] Backend coverage is real (seed, round-trip, reconciler drop/keep layout, atomic tx, invalid rollback, sys-guard, native delete unset) — 11 tests. Gaps: UI debounce (no write-per-mousemove), reconcile-during-drag race, empty-fieldId native drop, targetTag validation, createCanvas hydration. `ui/.../canvas-doc.test.ts` only covers parse/reconcile/router helpers.

tools/kb/ui/src/lib/bullet-mode.ts:64-72: [YELLOW] Canvas bullet via `sys.tag.canvas` or tag name `"canvas"` — correct for ◇ glyph; low regression risk (name collision only if a non-canvas tag is literally named "canvas"). Acceptable.

tools/kb/extensions-bundled/canvas.ts:146-173: [YELLOW] Atomicity itself is sound: validate/parse → clone → single `persist` with canvas + optional source upserts; throws before persist on bad doc / missing propTarget / sys.* — no divergent half-write. sys.f.canvas on user host OK; sys.* host blocked. Keep this; no RED on the commit path alone.

.kb/nodes.jsonl:sys.f.canvas/sys.tag.canvas: seeds committed; `ensureSystemSeed` idempotent — OK.

tools/kb/ui/src/components/canvas/canvas-page.tsx:96-104: debounce 300ms for layout persist is present (`schedulePersist`); local `setDoc` still runs every pointermove (expected for live drag). Network path OK; race with rev is the RED above.

---

## Checklist notes (non-finding)

- New edges default `kbLink.mode: "layout"` — confirmed at edge create.
- Delete native unsets exact `{t:ref,v:target}` — confirmed in `onDeleteEdge`.
- Direction = prop on source card's `nodeId` — confirmed.
- Shared `NodeRow` / TagChips via `NodeContent` — yes; tokens use `foreground/[0.06]` etc., whitelist sizes.
- Lazy `/canvas` chunks — build verified in author report; separate chunks exist.

VERDICT: 3 red, 11 yellow
