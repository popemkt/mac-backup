# Research Report r1 — Outline Editor: Defect Audit & Tana-Grade Interaction Spec

**Worker ID:** omp (r1-editor)  
**Date:** 2026-08-23  
**Status:** Completed (Research & Specification Only — No implementation, no commits)  
**Target Consumer:** Wave I1 Implementation Worker (`i1-editor`)

---

## 1. Executive Summary & Governing Invariants

The `kb` outline editor provides client-side DataScript reactivity and a clean functional structure. However, in comparison to reference systems (Tana, Logseq, Roam, and `apps/nxus-editor`), its interaction layer suffers from geometric misalignments, focus drops, broken keyboard navigation on multiline/selection states, and brittle DOM-to-mutation mappings.

### The Governing Principle: The One-Row Metric Invariant (Structural Geometry Invariance)

> **The One-Row Metric Invariant:**  
> *Every outline row — whether active, inactive, placeholder/transient, or projected reference — MUST be rendered through the exact same `<NodeRow>` container using the single authoritative token source. No row variant, component wrapper, or active editing state may introduce its own horizontal padding, margins, or font overrides. Text content across all states must align to the exact same x-coordinate: `(depth × 24px) + 24px (bullet) + 4px (content-padding)`.*

### Key Architectural Resolutions

1. **Ghost Bullets & Ghost Rows Verdict:**  
   **Permanent ghost bullet rows at the bottom of every expanded subtree MUST BE REMOVED.**  
   Tana does not render persistent phantom bullet placeholders under every node. Instead, child creation is seamless:
   - Pressing `Enter` at the end of an expanded parent node creates the first child directly.
   - Pressing `Enter` at the end of a child node creates a sibling.
   - Clicking the empty whitespace below a parent's children or inside an empty expanded container focuses a real, transient empty node.
   - If an empty node loses focus without content, it is automatically pruned from the document state.
   - This eliminates asynchronous buffering races, IME destruction, caret jumping, and layout clutter.

2. **Caret & Multiline Navigation Overhaul:**  
   Navigation via `ArrowUp` / `ArrowDown` must check visual line boundary / caret line coordinates rather than naive character offsets `cursor === 0` or `cursor === text.length`.

3. **Collapse-Safe Mutations:**  
   Indenting a node into a collapsed preceding sibling MUST automatically expand the parent so the indented node remains visible and retains focus.

---

## 2. Reproduced Defect Audit

A complete audit was conducted against the live application booted on `http://127.0.0.1:4321`. Below is the complete table of reproduced defects, accompanied by root cause hypotheses with exact `file:line` locations, severities, and fix classifications.

### 2.1 Summary Defect Table

| ID | Defect Summary | Severity | Fix Class | File : Line Anchor |
|---|---|---|---|---|
| **D01** | Ghost row text indented +4px horizontally relative to normal rows | Medium | Local Fix | `ui/src/components/outline/ghost-node-row.tsx:175` |
| **D02** | Ghost row typography uses hardcoded font size (14.5px/23.2px vs 16px/24px) | Medium | Local Fix | `ui/src/components/outline/ghost-node-row.tsx:176` |
| **D03** | Ghost bullet bypasses `Bullet` token component with detached `span` | Low | Local Fix | `ui/src/components/outline/ghost-node-row.tsx:156-164` |
| **D04** | Ghost row destroys IME composition & fast typing drops non-char keys | High | Abstraction Replacement | `ui/src/components/outline/ghost-node-row.tsx:59-119` |
| **D05** | Indenting under collapsed sibling hides node & drops focus to `body` | **Critical** | Store / Plan Contract | `ui/src/actions/plan.ts:165-205`, `mutations.ts:282` |
| **D06** | Selection offset in `useNodeKeyDown` uses naive `focusOffset` | High | Local Fix | `ui/src/components/outline/use-node-keydown.ts:34-35` |
| **D07** | Splitting expanded parent inserts sibling at bottom of subtree | High | Abstraction Fix | `ui/src/actions/plan.ts:42-102` (`planSplit`) |
| **D08** | Merging first child into parent (`idx === 0`) or merging root is swallowed | High | Abstraction Fix | `ui/src/actions/plan.ts:120-163`, `use-node-keydown.ts:84` |
| **D09** | Merging previous sibling bypasses expanded grandchildren in visual tree | Medium | Abstraction Fix | `ui/src/actions/plan.ts:120-163` (`planMergeWithPrevious`) |
| **D10** | Multiline vertical arrow navigation blocked unless cursor at text extremities | High | Abstraction Replacement | `ui/src/components/outline/use-node-keydown.ts:112,146` |
| **D11** | Cross-row vertical arrow navigation resets horizontal column position | Medium | UX / Spec Completion | `ui/src/components/outline/use-node-keydown.ts:120,150` |
| **D12** | Selection mode lacks core outliner keys (Tab, Shift-Tab, Cmd-arrows, typing) | High | Spec Completion | `ui/src/lib/selection-keymap.ts:45-89` |
| **D13** | Zoomed page root title (`<h1>`) is completely read-only and uneditable | High | Spec Completion | `ui/src/components/outline/zoomed-root-header.tsx:36-44` |
| **D14** | `Escape` in Ref Autocomplete fails to dismiss popup, entering selection mode | Medium | Local Fix | `ui/src/components/outline/node-content.tsx:187-214` |
| **D15** | Ref Autocomplete with 0 matching candidates splits node on `Enter` | Medium | Local Fix | `ui/src/components/outline/node-content.tsx:187-205` |
| **D16** | Raw 26-char ULID exposed in contentEditable while active (`[[id\|label]]`) | High | Abstraction Verdict | `ui/src/components/outline/node-content.tsx:105-125` |
| **D17** | `EditableText` in field values embeds literal text `"Empty"` | High | Local Fix | `ui/src/components/outline/field-value.tsx:206` |
| **D18** | In-flow remove button in `FieldRow` shifts value column by 24px | Medium | Local Fix | `ui/src/components/outline/field-row.tsx:141-158` |
| **D19** | Destructive deletions and merges have zero undo/redo recovery | High | Architecture Gap | `ui/src/stores/outline.store.ts`, `mutations.ts` |
| **D20** | System node (`sys.*`) edit protection triggers after mutation instead of readonly | Low | Local Fix | `ui/src/components/outline/node-content.tsx:245` |

---

### 2.2 Detailed Defect Breakdown & Root Cause Analysis

#### Defect D01: Ghost row text horizontal misalignment
- **Observed Behavior:** The text in a ghost row starts at horizontal position `x = 464.5px`, whereas the text in the normal rows above it starts at `x = 460.5px`. When a ghost node is committed, the text visibly jumps 4px to the left.
- **Root Cause:** `NodeRow` (`node-row.tsx:48`) applies `.node-content { padding-left: 4px; }` (`px-1`). `NodeContent` for normal rows does not add horizontal padding. In contrast, `GhostNodeRow` (`ghost-node-row.tsx:175`) adds an inner `px-1` on `.ghost-row`, resulting in double padding (8px total).
- **Fix:** Remove `px-1` from `.ghost-row` in `ghost-node-row.tsx`.

#### Defect D02: Ghost row typography & line-height mismatch
- **Observed Behavior:** Ghost row text has `fontSize: 14.5px` and `lineHeight: 23.2px`, whereas normal rows evaluate to `fontSize: 16px` and `lineHeight: 24px` under the `Outfit Variable` font stack via `.kb-text`. This creates a baseline jump on commit.
- **Root Cause:** `ghost-node-row.tsx:176` hardcodes Tailwind classes `text-[14.5px] leading-[1.6]` instead of applying `KB_TEXT_CLASS` (`kb-text`).
- **Fix:** Replace hardcoded text classes with `KB_TEXT_CLASS`.

#### Defect D03: Ghost bullet bypasses token system
- **Observed Behavior:** The ghost bullet is a raw `<span>` element with `cursor-text` and an ad-hoc 4px gray dot. It does not respond to hover states, theme shifts, or tokenized bullet dimensions.
- **Root Cause:** `ghost-node-row.tsx:156-164` manually renders a custom `span` instead of invoking the shared `Bullet` component or a dedicated ghost variant.
- **Fix:** Adopt the shared `Bullet` component or unified node row token renderer.

#### Defect D04: Ghost row IME composition destruction & input race condition
- **Observed Behavior:** Typing with an IME (e.g. Japanese, Chinese, Vietnamese Telex) into a ghost row fails because the composition is immediately aborted. Typing quickly results in dropped control characters (Backspace, Enter) while characters are buffered in `pendingCharsRef`.
- **Root Cause:** `ghost-node-row.tsx:110-119` intercepts `beforeinput` with `e.preventDefault()`, which terminates the native browser IME composition session. The asynchronous call `createGhostNode` blocks subsequent keys behind `creatingRef.current`, dropping any non-character keys.
- **Fix:** Replace detached ghost rows with inline transient real nodes created synchronously on `Enter`/click.

#### Defect D05: Indenting under a collapsed sibling hides node & drops focus to `body`
- **Observed Behavior:** When focusing a node below a collapsed sibling and pressing `Tab`, the node is reparented into the collapsed sibling. Because the parent is collapsed, the child unmounts from the DOM immediately, leaving focus stranded on `document.body`.
- **Root Cause:** `planIndent` (`plan.ts:165-205`) and `mutations.indentNode` reparent the node under `prevId` without setting `prev.collapsed = false`.
- **Fix:** `planIndent` (or the mutation executor) MUST verify if the target parent node is collapsed, and if so, emit an upsert / state change to expand the parent (`collapsed: false`).

#### Defect D06: Selection offset calculation in `useNodeKeyDown`
- **Observed Behavior:** Pressing `Enter` to split a node with a highlighted selection range splits at `sel.focusOffset` without deleting the selected range. If `focusNode` is a child element, `focusOffset` is miscalculated.
- **Root Cause:** `use-node-keydown.ts:34-35` reads `window.getSelection()?.focusOffset`, which represents the offset inside `focusNode` (or child node index), not the character index in `node.text`.
- **Fix:** Implement a robust `getCaretCharacterOffsetWithin(element)` helper that traverses DOM text nodes and handles non-collapsed selection ranges.

#### Defect D07: Splitting an expanded parent node
- **Observed Behavior:** If Node A has 3 children and is expanded, placing the cursor at the end of Node A and pressing `Enter` inserts a new sibling *after* all 3 children, moving the cursor far down the page.
- **Root Cause:** `planSplit` (`plan.ts:42-102`) always inserts `newId` at `parent.children.indexOf(id) + 1` in the parent's child array, ignoring whether Node A is expanded and has children.
- **Fix:** In Tana/Logseq semantics, pressing Enter at the end of an expanded parent with children MUST insert the new node as the *first child* of Node A.

#### Defect D08: Merging first child into parent (`idx === 0`)
- **Observed Behavior:** Placing the caret at index 0 of the first child of a parent and pressing `Backspace` does nothing. The key is swallowed and the user is stuck.
- **Root Cause:** `planMergeWithPrevious` (`plan.ts:120-163`) explicitly checks `if (idx <= 0) return null;`. When `null` is returned, `useNodeKeyDown` calls `e.preventDefault()`, trapping the caret.
- **Fix:** When `idx === 0` and `cursor === 0`, `Backspace` on an empty node should delete and focus parent; on a non-empty node, it should outdent the node or merge its text into the parent.

#### Defect D09: Merging with previous sibling skips expanded descendants
- **Observed Behavior:** When a node presses `Backspace` at index 0 and the preceding sibling has expanded children, the node merges into the preceding sibling rather than into the visually preceding grandchild directly above it.
- **Root Cause:** `planMergeWithPrevious` operates strictly on `parent.children[idx - 1]`, ignoring the visual tree structure.
- **Fix:** Resolve the merge target using `getPreviousVisibleInstance(instanceKey)`.

#### Defect D10: Multiline vertical arrow navigation blocked
- **Observed Behavior:** In a wrapped multiline node, pressing `ArrowUp` on the top visual line does not move to the previous node unless the caret is at index 0. Pressing `ArrowDown` on the bottom line does not move to the next node unless the caret is at the exact end of the text.
- **Root Cause:** `use-node-keydown.ts:112,146` hardcodes `cursor === 0` and `cursor === text.length`.
- **Fix:** Check caret line bounds using `getSelection().getRangeAt(0).getClientRects()` to detect whether the caret is on the first or last rendered line of the contentEditable element.

#### Defect D11: Vertical arrow navigation resets horizontal column position
- **Observed Behavior:** Navigating `ArrowDown` between nodes always jumps to column 0; navigating `ArrowUp` always jumps to the end of the text.
- **Root Cause:** `use-node-keydown.ts:120,150` passes `0` or `prevNode.text.length` to `activateNode`.
- **Fix:** Preserve caret visual x-coordinate (`rect.left`) across vertical navigation when moving between rows.

#### Defect D12: Selection mode lacks core outliner keys
- **Observed Behavior:** When a node row is selected (blue background, not editing), pressing `Tab` or `Shift+Tab` does nothing. Pressing `Cmd+Shift+Up/Down` does not move the row. Pressing printable keys does not start editing.
- **Root Cause:** `selection-keymap.ts` only implements `ArrowUp/Down`, `Enter`, `Space`, `o`, `Backspace/Delete`, `Escape`.
- **Fix:** Implement full selection keymap matching Tana specifications (Tab/Shift-Tab, Cmd-Up/Down, printable char activation, ArrowLeft/Right).

#### Defect D13: Zoomed page root title is completely read-only
- **Observed Behavior:** Zooming into a node displays its title in `ZoomedRootHeader` as a static `<h1>` tag. The user cannot edit the node's name without zooming out.
- **Root Cause:** `zoomed-root-header.tsx:36-44` renders a non-editable `<h1>` element.
- **Fix:** Render the zoomed root title with an editable `NodeContent` component configured for header typography (`text-[20px] font-semibold leading-[1.4]`).

#### Defect D14: `Escape` key in Ref Autocomplete
- **Observed Behavior:** Typing `[[` opens the autocomplete popover. Pressing `Escape` does not dismiss the popover; instead, it deactivates the node editor and switches the row into selection mode with broken `[[` text.
- **Root Cause:** `node-content.tsx:187-214` derives `refOpen` purely from `content` and `cursor`. When `Escape` is pressed, it falls through to `use-node-keydown.ts:127`, which calls `selectNode()`.
- **Fix:** Add a local `dismissed` state to `NodeContent` to dismiss the autocomplete popover on `Escape` without blurring the editor.

#### Defect D15: Ref Autocomplete with zero candidates splits node on `Enter`
- **Observed Behavior:** Typing `[[nonexistent` (where no nodes match) and pressing `Enter` splits the node in half inside the `[[` tag.
- **Root Cause:** `node-content.tsx:187` checks `candidates.length > 0`. When false, `Enter` falls through to `onKeyDown`, which executes `mutations.splitNode`.
- **Fix:** Intercept `Enter` when `refOpen` is active regardless of candidate count, providing an option to "Create new node" or complete the bracket.

#### Defect D16: Raw 26-character ULID exposed in active editor
- **Observed Behavior:** When a reference is inserted, the contentEditable displays `[[01KZ...|Label]]`. Arrowing through text requires navigating across all 26 characters of the ULID. Editing or deleting any character inside the ULID corrupts the reference.
- **Root Cause:** `node-content.tsx` operates on raw plain text in contentEditable mode, leaving wiki-link serialization exposed to the caret.
- **Fix:** Wrap references in atomic inline decorators (e.g. `<span contentEditable="false" class="kb-md-ref">Label</span>`) inside the active editor, serializing back to `[[id|label]]` on mutation.

#### Defect D17: Literal text `"Empty"` in field value editor
- **Observed Behavior:** Clicking an empty field value to edit places the caret after the word `"Empty"`, causing the user to type `"EmptyMyValue"`.
- **Root Cause:** `field-value.tsx:206` renders `{showEmpty ? "Empty" : text}` as child DOM text inside a contentEditable container.
- **Fix:** Use CSS `:empty::before { content: "Empty"; }` placeholder styling (matching `tokens.css:238`) so the DOM text remains empty.

#### Defect D18: In-flow remove button in `FieldRow` causes column misalignment
- **Observed Behavior:** In a list of fields, fields with an `onRemove` handler have their value column shifted 24px to the right compared to fields without an `onRemove` handler.
- **Root Cause:** `field-row.tsx:141-158` inserts the `<button onRemove>` in flex flow between the label and the value `{children}`.
- **Fix:** Place the remove button in a trailing slot at the right edge of the `FieldRow`, or use an absolute overlay on row hover.

#### Defect D19: Destructive deletions and merges have zero undo/redo recovery
- **Observed Behavior:** Pressing `Cmd+Backspace` or merging nodes permanently deletes subtrees with no `Cmd+Z` recovery mechanism.
- **Root Cause:** The outline store lacks an in-memory undo/redo transaction stack.
- **Fix:** Introduce an action-level undo stack in `useOutlineStore` capturing planned mutation inverse transactions.

#### Defect D20: System node write protection timing
- **Observed Behavior:** Clicking a `sys.*` node allows the caret to focus and text to be typed; only upon debounce flush or mutation dispatch does a toast error appear.
- **Root Cause:** `node-content.tsx` does not inspect `isSysPrefixed(nodeId)` to set `contentEditable="false"` or `aria-readonly="true"` upfront.
- **Fix:** Make `sys.*` nodes non-editable at the DOM level and display a padlock indicator on hover.

---

## 3. Tana-Grade Interaction Specification

This section sets normative **MUST** statements that the implementation wave (`i1-editor`) will build and verify against.

### 3.1 Focus & Activation Model

```
       ┌────────────────────────────────────────────────────────┐
       │                 INACTIVE / BLURRED                    │
       │  - Rendered Markdown (MdView)                          │
       │  - Click anywhere on text → ACTIVE (caret at click)    │
       │  - Click bullet → TOGGLE COLLAPSE                      │
       │  - Cmd+Click bullet → ZOOM TO NODE                     │
       └──────────────┬────────────────────────▲────────────────┘
                      │ click / arrow          │ blur / click outside
                      ▼                        │
       ┌───────────────────────────────┐       │
       │    ACTIVE (CARET EDITING)     │       │
       │  - contentEditable = true     │       │
       │  - Caret visible              │       │
       │  - Escape ──► SELECTED MODE   │───────┤
       └──────────────┬────────────────┘       │
                      │ Escape                 │
                      ▼                        │
       ┌───────────────────────────────┐       │
       │   SELECTED (NAVIGATION MODE)  │       │
       │  - Row background: primary/5  │       │
       │  - Enter / Typing ──► ACTIVE  │       │
       │  - Escape / Click outside ────┴───────┘
```

1. **State Exclusivity:** At any given time, the outline MUST exist in exactly one of three states:
   - `Inactive`: No row has active caret or navigation selection.
   - `Selected (Navigation Mode)`: Exactly one `instanceKey` is selected (`selectedNodeId` & `selectedInstanceKey` set, `activeNodeId` is `null`).
   - `Active (Caret Editing)`: Exactly one `instanceKey` has an active contentEditable element focused (`activeNodeId` & `activeInstanceKey` set).
2. **Focus Hand-off on Mutation:**
   - **Split (`Enter`):** Focus MUST transfer immediately to the newly created node at caret offset 0.
   - **Indent (`Tab`):** Focus MUST remain on the active node at the exact caret character offset. If the preceding sibling was collapsed, it MUST automatically expand.
   - **Outdent (`Shift+Tab`):** Focus MUST remain on the active node at the exact caret character offset.
   - **Merge (`Backspace` at 0):** Focus MUST transfer to the merge target node at the exact character join boundary (`joinAt = prevText.length`).
   - **Delete (`Cmd+Backspace`):** Focus MUST transfer to the previous visible instance at text end; if none exists, to the next visible instance.

---

### 3.2 Authoritative Keymap Specification

#### Mode A: Active Edit Mode (Caret Inside Node Text)

| Key | Context / Condition | Action / Invariant |
|---|---|---|
| `Enter` | Autocomplete Open | Select highlighted candidate and insert reference token. |
| `Enter` | Caret at end of expanded parent with kids | MUST create new first child of current node (`depth + 1`) at position 0. |
| `Enter` | Caret anywhere else | MUST split node at caret into two nodes; move caret to second node at index 0. |
| `Shift+Enter` | Any | MUST insert a soft line break (`\n`) within the current node without splitting. |
| `Tab` | Autocomplete Open | Select highlighted candidate. |
| `Tab` | Edit Mode | MUST indent node under previous sibling. If sibling is collapsed, auto-expand it. |
| `Shift+Tab` | Edit Mode | MUST outdent node to become sibling of its parent. |
| `Backspace` | Caret at index 0, node is empty & leaf | MUST delete current node and focus previous visible node at text end. |
| `Backspace` | Caret at index 0, node is first child (`idx=0`) | MUST outdent node or merge into parent; MUST NOT swallow key. |
| `Backspace` | Caret at index 0, node has content | MUST merge node into previous visible node at join offset. |
| `Cmd+Backspace` | Any | MUST delete node and its subtree; focus previous visible node. |
| `ArrowUp` | Caret on first visual line | MUST move caret to previous visible node, preserving visual x-coordinate. |
| `ArrowDown` | Caret on last visual line | MUST move caret to next visible node, preserving visual x-coordinate. |
| `Cmd+ArrowUp` | Any | MUST collapse current node if expanded; otherwise jump to zoomed root. |
| `Cmd+ArrowDown` | Any | MUST expand current node if collapsed. |
| `Cmd+Shift+ArrowUp` | Any | MUST move node up among siblings (reorder). |
| `Cmd+Shift+ArrowDown` | Any | MUST move node down among siblings (reorder). |
| `Escape` | Autocomplete Open | MUST dismiss autocomplete popover without blurring editor or leaving edit mode. |
| `Escape` | Edit Mode (no popup) | MUST exit edit mode and transition row to Selected (Navigation) Mode. |
| `[[` | Edit Mode | MUST open Ref Autocomplete popover. |
| `#` | Caret at word boundary | MUST open Tag Autocomplete popover. |
| `/` | Caret at start of empty line | MUST open Node Command palette. |

#### Mode B: Selection Mode (Node Row Selected, Caret Inactive)

| Key | Action / Invariant |
|---|---|
| `ArrowUp` | Select previous visible instance. |
| `ArrowDown` | Select next visible instance. |
| `ArrowLeft` | If node is expanded, collapse it. If node is collapsed or leaf, select its parent. |
| `ArrowRight` | If node is collapsed, expand it. If node is expanded, select its first child. |
| `Enter` | Activate node into Edit Mode (caret at index 0 or text end). |
| `Space` | Toggle node collapse/expand state. |
| `Tab` | Indent selected node (and its subtree). Auto-expand target parent if collapsed. |
| `Shift+Tab` | Outdent selected node (and its subtree). |
| `o` | Create a new node directly below selected node and activate it. |
| `O` (Shift+o) | Create a new node directly above selected node and activate it. |
| `Backspace` / `Delete` | Delete selected node (and its subtree); select nearest neighbor. |
| `Cmd+Shift+ArrowUp` | Move selected node up in sibling order. |
| `Cmd+Shift+ArrowDown` | Move selected node down in sibling order. |
| `Cmd+.` | Zoom into selected node. |
| `Escape` | Deselect row (return to Inactive state). |
| *Printable Character* | Activate node in Edit Mode and replace text or append character. |

---

### 3.3 Ghost Row Semantics & The Affordance Verdict

#### Explicit Resolution on Ghost Rows
1. **Should ghost bullets exist?**  
   **NO.** Permanent phantom bullet rows clutter the interface, create layout noise, and cause severe input synchronization bugs.
2. **Tana's Solution:**  
   In Tana, an outline never shows an artificial empty bullet at the bottom of every list. Instead:
   - When a user presses `Enter` on a node, a new real node is created instantly in memory.
   - If the user clicks the indentation space beneath an expanded parent, a transient new child node is minted immediately with active focus.
   - If a newly minted node is blurred while its text is empty and it has no children or fields, it is silently pruned from the DataScript graph.
3. **Interim Alignment Rule (if ghost rows are rendered during transition):**  
   The ghost row MUST be rendered strictly via `<NodeRow>`:
   ```tsx
   <NodeRow
     depth={depth}
     bullet={<Bullet node={EMPTY_NODE} ghost isRef={false} onClick={focusGhost} />}
     content={
       <div
         className={cn(KB_TEXT_CLASS, "min-h-6 min-w-0 flex-1 outline-none text-foreground/85")}
         contentEditable
         data-ghost-row="true"
       />
     }
   />
   ```
   **Geometry Constraint:** `.ghost-row` MUST NOT declare `px-1` or hardcoded font styling. It must inherit `node-content`'s single `px-1` container padding and `.kb-text`.

---

### 3.4 Alignment & Geometry Metrics Specification

All outline components MUST derive layout strictly from CSS custom properties in `tokens.css`:

$$\text{Row Indent} = \text{depth} \times 24\text{px}$$
$$\text{Bullet Slot} = 24\text{px} \times 24\text{px}$$
$$\text{Content Left Margin} = (\text{depth} \times 24\text{px}) + 24\text{px} + 4\text{px} = \text{depth} \times 24\text{px} + 28\text{px}$$
$$\text{Row Minimum Height} = 24\text{px}$$
$$\text{Typography Token} = 14.5\text{px} / 1.6\text{ line-height (resolving to } 24\text{px rhythm)}$$
$$\text{Field Label Column Width} = 120\text{px fixed}$$

```
 0px          24px         48px (depth 1)
 ┌────────────┬────────────┬──────────────────────────────────────────────────────────┐
 │ Bullet 24px│ px-1 (4px) │ Text Content (font: 14.5px/1.6, line-height 24px)        │
 ├────────────┼────────────┴──────────────────────────────────────────────────────────┤
 │ Guide Line │   24px Slot │ 120px Label │ px-1 │ Value Editor (borderless in-flow)  │
 └────────────┴─────────────┴─────────────┴──────┴────────────────────────────────────┘
```

#### FieldRow Alignment Invariant:
- `FieldRow` padding-left MUST equal `(depth + 1) * 24px`.
- The Type Icon slot MUST be `24px × 24px` centered.
- The Field Label MUST be fixed `120px`, truncated.
- The Field Value MUST start at exactly `(depth + 1) * 24px + 24px + 120px + 4px`.
- Action buttons (`onRemove`, configure) MUST be placed at the trailing right edge of the row, never between label and value.

---

### 3.5 What Tana Does Differently and Why

| Interaction Area | `kb` Current Implementation | Tana Paradigm | Rationale for Tana Approach |
|---|---|---|---|
| **Empty Child Creation** | Detached `<GhostNodeRow>` DOM element at bottom of every list. | Real transient node on `Enter`/click; auto-pruned on empty blur. | Eliminates typing race conditions, IME failure, and visual clutter. |
| **Parent Node Splitting** | Always inserts sibling at bottom of parent's children array. | Expands parent and creates first child at index 0. | Keeps new row visually adjacent to caret. |
| **Backspace at Index 0** | Merges with preceding sibling in array, skipping grandchildren. | Merges with visually preceding node (`getPreviousVisibleInstance`). | Follows what user sees on screen. |
| **Indenting into Collapsed Node** | Moves node into collapsed parent; node disappears; focus lost to `body`. | Automatically expands parent node upon indent. | Invariant: Caret and active node must never vanish from viewport. |
| **Zoomed Header Title** | Static, read-only `<h1>` text. | Fully editable `NodeContent` header. | Everything is a node; title of page is editable in place. |
| **Reference Editing** | Exposes raw `[[01KZ...\|label]]` string in active contentEditable. | Atomic inline pill decorator (`contentEditable=false`). | Prevents accidental corruption of 26-char ULID tokens. |
| **Field Value Empty State** | Literal text `"Empty"` in contentEditable DOM. | CSS `:empty::before` pseudo-element placeholder. | Typing into empty field immediately captures user input cleanly. |

---

## 4. Subsystem Abstraction Verdicts

### 4.1 Subsystem Evaluation Matrix

| Subsystem | Current State | Verdict | Technical Justification |
|---|---|---|---|
| **`OutlineStore` (Zustand)** | Solid reactive DataScript synchronization, instance keys, and visible-node traversal. | **KEEP & ENHANCE** | Architecture is sound. Needs auto-expand on indent and an in-memory undo/redo transaction stack. |
| **`Plan / Mutation Layer` (`plan.ts`)** | Pure functional planners mapping UI intent to wire transactions. | **REFACTOR** | `planSplit` and `planMergeWithPrevious` make naive array-index assumptions that break on expanded/collapsed hierarchies. |
| **`GhostNodeRow`** | Detached DOM component with async buffering and `beforeinput` prevention. | **REPLACE** | Fundamentally flawed lifecycle. Replace with transient real node creation and auto-pruning. |
| **`useNodeKeyDown`** | Monolithic `if/else` callback with flawed DOM selection math. | **REFACTOR** | Extract line-boundary detection helper, robust DOM character offset reader, and declarative keymap lookup. |
| **`selection-keymap.ts`** | Minimal window key listener. | **EXPAND** | Complete missing outliner key handlers (`Tab`, `Shift+Tab`, `Cmd+Shift+Up/Down`, printable keys). |
| **`NodeContent` (contentEditable)** | Text swap (`MdView` ↔ contentEditable). | **KEEP (v1) / ENHANCE** | Plain-text swap matches Logseq and is lightweight. Enhance with atomic non-editable pills for references (`[[...]]`). |
| **`FieldRow` & `FieldValue`** | Inline editors with misplaced remove button and literal `"Empty"` text. | **LOCAL FIX** | Fix CSS `:empty::before` placeholder and move remove button to trailing slot. |

---

## 5. Suggested Automated Test Plan

The implementation worker (`i1-editor`) should create or update automated tests covering all 20 defect areas.

### 5.1 Unit Tests (`tools/kb/ui/src/actions/plan.test.ts`)
- `planSplit`: Splitting an expanded parent node with children inserts child at index 0 of the node itself.
- `planSplit`: Splitting a collapsed parent inserts sibling after parent.
- `planIndent`: Indenting under a collapsed sibling sets `collapsed: false` on the target parent.
- `planMergeWithPrevious`: Merging first child (`idx=0`) outdents or merges into parent without returning `null`.
- `planMergeWithPrevious`: Merging into a sibling with expanded descendants targets the deepest last descendant.

### Reconciliation addendum — forward delete and multiline text

- **Forward merge (`Delete` at text end):** merge the next visible row into the
  active row and retain the caret at the text join boundary. It is the forward
  counterpart to `Backspace` at offset 0.
- **Multiline rendering:** active and inactive node text preserve hard line
  breaks with identical wrapping and line count. Only explicit clamp contexts
  (references, schema, table/board summaries, breadcrumbs) may ellipsize to a
  single line.

### 5.2 Component & Geometry Tests (`tools/kb/ui/src/components/outline/geometry.test.tsx`)
- **Metric Invariant Test:** Render `<NodeRow>` in inactive, active, and transient states; assert computed `paddingLeft`, `fontSize`, and `lineHeight` are identical down to subpixels.
- **Field Value Placeholder Test:** Render `<EditableText empty={true} text="" />`; assert DOM `textContent` is empty string `""` and CSS `empty-placeholder` is active.
- **Field Row Alignment Test:** Assert field value starting x-offset is identical whether `onRemove` is passed or undefined.

### 5.3 End-to-End Behavioral Scenarios (Vitest / Playwright)
1. **Collapsed Indent Scenario (Defect D05):**
   - Create Parent A (collapsed, with Child A1) and Node B.
   - Focus Node B and press `Tab`.
   - Verify Node B remains visible, Parent A expands, and active element remains Node B's editor.
2. **First Child Backspace Scenario (Defect D08):**
   - Focus Child 1 of Parent at cursor 0.
   - Press `Backspace`.
   - Verify node is outdented or merged, and caret is preserved without swallowing keystroke.
3. **Wrapped Multiline Navigation Scenario (Defect D10):**
   - Create a long multiline node. Place caret in middle of top line.
   - Press `ArrowUp`.
   - Verify focus moves to the previous node without requiring caret to be at index 0.
4. **Autocomplete Dismissal Scenario (Defect D14):**
   - Type `[[` in active node.
   - Press `Escape`.
   - Verify autocomplete dropdown closes, editor remains active and focused, and row does not switch to selection mode.

---

## 6. Handoff Notes for Implementation Wave (`i1-editor`)

1. **Do not create new token variables:** Use `--kb-indent`, `--kb-row-h`, `--kb-text`, `--kb-chip`, and `--kb-field-label` from `tokens.css`.
2. **Adhere to the single component rule:** Exactly one `<NodeRow>`, `<TagChip>`, and `<FieldRow>` imported across all views.
3. **Verification Command:** Run `bun test` and `npm run check` in `tools/kb` before submitting the implementation diff.
