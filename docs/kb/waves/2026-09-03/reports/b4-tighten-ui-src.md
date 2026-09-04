# b4-tighten-ui-src — report

Burning the `@kb/ui` `src` ledger to zero under the owner decisions in the
brief's §0. Harness: claude (opus), worktree `b4-tighten-ui-src`, branch
`feature/b4-tighten-ui-src` on `kb-wave/2026-09-03` (`5a052f7`, the `c1`
lint-policy commit). 6 commits plus this report; `bun run verify` green before
each.

Scope was `tools/kb/packages/ui/src/**` excluding `*.test.ts(x)` and `tests/`.
One test was edited, because a `src` deletion forced it (§4.6).

---

## 1. Headline

| | before (`5a052f7`) | after |
|---|---|---|
| oxlint findings in `@kb/ui` **src** | 444 | **48** |
| oxlint findings in `@kb/ui` src, excluding the size sensors kept by policy | 405 | **9** |
| ratchet ledger, blocking lane (workspace) | 906 | **512** |
| ratchet ledger, advisory lane | 12 | **8** |
| blocking rules in the ledger | 21 | **19** |
| oxlint **errors**, workspace | 0 | **0** |
| rules that reached 0 workspace-wide | — | **2** (`eslint/max-depth`, `eslint/max-params`) |

`bun run verify` (typecheck → lint → fmt:check → knip → harness): green,
44/44 harness tests. `bun run test:ui`: **630/630**. `bun test packages`:
362/362.

## 2. Per-rule before/after (ui `src` only)

| Rule | before | after | how |
|---|---|---|---|
| `typescript/strict-boolean-expressions` | 195 | **0** | §4.4 |
| `typescript/no-non-null-assertion` | 91 | **0** | §4.5 |
| `typescript/no-unsafe-type-assertion` | 78 | **4** | §4.1–§4.3, leftovers in §5a |
| `typescript/no-unnecessary-condition` | 23 | **0** | §4.6 |
| `eslint/max-depth` | 2 | **0** | §4.6 |
| `eslint/max-params` | 2 | **0** | §4.6 |
| `typescript/no-deprecated` | 7 | **5** | §4.6, leftovers in §5b |
| `eslint/no-await-in-loop` | 4 | **0** | §4.6 — all four are sequential by contract |
| `unicorn/consistent-function-scoping` | 3 | **0** | §4.6 |
| `eslint/max-lines-per-function` | 37 | **37** | §5c — no split was forced |
| `eslint/max-lines` | 2 | **2** | §5c |

Workspace ledger movements (every rule whose count changed):

| Rule | ledger before | ledger after | ui src after | rest after |
|---|---|---|---|---|
| `typescript/strict-boolean-expressions` | 200 | **5** | 0 | 5 (ui tests) |
| `typescript/no-non-null-assertion` | 391 | **300** | 0 | 300 (ui tests) |
| `typescript/no-unsafe-type-assertion` | 127 | **53** | 4 | 49 (backend) |
| `typescript/no-unnecessary-condition` | 31 | **8** | 0 | 8 (7 ui tests, 1 backend) |
| `unicorn/consistent-function-scoping` | 15 | **12** | 0 | 12 |
| `eslint/no-await-in-loop` | 7 | **3** | 0 | 3 (backend) |
| `eslint/max-depth` | 2 | **—** | 0 | 0 |
| `eslint/max-params` | 2 | **—** | 0 | 0 |
| `typescript/no-deprecated` (advisory) | 12 | **8** | 5 | 3 |

`tools/kb/.oxlintrc.json` is untouched: promotion is the coordinator's move at
integration. Two rules are now promotable — **`eslint/max-depth` and
`eslint/max-params` read 0 across the whole workspace** and have dropped out of
the ledger entirely. Three more are one scope away: `strict-boolean-expressions`
(5 left, all in `@kb/ui` tests — `b5`), `no-unnecessary-condition` (7 in ui
tests, 1 in the backend) and `no-await-in-loop` (3, backend only — `b6`).

## 3. Helpers introduced

Each exists because the same shape recurred; none has a second copy.

| Path | Signature | Why one |
|---|---|---|
| `ui/src/lib/dom.ts` | `asInstance(v, Ctor)`, `asElement(t)`, `isElementNode(n)`, `isTextNode(n)`, `isOutside(container, target)`, `isTextEntry(target)` | 40 sites asserted `e.target as HTMLElement` / `node as Text`. One module decides what "this event happened on an element" means, and it checks rather than asserts. Node kinds are decided by `nodeType`, not `instanceof`: the component tests install a happy-dom `Window` onto `globalThis` one global at a time, so `Element` and `Text` are not constructors this code may name. |
| `ui/src/lib/text.ts` | `hasText(v): v is string`, `textOr(v, fallback)` | The brief's §0 display-text rule. 13 sites spelled `x \|\| "Untitled"` by hand and ~25 more asked `if (title)`. |
| `ui/src/lib/card-pointer.ts` | `classifyCardPointer(target, innerEditor): "chrome" \| "edit" \| "drag"` | Four canvas `onPointerDown` handlers repeated "a press on a port, a resize handle or the card's own editor is not a drag". The inner-editor selector is the only thing that differed, so it is the only parameter. |
| `ui/src/components/graph/force3d-instance.ts` | `FgNode`, `FgLink`, `KbForceGraph`, `linkEndId`, `createForceGraph(el)` | The `3d-force-graph` seam, and the only file importing the library. Naming its generics once deleted 14 per-callback assertions and typed `graphData()`. |
| `ui/src/components/graph/graph-attributes.ts` | `nodePosition(graph, node)` | graphology types node attributes as an open record; two renderers asserted `{ x, y }` at their drag sites. |
| `ui/src/components/graph/cluster-hull.ts` | `HULL_PAD`, `clusterHull(pts)`, `clusterHullPath(hull)` | Cluster hulls were computed twice and drawn two different ways. Also the home of 20 of the wave's non-null assertions. |
| `ui/src/components/ui/enum-select.tsx` | `EnumSelect<T extends string>`, `EnumOption<T>` | Five `<select>`s over a closed set asserted `e.target.value` into their own union. The option list is now the decoder. |
| `ui/src/components/canvas/canvas-page.tsx` | `snapOffset(pairs)` (module scope) | The card-snap loop asked the same question along two axes with a nested loop each. |
| `ui/src/lib/visible-instances.ts` | `WalkContext` | Six and seven parameters threading the same four values. |
| `ui/src/lib/convex-hull.ts` | `halfChain(pts)`, module-scope `cross` | `convexHull` built its lower and upper chains with the same fifteen lines. |

## 4. What shipped

### 4.1 `5abfa58` — check the DOM boundary instead of asserting it

`lib/dom.ts` plus the three duplicates that collapsed onto it: four
click-outside handlers, four canvas pointer handlers, and `caret.ts`'s
re-implementation of `md-edit`'s serialized-offset walk (now
`serializedOffsetOfBoundary`). `nearestOffsetForX` keeps its best match in a
holder object rather than a `let` a closure writes, which removed the
`as { offset: number }` that control-flow analysis had forced.

`no-unsafe-type-assertion` 78 → 38, `no-unnecessary-condition` 23 → 12 (the
seven `setPointerCapture?.()` sites stop being redundant once the value they
chain off is genuinely optional).

### 4.2 `8e9c785` — name the vendor and enum types once

The `3d-force-graph` seam, the graphology accessor and `EnumSelect`.
`no-unsafe-type-assertion` 38 → 17.

### 4.3 `16e67c1` — parse the boundaries the UI reads

`loadPrefs` parses localStorage with a zod schema whose fields fall back one at
a time; `getViewConfig` resolves the view mode through the mode list itself;
`queryBacklinks` decodes datalog rows; `propDatomValue` discriminates on
`isRef`; `optimistic.ts`'s two views of a `node.update` input became one
schema; `asset.upload`'s output is parsed before its path reaches markdown.
`NodeRow.onRowClick` takes a `SyntheticEvent` (keyboard activation was being
passed through `as unknown as React.MouseEvent`), `defaultMakeSocket` returns a
real port over `WebSocket`, and `invokeAction` — which had no caller — is
deleted. `no-unsafe-type-assertion` 17 → 4.

### 4.4 `48bb381` — say which nullish case a condition means

The 195 nullable-string truthiness tests. Ids are `!== undefined` (or
`!== null`, whichever the type admits); display text goes through `hasText` /
`textOr`. The non-string remainder is stated rather than coerced. Four
conditions guarding states their own types deny are gone.
`strict-boolean-expressions` 195 → **0**, `no-unnecessary-condition` 12 → 6.

### 4.5 `505b30d` — let the structure carry the invariant, not a `!`

91 non-null assertions → **0**, and almost none needed a narrowing helper:
index loops became `for … of` / `.entries()`, `has` + `get(k)!` became one
`get` and a guard, `match[1]!` became a guarded destructure, and
`arr[idx - 1]!` under an `idx > 0` guard reads the element and tests it.

Three duplicates fell out on the way, each of which was also the reason for a
cluster of assertions: `ds/db.ts` and `ds/query.ts` carried byte-identical
copies of `QUERY_DIRECTIVES`, `normalizeEdnQuery` and `reviveValue` plus two
datalog runners; `convexHull`'s two chains; and the two cluster-hull
implementations.

`present` from `@kb/model` is used at exactly two sites, both modulo indexes
into a constant palette (`tag-color.ts`, `run-command.ts`).

### 4.6 `1425e76` — drain the branching and shape sensors

`max-depth`, `max-params`, `consistent-function-scoping`,
`no-unnecessary-condition` and `no-await-in-loop` to 0; `no-deprecated` 7 → 5
by deleting `getPreviousVisibleNode` / `getNextVisibleNode`, which b3 §5e had
already established have no production caller. `stores/outline.store.test.ts`
is the one test this wave touched: it pinned the deleted pair and now pins the
instance-keyed replacements it was always meant to use.

All four `no-await-in-loop` sites are sequential by contract — ordered
compensating actions, ordered plan actions, store reads that follow store
writes — so each carries the reason and a single-line
`// oxlint-disable-next-line eslint/no-await-in-loop`, per the brief.

### 4.7 `DESIGN.md`

"Domain typing" gained one bullet: **an id is never the empty string**, and the
display-text counterpart that `lib/text.ts` owns. Track 2 brands `NodeId`; this
only states the fact the wave acted on.

## 5. What is left, and why

### a. `no-unsafe-type-assertion` — 4 in ui `src`

| Site | Why it stayed |
|---|---|
| `api/action.ts:42` — `json as ActionReceipt` | Needs `ActionReceiptSchema` in `@kb/contracts`, which is `b6`'s package. b3 §5c predicted exactly this: `ActionReceipt` is the one wire shape there declared as a bare TS union while its neighbours have zod schemas. A local mirror in `@kb/ui` would be the "two copies kept in sync by hand" Rule 1 forbids, so the schema belongs upstream. **This is the only thing standing between ui `src` and 0.** |
| `force3d-instance.ts:55` | The library publishes its constructor as a non-generic `const` and `Omit`s its instance type, so the generic instance is not assignable from the default one under `strictFunctionTypes` even though the runtime object is identical. The reason is written at the site; this one assertion is what deletes fourteen. |
| `force3d-graph.tsx:209` — `undefined as unknown as Object3D` | `nodeThreeObject`'s accessor is typed as returning `Object3D`, but the library reads a falsy return as "use the default sphere". Changing that means a `.d.ts` override or a real sprite for every unlabelled node. |
| `caret.ts:219` — `document as unknown as CaretDocument` | Tried and reverted: declaring the two vendor caret APIs as optional `Document` members merges with `lib.dom`, which marks `caretRangeFromPoint` deprecated and turns the unbound read into `typescript/unbound-method` — trading one assertion for two new findings and forcing the §5d behaviour decision. Reverted deliberately; see §5d. |

### b. `no-deprecated` — 5, all this repo's own markers

- `cursorPosition` (3: `canvas-card.tsx:40`, `:137`, `outline.store.ts:352`).
  The replacement is `CaretIntent` and the canvas card still reads the old
  field. Gap `01M1MGT307N4K243CBPJTXNG5X` already names the migration; it is a
  behaviour change on the canvas editor, outside §0.
- `LEGACY_COLLAPSED_STORAGE_KEY` / `LEGACY_EXPANDED_QUERIES_STORAGE_KEY` (2,
  `graph-view.ts:231-232`). No replacement exists — these are a one-way
  localStorage migration with no removal condition. Gap
  `01M1MGT2A6Y9ZVG5J1CGJMJ2AH`. Closing the rule means either removing the
  migration or dropping the `@deprecated` marker; both are owner calls.

### c. Size sensors — `max-lines-per-function` 37, `max-lines` 2

The brief said to lower these only where a hook or a sub-component falls out on
its own, and none did: every one of the 37 is a React component or an effect
body whose steps are sequential and named, which DESIGN's L2 rule calls good
code. The two `max-lines` files are `components/canvas/canvas-page.tsx` (1835)
and `actions/plan.ts` (1334).

The full list, largest first:

| Lines | Function |
|---|---|
| 1632 | `canvas-page.tsx:204` `CanvasPage` |
| 593 | `outline.store.ts:237` (the store factory) |
| 535 | `node-command-palette.tsx:69` `NodeCommandPalette` |
| 377 | `sigma-graph.tsx:59` `SigmaGraph` |
| 353 | `node-content.tsx:40` `NodeTextHost` |
| 334 | `force3d-graph.tsx:64` `Force3dGraph` |
| 317 | `cluster-graph.tsx:44` `ClusterGraph` |
| 315 | `tree-graph.tsx:62` `TreeGraph` |
| 308 | `graph-page.tsx:50` `GraphPage` |
| 299 | `force3d-graph.tsx:91` (the renderer effect) |
| 260 | `node-block.tsx:33` `NodeBlock` |
| 252, 239 | `canvas-page.tsx:310`, `:312` (the paste handler) |
| 247 | `cluster-graph.tsx:72`, `sigma-graph.tsx:159` (renderer effects) |
| 214 | `ontology-page.tsx:33` `OntologyPage` |
| 202, 193 | `use-node-keydown.ts:24`, `:30` |
| 196 | `canvas-page.tsx:721` (the drag handler) |
| 194 | `command-palette.tsx:22` `CommandPalette` |
| 188 | `field-value.tsx:421` `RefEditor`, `view-filter-popover.tsx:50` `ViewFilterPopoverHost` |
| 186 | `node-command-palette.tsx:137` |
| 182 | `table-view.tsx:43` `TableView` |
| 177 | `board-cards-view.tsx:36` `BoardCardsView` |
| 174 | `graph-toolbar.tsx:27` `GraphToolbar` |
| 173 | `canvas-page.tsx:1561` (the card renderer) |
| 164 | `edge-inspector.tsx:28` `EdgeInspector` |
| 155 | `sidebar.tsx:106` `Sidebar` |
| 152 | `bullet.tsx:36` `Bullet` |
| 149 | `cluster-graph.tsx` → `graph-settings.tsx:24` `GraphSettings`, `board-cards-view.tsx:214` `ViewCard` |
| 148 | `canvas-card.tsx:27` `KbNodeCard` |
| 137 | `run-command.ts:24` `runPaletteCommand` |
| 131 | `shape-card.tsx:81` `ShapeCard`, `ref-add-popover.tsx:29` `RefAddPopover` |
| 125 | `canvas-page.tsx:1366` (the edge renderer) |

### d. `caret.ts` still calls one vendor API unbound

b3 §5f found it and preserved it verbatim; this wave did the same, and the
comment at the site still says so. `caretRangeFromPoint` is read off `document`
and then called as a bare function, so `this` is `undefined` and Chrome throws
`Illegal invocation`, which `offsetFromPoint`'s `try/catch` swallows into the
`null` path. Fixing it is a one-word change and a real behaviour fix — outside
§0, and it is what keeps the assertion in §5a alive.

### e. `@kb/ui` tests still carry 312 findings

300 `no-non-null-assertion`, 7 `no-unnecessary-condition` and 5
`strict-boolean-expressions` live in `*.test.ts(x)`, which is `b5`'s scope and
was not touched. Three of the four rules this wave drained to 0 in `src` can
only promote once `b5` lands.

## 6. Behaviour changes

Everything else in the wave is behaviour-neutral. These are the exceptions,
each traced to the decision that allows it.

**Under §0 — "type assertions become checks or adapters":**

1. **`<select>`s over a closed set ignore an unexpected value** instead of
   passing it through as if it were a member (theme, font, width, filter kind,
   edge link mode). The `<option>` lists are fixed, so no reachable path
   changes.
2. **`loadPrefs` parses its payload per field.** Previously an unreadable
   `theme` fell back but a non-object payload took the whole-object fallback;
   now each field falls back on its own and a non-object payload still takes
   the whole-object fallback. Strictly more values survive a partially corrupt
   payload.
3. **`asset.upload` toasts when its receipt carries no `path`,** instead of
   writing `![alt](undefined)` into the node.
4. **`optimistic.ts` declines to apply an optimistic `node.update`** whose
   input does not parse, instead of reading fields off it blind.
5. **`queryBacklinks` drops a datalog row whose first two columns are not
   strings,** instead of forwarding it as if they were.

**Under §0 — "code paths are tight, not defensive":** seven checks against
states the types deny were deleted — `!r` on a `DOMRect` from `Array.from`,
`!files` on `DataTransfer.files`, `cam &&` on `cameraPosition()`'s result,
`textContent ?? ""` on an element, the inner `?.` on `scrollIntoView` and
`addEventListener`, and `link !== undefined` on a non-optional field. If the
DOM lies about any of these on a target kb supports, that path now throws
instead of silently doing nothing.

**Under Rule 1, and listed because §2 would not otherwise allow them:**

6. **`GraphToolbar`'s hotkey guard now also declines while focus is in a
   contenteditable.** It tested `tagName === "INPUT" || "TEXTAREA"`;
   `outline-editor` and `canvas-page` tested the same thing plus
   `isContentEditable`. That is one concept with two implementations, and the
   shorter one was the incomplete one, so all three now call `isTextEntry`.
7. **A cluster hull is hit-tested with the shape it is drawn as.** Drawing used
   a rounded polygon (or a circle for a two-point hull); the click handler
   rebuilt a plain polygon from the same hull, so the click target never
   matched the outline. `clusterHullPath` is now both. Each caller keeps its
   own guard, so a two-node cluster is still drawn and still not clickable.
8. **`ref-add-popover` closes on an outside press even if its root ref is
   null.** The other three click-outside handlers already did; `isOutside`
   treats a missing container as outside. The ref is set before the effect
   runs, so no reachable path changes.

## 7. Test status

`bun run test:ui`: **630/630**, including `palette-index.test.ts`'s 50k perf
bar, which b3 §6 recorded as load-sensitive. It failed on two of the seven full
runs this wave and passed on the rest, always in isolation; the same is true of
`editor-behavior.test.tsx` §3.3, which failed once and passed on a rerun. Both
are the flakes `d2` §7m and b3 §6 already documented, not regressions — the
final run of each is green.

`bun test packages`: 362/362. `bun test packages/harness`: 44/44.

## 8. Shared-file touches

- `tools/kb/packages/harness/lint-warn-baseline.json` — regenerated with
  `bun run harness:snapshot` after every commit, never hand-edited. Nine counts
  changed and two rules left the ledger (§2); the other ten blocking rules
  are byte-identical.
- `tools/kb/DESIGN.md` — one bullet added to "Domain typing" (§4.7).
- `tools/kb/packages/ui/src/stores/outline.store.test.ts` — the single test
  edit, forced by the `src` deletion in §4.6.

`tools/kb/.oxlintrc.json` is untouched. `.kb/nodes.jsonl` is untouched — no new
`#gap` nodes were created; §5a–§5d are recorded here, and the two gaps §5b
names already exist.
