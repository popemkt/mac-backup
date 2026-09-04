# R9 — editor core: creation/editing defect deep-study + ground-up component spec

Research-only. No implementation, no commits. Brief:
`docs/kb/waves/2026-08-23/briefs/r9-editor-deep.md`.

Scope: the post-i1 creation/editing path — `components/outline/**`,
`actions/{plan,mutations,optimistic}.ts`, `stores/outline.store.ts`, the
`.editable` / `MdView` render split, and the two server seams that the editor
depends on (`operations/index.ts` `node.update`, `surface/ui/session.ts` tx
broadcast).

## Method and evidence bound

- Admission gate: `./intent/gate.sh session claude` → `SOFT_MISSING: shellcheck
  actionlint nvfetcher` (exit 0).
- Live backend on an **isolated data root** (`.kb` copied to the session
  scratchpad, `kb ui --port 4399`) so no tracked file was touched. Confirmed
  serving; the browser MCP was already held by another session, so the
  interactive repro was replaced by **component-level repro against the real
  components** using the repo's existing happy-dom + `createRoot` harness
  (`components/outline/editor-behavior.test.tsx` pattern). Every claim marked
  CONFIRMED below was produced by running the real component/action/store code,
  not by reading it.
- Repro files were scratch (`ui/src/__r9_repro*.test.tsx`), run, and deleted.
  `git status` is clean; the only tracked change from this brief is this report.
  Each repro is reproduced verbatim in §1 so i8 can re-create it as a
  regression test.
- `.research/kb-refine/tana/report.md` named in the brief **does not exist in
  this worktree** (`.research/` is absent). The Tana/nxus UX bar was taken from
  `tools/kb/DESIGN-REFINE.md`, `DESIGN-UI.md`, and
  `docs/kb/waves/2026-08-23/reports/r1-editor.md` instead, plus first-party
  Tana/Logseq sources cited in §4.

---

## 1. Repro table

Wire-node counts and ids below are literal harness output.

| # | Owner report | Exact steps | Observed | Root cause | Conf. |
|---|---|---|---|---|---|
| B1 | "clicking sometimes stops working" | Zoom into any node. Click the literal `+` glyph in the bottom create strip. Then click the strip's empty padding. | Glyph click: `wireNodes` 45 → **45** (nothing). Padding click: 45 → 46. | F1 | CONFIRMED |
| B2a | "+ inserts at the START / wrong spot" | `planCreateAfter(wire, "n.child-a2", "NEW")` where `n.child-a2` has one child and is **collapsed**. | `anchor.children = ['NEW','n.grandchild']`; action `node.add {parent:"n.child-a2", position:0}`. New row became the anchor's **first child**, not its sibling. | F2 | CONFIRMED |
| B2b | same, through the UI | Expand `n.root-a` (children `[n.child-a1, n.child-a2]`). Click its `+` create-child strip. | Created node's `parentId = n.child-a2`; `n.child-a2.children = [NEW, n.grandchild]`; `n.child-a2.collapsed = true`; new node **not in `getVisibleNodes()`**. `n.root-a.children` unchanged. | F2 | CONFIRMED |
| B1b | "clicking stops working **entirely**" | Continue from B2b. | `activeNodeId = <new>`, `activeInstanceKey = tree/n.root-a/n.child-a2/<new>`, mounted `[contenteditable]` elements = **0**. Store believes a row is being edited; no editor exists. `useSelectionKeymap` bails because `activeNodeId` is set → **keyboard is dead too**. Clicking `+` again repeats it. | F2 + F3 | CONFIRMED |
| B4 | "cursor jumps while typing in creation flows" | `loadSource:"api"`, `postAction` delayed 30 ms. `void mutations.createTransientNode(...)`, then type `hello` and set caret to 5 while the POST is in flight. | Sync activate: `cursor 0 / focusSeq 1`. After typing: `cursor 5 / focusSeq 2`. **After the await resolves: `cursor 0 / focusSeq 3`** → `NodeContent`'s effect re-places the caret at offset 0. | F4 | CONFIRMED |
| B13 | "delete/edits don't stick" (data corruption) | `updateNodeContent(id,"abcdef")`, then `splitNode(id,3)` inside the 280 ms window, then let the timer fire. | Posts in order: `node.update{text:"abc"}`, `node.add{text:"def"}`, **`node.update{text:"abcdef"}`**. Server ends with `"abcdef"` *and* a `"def"` node; local store says `"abc"`. | F5 | CONFIRMED |
| B14 | "delete sometimes doesn't work" | `updateNodeContent(id,"fresh keystrokes")`, then `deleteNode(id)`, then let the timer fire. | Last post is `node.update{id, text:"fresh keystrokes"}` **after** the delete. Server `node.update` on a missing id fails → toast + `resyncOrRestoreNode` → full `/api/graph` refetch mid-edit. | F5 | CONFIRMED |
| B3 | "delete sometimes doesn't work" | `deleteNode("n.child-a2")` (it has child `n.grandchild`). | `n.grandchild` still present, `parentId = __kb_root__` — **promoted to a top-level row**. The subtree survives the delete and moves. | F6 | CONFIRMED |
| B8 | "delete sometimes doesn't work" | Caret at offset 0 of the **first** top-level row. Press `Backspace`. | `defaultPrevented = true`, forest unchanged, text unchanged. The keystroke is **consumed and discarded** — a dead key. | F7 | CONFIRMED |
| B9 | "delete sometimes doesn't work" | Caret at end of a row that has a following row. Press `Delete`. | `defaultPrevented = false`; next row untouched. No forward-merge exists. | F13 | CONFIRMED |
| B10 | "+ inserts at the START" | `splitNode(rootAtIndex0, 2)` where all forest roots are top-level. | New node (ULID `01M0…`) landed at forest **index 0**, ahead of `lens.all-mentions`, i.e. at the very top of the page — not below the caret. | F7 | CONFIRMED |
| B12 | ordering | `moveNodeDown(firstRoot)`. | Forest order identical before/after — silent no-op. | F7 | CONFIRMED |
| B5 | "does multiline collapse when unfocused?" | `MdView text={"line one\nline two"}`. | `innerHTML = <span>line one\nline two</span>`, `<br>` count **0**, class `kb-text kb-md-view flex-1 outline-none` — no `white-space` rule anywhere on that path. | F9 | CONFIRMED |
| B6 | (not reported; found) | `createTransientNode`, then move focus away so the empty transient prunes. | Pruned locally; **zero** remote actions posted. The `node.add` already reached the server, so the empty node survives there and returns on reload/resync. | F12 | CONFIRMED |

---

## 2. Root causes

Confidence: **CONFIRMED** = produced by running the code. **HIGH** = mechanism
proven by reading both sides of the seam, not directly executed.

### F1 — the create strip and the container background share one handler with a `target === currentTarget` guard
`components/outline/outline-editor.tsx:34`

```ts
const handleBackgroundCreate = useCallback((e: React.MouseEvent) => {
  if (e.target !== e.currentTarget) return;   // <-- kills glyph clicks
```

The same callback is bound to the page container (`:62`) *and* to the create
strips (`:79`, `:106`). The guard is correct for the container (don't create
when a child row was clicked) and wrong for the strips, whose whole purpose is
to be clicked — and which contain a `<span>+</span>`. Click the visible `+`
and `e.target` is the span, so the handler returns. Click 2 px away and it
works. That is exactly the "sometimes" in the report. `NodeBlock`'s own
create-child strip (`node-block.tsx:227`) uses `handleCreateChild`, which has
no guard, so the same affordance behaves differently at different depths.

Fix class: **local**.

### F2 — `planCreateAfter` is `planSplit` in disguise, and inherits its "first child" heuristic
`actions/plan.ts:755-762`, `actions/plan.ts:64`

```ts
export function planCreateAfter(nodes, afterId, newId) {
  const after = requireNode(nodes, afterId);
  return planSplit(nodes, afterId, after.text.length, newId);   // no opts
}
// planSplit:
const asFirstChild = node.children.length > 0 && (!opts.expandedIds || opts.expandedIds.has(id));
```

`planSplit`'s Tana rule (r1 D07) is: Enter on an **expanded** parent puts the
new row as its first child. `expandedIds` is how "expanded" is decided — and
`mutations.splitNode` (`mutations.ts:313-321`) is the only caller that passes
it. `planCreateAfter` passes nothing, and `!opts.expandedIds` short-circuits to
`true`, so **every** create-after where the anchor has children becomes
"insert as the anchor's first child", collapsed or not.

Consequences, all confirmed:

- Clicking a parent's `+` strip when its last child has children inserts the
  new row **inside that child, at position 0** (B2b) — "at the START".
- If that child is collapsed (the default), the new row is invisible (B2b).
- Repeated `+` clicks keep landing in the same invisible slot, because
  `handleCreateChild` keeps picking the same `children.at(-1)` anchor. The
  affordance looks permanently dead.

Callers affected: `createTransientNode` (`mutations.ts:220`), `createNodeAfter`
(`mutations.ts:187`), `createNodeBefore` (`mutations.ts:251`), and the
zoom-root/home background create (`outline-editor.tsx:36`).

Fix class: **abstraction replace** — "insert a sibling after X" and "split X at
the caret" are different operations that happen to share a shape.

### F3 — activation does not require the target to be rendered
`actions/optimistic.ts:177-181`, `actions/mutations.ts:228-232`,
`components/outline/use-selection-keymap.ts:116`

`runOptimistic` activates `plan.focusId` using `outlineInstanceKey`, which walks
`parentId` to build a path. The path is honest — but nobody checks whether that
path is *rendered*. When F2 buries the new node inside a collapsed parent, the
store enters a state that no component can service:

```
activeNodeId      = <new>
activeInstanceKey = tree/n.root-a/n.child-a2/<new>
mounted [contenteditable] = 0
```

Mode B then refuses to help, because it treats a non-null `activeNodeId` as
"someone else owns the keyboard":

```ts
if (!selectedNodeId || !selectedInstanceKey || activeNodeId) return;
```

So the outline is wedged: no caret, no selection keymap, and the only escape is
clicking a different row. This is the mechanism behind "clicking stops working
entirely" and behind "delete sometimes doesn't work" (Backspace/Delete have
nowhere to land). Note `indentNode` already solves the same problem correctly
for its own case — it calls `expandAncestors(id)` before restoring focus
(`mutations.ts:370-375`, r1 D05). Creation never got that treatment.

Fix class: **model change** — activation must be a validated transition against
the visible-instance set.

### F4 — creation activates twice; the second activation lands after the network round-trip
`actions/optimistic.ts:177-181` then `actions/mutations.ts:231` and `:261`

```ts
// optimistic.ts — correct, synchronous, before any await
if (plan.focusId) next.activateNode(plan.focusId, plan.focusCursor ?? 0, key);
...
// mutations.ts createTransientNode — again, AFTER `await applyPlan(...)`
const ok = await applyPlan(...);
useOutlineStore.getState().markTransient(newId);
const store = useOutlineStore.getState();
store.activateNode(newId, 0, outlineInstanceKey(newId, store.nodes));
```

`activateNode` unconditionally writes `cursorPosition: cursorPos ?? 0` and
bumps `focusSeq` (`stores/outline.store.ts:552-560`). `NodeContent`'s caret
effect is keyed on exactly those two values:

```ts
}, [isActive, cursorPosition, focusSeq]);   // node-content.tsx:121
```

so the post-await call re-runs the effect and calls
`setCaretSerializedOffset(el, Math.min(cursorPosition, content.length))` with
`cursorPosition = 0`. The user is already typing by then. B4 measures the
transition precisely: `cursor 5 / focusSeq 2` → `cursor 0 / focusSeq 3`.

**The 280 ms debounce is not the cause of the caret jump.** `updateNodeContent`
never calls `activateNode`, and `content` is deliberately excluded from the
effect deps, so ordinary typing does not move the caret. The debounce causes a
different family of bugs (F5).

The deeper defect is that caret placement is modelled as *state* that a view
effect mirrors, rather than as a *one-shot intent*. Any incidental write to
`cursorPosition`/`focusSeq` — from any code path, now or later — yanks the
user's caret. `focusSeq` exists precisely because the state model can't express
"place the caret once".

Fix class: **local** to stop the bleeding (delete the duplicate activation);
**model change** to stop the class (caret intent, §5.3).

### F5 — the text debounce is not ordered against structural mutations
`actions/mutations.ts:160-181`

`pendingContent` is a module-level `Map<id, {text, preEdit, timer}>` with a
280 ms timer. Nothing in the codebase flushes or cancels it: not `splitNode`,
not `deleteNode`, not indent/outdent/move, not unmount. Two confirmed failures:

- **B13, split:** the plan posts `node.update{text:"abc"}` + `node.add{"def"}`,
  then the stale timer posts `node.update{text:"abcdef"}`. The server keeps
  `"abcdef"` in the left node *and* the `"def"` node — the split text is
  duplicated and the local store (which says `"abc"`) is now wrong. The next WS
  echo or reload shows the corruption.
- **B14, delete:** the timer posts `node.update` for a deleted id. The action
  fails, `flushContentRemote` toasts and calls `resyncOrRestoreNode`
  (`mutations.ts:136-150`), which refetches the whole graph and calls
  `refreshFromWire`. A full re-projection lands mid-edit for what the user
  experienced as a normal delete.

`updateNodeContent` also captures `content` in the timer closure rather than
reading the latest pending text at fire time, so an in-flight edit sequence
posts an older string than the one in the map.

Fix class: **model change** — one ordered mutation queue per node; structural
ops drain it first; delete cancels it.

### F6 — delete is shallow at both layers, and orphans become top-level rows
`actions/plan.ts:131-145`, `tools/kb/src/operations/index.ts:428-434`,
`ui/src/lib/graph-view.ts:67-81`

```ts
// UI plan
return { upserts, deletes: [id], actions: [{ id: "node.update", input: { id, delete: true } }] };
// core
if (input.delete) {
  const upserts = detachFromParents(ctx.nodes, input.id);
  yield* persistEffect(ctx, { upserts, deletes: [input.id] });
```

Neither side touches descendants. The UI then derives forest roots as "every
node no one lists as a child":

```ts
return nodes.filter((n) => { if (kids.has(n.id)) return false; ... }).sort(compareWireNodeId)
```

so every orphan is silently promoted to a top-level row. B3: delete
`n.child-a2` and `n.grandchild` reappears at the root with
`parentId = __kb_root__`. Note that `use-node-keydown.ts:95` advertises
`Cmd+Backspace` as "Delete subtree" and r1-editor.md's Mode A table specifies
"MUST delete node and its subtree" — the plan does not implement it.

Fix class: **model change** — deletion needs an explicit descendant decision and
an orphan-rejecting invariant, both sides.

### F7 — forest-root order is derived from id collation, so root-level position is unrepresentable
`ui/src/lib/graph-view.ts:79`, `ui/src/lib/tx.ts:4-6`, `actions/plan.ts:96-129,
250-252, 294-295, 765-782`

There is no order attribute. Top-level order is:

```ts
export function compareWireNodeId(a, b) { return a.id.localeCompare(b.id); }
```

Everything downstream degrades from that single fact:

- `planAddRootNode` emits `node.add {text, id}` with **no position** — position
  cannot be expressed for a root.
- `planSplit` on a parentless anchor takes the `parent === null` branch and
  drops both `parent` and `position` from the action (`plan.ts:96-110`).
  B10: splitting the row at index 0 put the new ULID at index 0 — *above* its
  own source, at the top of the page. Digits collate before letters, so a fresh
  `01M0…` id sorts ahead of any non-ULID root (`lens.*`, `n.*`) and after older
  ULIDs. The insert position is whatever the id sort says.
- `planOutdent` returns `null` when there is no parent (`plan.ts:250-252`), so
  `mutations.outdentNode` returns early. `use-node-keydown.ts:138-141`
  nevertheless calls `preventDefault()` first — B8's dead key.
- `planMove` returns `null` for the same reason (`plan.ts:294-295`), so
  `Cmd+Shift+Arrow` on a top-level row is a silent no-op (B12), against
  r1-editor.md's "MUST move node up among siblings".
- `createTransientNode` short-circuits on `parentId === WORKSPACE_ROOT_ID`
  (`mutations.ts:214-216`) and discards `afterSiblingId` entirely, because there
  is nothing it could do with it.

`__kb_root__` is synthesised in the view (`graph-view.ts:121-128`), not stored,
so the root level is the one place in the tree with no parent to hold order.

Fix class: **model change**.

### F8 — the tx broadcast has no origin exclusion, so a client races its own echo
`tools/kb/src/surface/ui/session.ts:224-229`, `ui/src/api/live.ts:41-42`,
`ui/src/lib/tx.ts:33-42`

```ts
const payload = JSON.stringify(tx);
for (const c of this.clients.values()) {
  if (c.watchTx) sends.push(c.send(payload));   // includes the originator
}
```

The client applies it verbatim: `onTx → applyTx → mergeTx`, and `mergeTx`
replaces the whole node (`byId.set(u.id, cloneWire(u))`). So while the user
types, the echo of an *older* 280 ms flush overwrites the store text with a
shorter string. The contentEditable DOM does not revert (React does not own its
children — `renderEditableContent` writes it imperatively), so nothing looks
wrong. But `use-node-keydown.ts:59` reads `live?.text` from the store for every
structural decision, so Enter/Tab/Backspace pressed in that window operate on
truncated text and silently drop characters. This is the same failure family as
B13, arriving from the other direction.

Confidence: **HIGH** (both sides read; needs a live socket to execute).

Fix class: **local** for the immediate hole (skip the originating client, or
ignore echoes for ids with pending local edits); **model change** to do it
properly (origin/rev tagging on tx).

### F9 — multiline: `white-space: pre-wrap` exists only on the active editor
`ui/src/index.css:247-250`, `components/outline/md-view.tsx:46,61`,
`components/outline/node-content.tsx:272-302`

```css
/* Prevent contentEditable from inserting divs on Enter */
.editable[contenteditable="true"] {
  white-space: pre-wrap;
  word-break: break-word;
}
```

The inactive branch renders `MdView`, whose classes are
`kb-text kb-md-view flex-1 outline-none` plus
`min-h-6 min-w-0 flex-1 self-start text-foreground/85`. `.kb-text` sets only
`font` (`tokens.css:15-17`). Nothing on that path sets `white-space`, and
`parseInlineMd` emits the `\n` inside a `text` segment rendered as a plain
`<span>` (`md-view.tsx:61`) with no `<br>` (B5). CSS default `white-space:
normal` collapses it to a single space.

So the answer to the brief's question is **yes**: a node authored with
`Shift+Enter` shows two lines while focused and one line the instant focus
leaves, then two lines again on refocus. The text is never lost — only the
rendering. It is a pure CSS/markup scoping bug, not a data or markdown-model
problem.

Fix class: **local** (CSS) + small **abstraction replace** (§5.4: one host owns
the white-space rule for both states).

### F10 — three content hosts, three caret models
`components/outline/node-content.tsx`,
`components/outline/zoomed-root-header.tsx:17-88`, table/board name cells

`NodeContent` is the real one (serialized markdown offsets, atomic ref pills,
caret geometry). `ZoomedRootHeader.EditableTitle` is a second, independent
implementation: raw `el.textContent` read/write, `truncate` (single line,
ellipsis), no `md-edit`, no pills, and an effect keyed `[editing, text]` that
re-assigns `el.textContent = text` — so a WS tx arriving while the title is
being edited **destroys the in-progress text** and parks the caret at the end.
Its `onKeyDown` also lets `Shift+Enter` through to the browser, which inserts a
`<div>`/`<br>` that `textContent` serialization silently discards. Table/board
name cells are a third variant (they share `useNodeKeyDown` but not the content
host; i1's own follow-up list item 1 flags this).

Fix class: **abstraction replace**.

### F11 — `if (!ok)` against an object: indent/outdent record undo even after a failed plan
`actions/mutations.ts:366`, `:385`

```ts
const ok = await runOptimistic(plan);   // returns { ok, focusId?, focusCursor? }
if (!ok) return;                        // never true — object is always truthy
recordHistory(preWire, plan);
```

`runOptimistic`'s failure path already resynced or restored the graph
(`optimistic.ts:141-157`), so `recordHistory` pushes an inverse computed against
a pre-state that no longer relates to the live graph. A later Cmd+Z then applies
a garbage inverse. `applyPlan` gets this right (`mutations.ts:75-76`,
`if (result.ok)`); only these two hand-rolled call sites are wrong.

Fix class: **local**.

### F12 — transient prune is local-only
`stores/outline.store.ts:225-249`

`pruneOutgoingTransient` builds `mergeTx(st.wireNodes, [], [out])` and `set(...)`
— no `postAction`. But `createTransientNode` already POSTed `node.add` and
awaited it before marking the node transient (`mutations.ts:212-230`), so the
empty node exists on the server. B6: pruned locally, zero remote actions. Every
abandoned `+` click leaves a permanent empty row that returns on reload or on
any `refreshFromWire`. The design doc's promise — "silently drops a
session-transient node when focus leaves it while it is still empty"
(`DESIGN-UI.md:151`) — holds only until the next resync.

Fix class: **local** (post the compensating delete) or **model change** (defer
the mint until first input, so nothing needs compensating).

### F13 — no forward-delete merge
`components/outline/use-node-keydown.ts:155-156`

```ts
case "Delete": {
  if (!(e.metaKey || e.ctrlKey)) return;   // native forward delete
```

At end-of-text, native forward delete has nothing to delete, so the key does
nothing (B9). Logseq treats `Delete` at end-of-block as "concatenate the next
block". r1-editor.md's Mode A table has no forward-delete row, so this is a
**spec gap as well as an implementation gap**.

Fix class: **local** (+ one row added to the r1 keymap table).

### F14 — whitespace-create is inconsistent, and the bottom gutter is a create target
`components/outline/outline-editor.tsx:62` vs `:95`

The zoomed-root container carries `onClick={handleBackgroundCreate}`; the home
container does not. Since the container also carries `pb-40`, any click in that
160 px bottom gutter of a zoomed page satisfies `target === currentTarget` and
mints a node — while the same gesture on home does nothing.

Fix class: **local**.

### F15 — node command palette unreachable

Full analysis in §3.2 (it is one of the brief's explicit verdicts rather than a
defect found while reading). Fix class: **abstraction replace** (restore an
entry point).

### F16 — click-to-caret always lands at end of text
`components/outline/node-content.tsx:177`

```ts
onActivate(content.length);
```

Clicking the middle of an inactive row activates it with `cursorPosition =
content.length`, and the caret effect then places the caret at the end,
overriding wherever the browser put it. r1-editor.md §3.1 states the contract
explicitly: *"Click anywhere on text → ACTIVE (caret at click)"*. `caret.ts`
already has the machinery (`nearestOffsetForX`) — it is simply not used on the
click path.

Fix class: **local**.

---

## 3. Verdicts

### 3.1 Multiline collapse — verdict

**It collapses today, and that is a bug, not a design position.**

- **Which element/CSS decides.** `.editable[contenteditable="true"]` in
  `index.css:247-250` sets `white-space: pre-wrap`. The inactive path
  (`MdView`, `md-view.tsx:46`) has no `white-space` rule at any level, so it
  inherits `normal`.
- **What happens to `\n` when inactive.** Nothing structural — the character
  stays in `node.text` and in `.kb/nodes.jsonl`; `serializeEditable` and
  `parseInlineMd` both carry it. It is rendered inside a `<span>` as ordinary
  whitespace and collapsed to a single space (B5: zero `<br>`, no pre-wrap).
  Refocusing restores both lines because `renderEditableContent` rebuilds the
  DOM and the pre-wrap rule applies again.
- **What SHOULD happen.** kb has already made the semantic choice: `Shift+Enter`
  inserts a real `\n` into node text (`use-node-keydown.ts:68-77`, r1 §3.2,
  `DESIGN-UI.md:163`). That is **Logseq's** model, not Tana's — Logseq documents
  Shift+Enter as the in-block soft break and renders it in the block view, while
  Tana has never supported line breaks inside a node (a 200-vote, 25-comment
  request with no support as of its last update). Since we ship the Logseq
  semantics, the Logseq rendering is the only consistent choice:
  1. A node's rendered line count MUST be identical active and inactive. No
     reflow on focus/blur.
  2. `\n` renders as a hard line break in the row body — `white-space:
     pre-wrap` on the shared text host, so active and inactive share one rule.
  3. **Compressed contexts stay clamped, deliberately**: reference rows
     (`references-section.tsx:97`), schema rows (`schema-section.tsx:124`),
     table cells, board cards, breadcrumbs, and ref pills show the first line
     only, with an ellipsis. Logseq does the same and it is a known,
     accepted trade (block refs display only the first line). This must be an
     explicit `clamp` variant of the host, not the accidental default it is now.
  4. Row height is content-driven (`min-h-6`, already true); the row token
     `--kb-row-h` stays the *minimum*, not a fixed height.

### 3.2 Inline command palette — verdict: **LOST**

`NodeCommandPalette` is intact and functional (portal, anchored to the row's
`.node-row` rect, commands: add tag, turn into query, indent, outdent, delete,
view-as list/table/board/cards, filter, hand-off to global search). It is also
**unreachable**: `setNodePaletteOpen(true)` appears **nowhere** in the
codebase. Every reference is either `false` (`outline-editor.tsx:89`, `:113`) or
the mutual-exclusion bookkeeping inside `ui.store.ts:41-49`. `nodePaletteOpen`
can never become `true`, so `node-block.tsx:114-117`'s palette-anchor highlight
is also dead.

Two independent losses:

1. **The `/` trigger was cut by design in i1.** r1-editor.md §3.2 Mode A lists
   `` `/` | Caret at start of empty line | MUST open Node Command palette``.
   i1-editor.md's cut list says: *"Tag autocomplete (`#`) and command palette
   (`/`) triggers from Mode A: distinct popovers with their own data sources;
   not in any D-row… later wave."* So a MUST row was deferred.
2. **The ⌘K trigger regressed accidentally.** Commit `4d6bbc7` ("fix: kb ui
   ghost-row typing + palette gating") had exactly the nxus flow: match the
   shortcut, resolve `activeNodeId ?? selectedNodeId`, demote an active row to
   selected, then `setNodePaletteOpen(...)`, with an info toast when nothing is
   anchored. Commit `bf1080e` ("fix: polish kb navigation and accessibility")
   reduced `matchGlobalShortcut` to `if (key === "k") return "global-search"`
   and collapsed the App handler to a single `setGlobalPaletteOpen` call,
   deleting the node branch. Nothing replaced it.

**Restore spec** (no new component needed):

- `keyboard-shortcuts.ts`: restore the discriminated return — `"global-search"`
  vs `"node-palette"`. Keep ⌘K as global search (it is documented that way in
  DESIGN-REFINE §2 W3); bind the node palette to `⌘K` **when a row is selected
  or active** and fall through to global search otherwise, matching `4d6bbc7`'s
  resolved behaviour. Emit the "Select a node to open the command palette"
  info toast when neither exists.
- Mode A: `/` at offset 0 of an **empty** node opens the palette scoped to that
  node (the r1 MUST). Route it through `NodeContent`'s existing popover
  discipline (the `[[` ref path is the template, per i1's own note): Escape
  dismisses the popup only, never leaves edit mode (D14).
- Mode B: `/` must be intercepted **before** `selection-keymap.ts`'s printable
  fallback (`:148-163`), which currently swallows `/` into the node's text.
- The palette is already anchored per-row and reads `activeNodeId ??
  selectedNodeId` (`node-command-palette.tsx:51`), so scoping needs no change.
- Also fix while there: the anchor rect is captured once on open
  (`:54-65`) and never recomputed, so the popover detaches if the outline
  scrolls or reflows under it.

---

## 4. What mature OSS outliners do differently

Sourced, and mapped onto the findings above.

**Logseq — an explicit outliner operation vocabulary.** `logseq.outliner.core`
exposes named ops with the structural decision as a *parameter*, not an
inference: `insert-blocks` takes `sibling?` (and `keep-uuid?`) and "assigns
parent and order based on whether the insertion is a sibling or a child";
`delete-blocks` takes `children?` and filters selections to top-level blocks
"to avoid redundant deletion of nested blocks"; `move-blocks` updates parent and
order together; `indent-outdent-blocks` is its own op. Everything runs inside
`ui-outliner-tx/transact!` with pre-commit validation that enforces structural
invariants (e.g. "a page entity cannot have a block as its parent") and throws
rather than persisting a broken tree.
→ Directly answers **F2** (sibling-vs-child must be an argument) and **F6**
(cascade must be an argument, with orphan rejection in the tx validator).

**Logseq — sibling order is stored, via fractional indexing.** `:block/order` is
"a fractional string allowing insertion between siblings without expensive
reordering"; Logseq maintains its own port,
[`logseq/clj-fractional-indexing`](https://github.com/logseq/clj-fractional-indexing),
having moved off the earlier `:block/left` linked-list model. Insert-between,
drag-reorder, and optimistic concurrent inserts all become single-node writes.
→ Directly answers **F7**. This is the one place I would take a dependency
rather than write our own.

**Logseq — one editor instance, mounted only on the editing block.** The
`lazy-editor` component "mounts the editable textarea editor only on blocks
currently in editing mode"; inactive blocks are static markup rendered by
`block-content`. Editing state is a small reactive record: `:editor/editing?`
(the UUID being edited), `:editor/content` (the text buffer per editing block),
`:editor/action` (e.g. slash-command mode), `:editor/container-id`. Caret work
goes through one `cursor/set-selection-to` helper.
→ Validates our overall shape (`isActive ? editor : view`) and indicts **F10**
(we have three hosts, not one) and the `:editor/action` idea is exactly the
missing state for **§3.2**'s `/` mode.

**ProseMirror — selection is part of the state and is *mapped* through changes.**
State is `{doc, selection, storedMarks}`; every change is a transaction of
steps; `StepMap`/`Mapping` "convert between positions in the document before and
after applying the step", with a `bias` parameter for insertion boundaries. The
DOM is explicitly not authoritative — the view reconciles it from state, and
browser-side edits are re-parsed *into* transactions.
→ This is the correct answer to **F4**. Our caret is a raw integer re-clamped
against whatever string is current (`Math.min(cursorPosition, content.length)`);
ProseMirror never re-derives a position, it maps it through the step that
changed the document. We do not need ProseMirror to adopt the principle: we need
`mapOffset(step, offset)` for our three text-changing step kinds.

**Tana — no soft line breaks at all.** Line breaks inside a node are an
unimplemented, heavily-requested feature. So Tana is *not* a precedent for
either side of the multiline question; the Tana-parity argument stops at node
granularity. Logseq is the applicable precedent, and we already implement its
`Shift+Enter` semantics (§3.1).

### Import vs build

| Concern | Decision |
|---|---|
| Sibling order keys | **Import** `fractional-indexing` (or equivalent). Tiny, well-tested, exactly what Logseq did. |
| Position mapping through edits | **Build**, ~50 lines. Adopt ProseMirror's *concept* (`Mapping`, bias) over our three step kinds (`updateText`, `split`, `merge`). A PM dependency buys nothing here. |
| Op vocabulary + tx validation | **Build**, modelled on `logseq.outliner.core`'s signatures. Our `plan.ts` is already 80 % there; it needs the params split out and a validator. |
| The text editor itself | **Build / keep.** Do **not** adopt ProseMirror/TipTap/Slate per row. Our node text is one markdown string with atomic ref pills; a PM document per row means a schema + view + plugin stack per row, and the outline (not the row) is the real document. Logseq reached the same conclusion — a plain textarea per editing block. `md-edit.ts` is our minimal equivalent and it works; the fix is to make it the **only** one (**F10**). <br>*Honest alternative considered:* one PM/CodeMirror instance for the entire outline would give position mapping and multi-block selection for free, but requires re-expressing the node graph as a single PM doc and fights every projected view (table/board/cards/query). Out of scope; revisit only if multi-block text selection becomes a requirement. |
| Autocomplete / palette popovers | **Keep ours.** `NodeContent`'s `[[` popover discipline (D14/D15) is already better than most; reuse it for `#` and `/`. |

---

## 5. Component-level design spec

The bugs are not independent. Eleven of the sixteen findings come from four
structural decisions: **the caret is state instead of an intent**, **structure
is inferred instead of parameterised**, **order lives in the view instead of the
model**, and **there is no single ordered mutation path**. The spec below names
five primitives and the invariants each owns. Each invariant is stated so that
it can be turned into a test.

### 5.1 `OutlineDoc` — the store owns structure and order, and nothing else

Replaces the structural half of `outline.store.ts`. Holds the wire set, the
projection, and rev. Holds **no** caret or focus state.

- **O1 (single parent).** Every node has exactly one parent. Forest roots are
  children of a *stored* root node, not of a view-synthesised `__kb_root__`.
- **O2 (order is stored).** Sibling order comes from an order key on the node
  (fractional index string), never from id collation. `forestRootIds` reads
  order; `compareWireNodeId` is deleted from the ordering path.
  *Kills F7. Requires a one-time migration: assign order keys in current
  sorted order so nothing visibly moves.*
- **O3 (no orphans).** A transaction that removes a node must either remove its
  descendants or reparent them explicitly. `applyTx` **rejects** a tx that would
  leave a node unreachable from a root, and says which node. *Kills F6.*
- **O4 (echo safety).** A tx is tagged with its origin and rev. An echo of the
  local client's own action is ignored; a remote upsert for a node with pending
  local edits is merged, not clobbered. *Kills F8.*
- **O5 (projection purity).** `projectWire` derives; it never mutates focus,
  selection, or order.

### 5.2 `EditOps` — named structural operations, parameters not inferences

Replaces `plan.ts`'s overloaded helpers. Each op returns
`{tx, focus: FocusIntent}`; `FocusIntent` is computed **inside** the op from the
post-tx tree.

```
insertSibling(anchorId, side: "before" | "after")      // never delegates to split
insertChild(parentId, index: number | "start" | "end")
splitAt(id, offset, { expandedIds })                   // Enter only; keeps D07
mergeInto(id, targetId)
deleteSubtree(id, { descendants: "cascade" | "reparent" })
indent(id) / outdent(id) / move(id, "up" | "down")
```

- **T1 (no structural inference).** No op may decide sibling-vs-child from
  "does the anchor have children". `splitAt` is the *only* op that consults
  `expandedIds`, and it requires the caller to pass it — the parameter has no
  permissive default. *Kills F2.*
- **T2 (focus is part of the result).** Every op names its focus target as
  `{nodeId, parentPath, offset}` computed after the tx. Callers do not
  re-derive it and **may not re-activate after awaiting**. *Kills F4's proximate
  cause.*
- **T3 (root level is a normal level).** With O1/O2 in place, `insertSibling`,
  `move`, and `outdent` work at the root exactly as at depth 3; no `null`
  returns, no `preventDefault`-then-nothing. *Kills F7's symptoms B8/B10/B12.*
- **T4 (position is always expressible).** Every emitted `node.add` /
  `node.update` carries parent + order key. No action may silently drop
  position.

### 5.3 `CaretIntent` — placement is a one-shot command

Replaces `cursorPosition` + `focusSeq` + `focusX` with a single consumable slot:

```
pendingCaret: { instanceKey: string; at: number | "end" | { x: number } } | null
```

The content host consumes it in a layout effect and clears it. Nothing else
reads it.

- **C1 (no incidental movement).** A re-render, a store write, or a WS tx never
  moves the caret. Only an explicit `CaretIntent` does. *Kills F4's class —
  `focusSeq` exists only because the current model cannot express this.*
- **C2 (offsets are mapped, not clamped).** An offset produced before a tx is
  passed through `mapOffset(step, offset)` for that tx, ProseMirror-style,
  instead of `Math.min(offset, text.length)`. *Prevents the whole family of
  "caret ended up somewhere plausible but wrong".*
- **C3 (unreachable intents are loud).** A `CaretIntent` naming an unmounted
  instance is dropped **and** reported in dev. It is always a bug upstream.
- **C4 (one owner).** Serialized-markdown offsets are the only currency; the
  DOM is measured only by `md-edit.ts` / `caret.ts`.

### 5.4 `NodeTextHost` — the one editable text component

One component renders both states of a node's text. Same box, same typography,
same white-space rule, atomic ref pills in both. Variants: `row` (multiline,
`pre-wrap`), `title` (multiline, header typography), `clamp` (first line +
ellipsis, for refs/schema/table/board/breadcrumbs).

- **H1 (no reflow on focus).** The same text yields the same line count active
  and inactive. Testable directly: compare rendered line boxes (or `<br>`
  counts) in both states. *Kills F9 by construction.*
- **H2 (store is authoritative).** The host reads its own DOM only to serialize
  on input and to measure the caret. It never treats the DOM as truth, and it
  never re-assigns its own content from a prop mid-edit. *Kills F10's
  title-clobber.*
- **H3 (exactly one active).** At most one host is active; it is always mounted
  and visible.
- **H4 (click-to-caret).** Activation from a pointer event carries the offset
  under the pointer. *Kills F16.*
- Absorbs: `NodeContent`'s editor + `MdView` pair,
  `ZoomedRootHeader.EditableTitle`, table/board name cells.
- `NodeContent` keeps only what is genuinely its own: tag chips, drop target,
  sys padlock, autocomplete host. Its local `cursor` state disappears (it exists
  today only to duplicate `store.cursorPosition`).

### 5.5 `MutationQueue` — one ordered path to the server

Replaces the `pendingContent` map.

- **M1 (per-node FIFO).** All writes for a node are ordered. Text coalesces
  inside a window; structural ops do not.
- **M2 (flush before structure).** A structural op drains every pending text
  write for the nodes it touches *before* planning, so plans are computed
  against text the server will actually have. *Kills F5/B13.*
- **M3 (delete cancels).** Deleting a node discards its queued writes and
  compensates anything already sent. *Kills F5/B14 and F12.*
- **M4 (latest wins).** A coalesced flush sends the newest text at fire time,
  not the text captured when the timer was armed.
- **M5 (typed results).** Call sites branch on `result.ok`, never on the
  result object. *Kills F11 — and a lint rule for truthiness on a known object
  type prevents its return.*

### 5.6 `FocusRegistry` — activation is a validated transition

- **F1 (reachability).** `activate(nodeId, instanceKey)` expands every ancestor
  first (as `indentNode` already does for D05) and refuses targets that cannot
  be rendered. *Kills F3.*
- **F2 (creation is visible).** A newly created node is visible and focused
  before the create op returns. No op may leave `activeNodeId` pointing at an
  unmounted instance.
- **F3 (no dead keyboard).** If `activeNodeId != null` but no host is mounted,
  the registry drops back to selection mode rather than leaving the outline
  inert. Belt-and-braces for F1; also removes Mode B's silent bail as a
  wedge condition.

### 5.7 Which current components violate SRP / hold split state

| Component | Problem | Consequence |
|---|---|---|
| `NodeContent` | Four responsibilities (text host, autocomplete, tag chips, drop target) and a local `cursor` that shadows `store.cursorPosition`. | The caret bug lives in the seam between the two cursors; the effect's dep list needs an eslint suppression (`node-content.tsx:120`) to stay wrong-but-working. |
| `planSplit` | Serves both "split at caret" and "create sibling after". | F2 — the `asFirstChild` heuristic is right for one caller, catastrophic for the other. |
| `mutations` | sys guard + plan choice + optimistic apply + undo recording + focus restore + debounce, per function, copy-pasted. | F4 (duplicate activation), F11 (two hand-rolled call sites drift from `applyPlan`), F5 (debounce has no owner). |
| `graph-view.forestRootIds` | The **view** decides sibling order. | F7 — position becomes unrepresentable in the model. |
| `outline.store` | Owns structure *and* caret/focus/selection/transient bookkeeping. | Caret placement becomes a side effect of structural writes (F4); prune becomes a store-local operation with no remote arm (F12). |
| `outline-editor` | One handler for two different gestures. | F1, F14. |
| `ZoomedRootHeader.EditableTitle` | A second editor. | F10. |

---

## 6. Findings by fix class

| ID | Finding | Class |
|---|---|---|
| F1 | `+` glyph click swallowed by the shared `target === currentTarget` guard | local |
| F4 | duplicate post-await activation resets the caret | local (class-level: model, §5.3) |
| F9 | multiline collapses when unfocused (`white-space` scoped to `.editable`) | local (+ small abstraction) |
| F11 | `if (!ok)` on an object — undo recorded after failed indent/outdent | local |
| F12 | transient prune posts no compensating delete | local |
| F13 | no forward-delete merge (also an r1 spec gap) | local |
| F14 | whitespace-create inconsistent; `pb-40` gutter is a create target | local |
| F16 | click-to-caret always lands at end of text (violates r1 §3.1) | local |
| F8 | tx broadcast has no origin exclusion | local patch / model change to do properly |
| F2 | `planCreateAfter` inherits `planSplit`'s first-child inference | abstraction replace |
| F10 | three content hosts, three caret models | abstraction replace |
| F15 | node command palette unreachable (`/` cut + ⌘K regressed) | abstraction replace (restore an entry point) |
| F3 | activation does not require a rendered target | model change |
| F5 | text debounce unordered against structural mutations | model change |
| F6 | delete is shallow; orphans promoted to top level | model change |
| F7 | forest-root order derived from id collation | model change |

---

## 7. i8 implementation task list

Ordered. Each item is independently testable and independently shippable; each
names the repro that becomes its regression test.

**Phase 1 — stop the reported bleeding (local, low risk, high visibility)**

1. **Split the create-strip handler from the background handler.**
   `outline-editor.tsx`: strips get a guard-free handler; keep
   `target === currentTarget` on the container only. *Test: B1 — clicking the
   `+` glyph mints exactly one node; clicking a row does not.* (F1)
2. **Make whitespace-create consistent.** Same behaviour on home and zoomed
   pages; the `pb-40` gutter is not a create target — only the explicit strip
   is. *Test: click in bottom padding → no node; click strip → one node.* (F14)
3. **Split `planInsertSibling` off `planSplit`.** New
   `planInsertSibling(nodes, anchorId, side, newId)` inserting into the
   anchor's parent at `anchorIdx ± 1`, and `planInsertChild(nodes, parentId,
   index, newId)`. Repoint `createTransientNode`, `createNodeAfter`,
   `createNodeBefore`. `planSplit` keeps `expandedIds` and loses its
   permissive default (make the option required). *Test: B2a + B2b.* (F2)
4. **Delete the post-await `activateNode` calls** in `createTransientNode`
   (`mutations.ts:231`) and `createNodeBefore` (`:261`); rely on
   `runOptimistic`'s single activation. *Test: B4 — `cursorPosition` stays 5 and
   `focusSeq` does not change when the POST resolves.* (F4)
5. **Fix `if (!ok)` → `if (!result.ok)`** at `mutations.ts:366` and `:385`.
   *Test: a failed indent records no undo entry.* (F11)
6. **`white-space: pre-wrap` on the inactive node body**, with an explicit
   `clamp` variant kept for references/schema/table/board/breadcrumbs.
   *Test: line-box count is equal active vs inactive for `"a\nb"`; a reference
   row still renders one line.* (F9)
7. **Click-to-caret.** Add `offsetFromPoint` next to `nearestOffsetForX` in
   `caret.ts`; `NodeContent.handleClick` activates with that offset instead of
   `content.length`. *Test: click at the x of character 3 → caret at 3.* (F16)
8. **Forward-delete merge.** `Delete` at end-of-text merges the next visible row
   into this one; add the row to r1-editor.md's Mode A table. *Test: B9.* (F13)
9. **Restore the node command palette.** Discriminated `matchGlobalShortcut`
   again; ⌘K opens the node palette when a row is selected/active and global
   search otherwise (with the info toast); `/` at offset 0 of an empty node
   opens it from Mode A, intercepted **before** `selection-keymap`'s printable
   fallback; recompute the anchor rect on scroll/resize. *Test: `/` opens and
   Escape closes it without leaving edit mode; ⌘K with a selection opens the
   node palette; without one, global search.* (F15) — independent of 1–8; can
   land in parallel.

**Phase 2 — model changes that stop the classes recurring**

10. **`MutationQueue`.** Per-node FIFO; text coalesces; structural ops drain
    pending writes for the ids they touch before planning; delete cancels and
    compensates; a coalesced flush sends the newest text at fire time.
    *Test: B13 (last `node.update` for the split node is `"abc"`) and B14 (no
    post touches a deleted id).* (F5, and F12's remote arm)
11. **Cascade delete + orphan rejection.** `planDelete` collects the subtree;
    core `node.update {delete:true}` gains an explicit descendant decision
    (default cascade) and `applyTx` / the core tx validator refuse a tx that
    would orphan a node. *Test: B3 — `n.grandchild` is gone; plus a core test
    that the graph has no unreachable node after any delete.* (F6, O3)
12. **Stored sibling order.** Add an order key to the wire node; make the root a
    stored parent for forest roots; `forestRootIds` reads order; every
    `node.add` / `node.update` carries parent + order. One-time migration
    assigning keys in current sorted order (nothing visibly moves). Unlocks
    root-level insert-after, move up/down, and outdent-to-root.
    *Test: B8 (Backspace at 0 on the first root outdents-or-merges, never a
    dead key), B10 (new row sits directly below its source), B12 (move
    reorders).* (F7) — largest item; do it after 10 and 11 so it lands on a
    queue that can express ordered writes.
13. **`CaretIntent`.** Replace `cursorPosition`/`focusSeq`/`focusX` with one
    consumable slot; add `mapOffset(step, offset)` for `updateText`, `split`,
    `merge`. *Test: any store write that is not a caret intent leaves the caret
    untouched (B4 generalised); an offset captured before a split survives the
    split.* (F4 class, C1–C4)
14. **`FocusRegistry`.** `activate` expands ancestors and refuses unreachable
    targets; a caret intent naming an unmounted instance warns in dev; if
    `activeNodeId` has no mounted host, fall back to selection mode.
    *Test: B1b — after any create, the new node is in `getVisibleNodes()` and
    exactly one `[contenteditable]` is mounted.* (F3)
15. **WS origin exclusion.** Server skips the originating client for its own
    action's tx (or tags origin and the client ignores its own echo); merge,
    don't clobber, when a remote upsert hits a node with pending local edits.
    *Test: a session test asserting the originator receives no tx for its own
    action.* (F8, O4)

**Phase 3 — consolidation**

16. **One `NodeTextHost`.** Extract from `NodeContent`; port
    `ZoomedRootHeader.EditableTitle` and the table/board name cells onto it;
    delete the duplicate caret/serialization code. *Test: the page title
    supports `Shift+Enter`, keeps its text through a concurrent WS text change,
    and renders identical line counts active vs inactive.* (F10, H1–H4)
17. **Reconcile the specs.** r1-editor.md gains the forward-delete row and an
    explicit multiline-rendering rule; DESIGN-UI.md's transient-prune paragraph
    gains the remote-compensation requirement it currently implies but does not
    have. (Documentation follow-through for F13, F9, F12.)

---

## Sources

- [Logseq — Outliner Operations (DeepWiki)](https://deepwiki.com/logseq/logseq/3.4-outliner-operations)
- [Logseq — Block System and Editor (DeepWiki)](https://deepwiki.com/logseq/logseq/3.1-block-system-and-editor)
- [Logseq — Data Management / transactions (DeepWiki)](https://deepwiki.com/logseq/logseq/3-data-management)
- [logseq/clj-fractional-indexing](https://github.com/logseq/clj-fractional-indexing)
- [Logseq — Blocks and Pages (Shift+Enter as the in-block line break)](https://chrislasar.github.io/logseq-doc/docs/explanation/blocks-and-pages/)
- [Logseq issue #6204 — block refs show only the first line](https://github.com/logseq/logseq/issues/6204)
- [ProseMirror Guide — state, transactions, steps, position mapping](https://prosemirror.net/docs/guide/)
- [Tana Ideas — "Line breaks inside a node" (unsupported; 200 votes)](https://ideas.tana.inc/posts/26-line-breaks-inside-a-node)
- [Tana — Nodes and references](https://outliner.tana.inc/docs/nodes-and-references)
