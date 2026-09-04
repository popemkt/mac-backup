# b3-burndown-ui — report

Second drain pass over `tools/kb/packages/ui`, after `d2` took it to 881
findings and judged the remainder non-mechanical. Harness: claude (opus),
worktree `b3-burndown-ui`, branch `feature/b3-burndown-ui` on
`kb-wave/2026-09-03` (`c541b27`). 4 commits, `bun run verify` green before
each.

The rule of this wave was narrower than `d2`'s: **mechanical only**. A fix
shipped here changes no behaviour, no public API and no data model, and it is
provable from something the code already establishes — a parsed schema, an
exhausted union, a total record, or an expression the same function already
evaluated. Everything else is in §5, with file:line.

---

## 1. Headline

| | before (`c541b27`) | after |
|---|---|---|
| oxlint findings in `@kb/ui` | 881 | **801** |
| ratchet ledger, blocking lane (workspace) | 1586 | **1506** |
| ratchet ledger, advisory lane | 12 | 12 |
| blocking rules in the ledger | 40 | 40 |
| oxlint **errors**, workspace | 0 | **0** |
| rules promoted `warn` → `error` | — | **0** (see §3) |
| `#gap` nodes created | — | 0 (`.kb/nodes.jsonl` is out of scope for this wave) |

`bun run verify` (typecheck → lint → fmt:check → knip → harness): **green**,
39/39 harness tests. `bun run test:ui`: **629/630**, the one failure being
`palette-index.test.ts` "meets perf bar at 50k nodes", which fails identically
on the unmodified base — see §6.

## 2. Per-rule before/after (ui)

| Rule | before | after | how |
|---|---|---|---|
| `typescript/strict-boolean-expressions` | 245 | **200** | 43 `boolean \| undefined` conditionals stated as `=== true` / `!== true`; 2 fell out as duplicates |
| `typescript/no-unsafe-type-assertion` | 94 | **78** | 16 assertions deleted by asserting once per scope instead of once per read |
| `typescript/no-unnecessary-condition` | 49 | **30** | 19 guards deleted where a zod parse, a total `Record` or an exhausted union already settled the question |
| `typescript/no-non-null-assertion` | 391 | 391 | §5a |
| `typescript/no-deprecated` (advisory) | 10 | 10 | §5e |
| `eslint/max-lines-per-function` | 55 | 55 | lane:R forever (plan D12) |
| `eslint/max-depth` | 12 | 12 | §5g — closed by the `complexity` gaps, not separately |
| `oxc/no-map-spread` | 9 | 9 | owner decision, untouched by instruction |
| `unicorn/consistent-function-scoping` | 8 | 8 | lane:R forever (plan D12) |
| `eslint/no-await-in-loop` | 4 | 4 | owner decision, untouched by instruction |
| `eslint/max-params`, `eslint/max-lines` | 2, 2 | 2, 2 | lane:R forever (plan D12) |

Workspace ledger movements (the only three rules whose counts changed):

| Rule | ledger before | ledger after | ui after | backend after |
|---|---|---|---|---|
| `typescript/strict-boolean-expressions` | 272 | 227 | 200 | 27 |
| `typescript/no-unsafe-type-assertion` | 143 | 127 | 78 | 49 |
| `typescript/no-unnecessary-condition` | 50 | 31 | 30 | **1** |

The small-count ledger rules the brief asked about — `import/no-duplicates`
(7), `eslint/no-shadow` (4), `typescript/consistent-return` (3),
`eslint/default-case` (2), `eslint/max-lines` (2), `oxc/no-accumulating-spread`
(2) and the rest — have **no `@kb/ui` hits at all**. Every one of them is
backend-only, so none is reachable from this wave's scope.

## 3. Promotions: none, and why

No rule reached 0 in both scopes, so nothing was promoted and
`tools/kb/.oxlintrc.json` is untouched. The ledger says why: of the 40 blocking
rules, `@kb/ui` contributes to 12, and the other 28 are backend-only, so this
wave could not move them. Of the 12, the three that moved all still have
non-zero counts in ui *and* backend.

The near miss is worth flagging: **`typescript/no-unnecessary-condition` is now
at 1 in the backend and 30 in ui**, and all 30 ui sites are in §5d — conditions
that guard against runtime the DOM types deny, or that TypeScript's
control-flow analysis cannot see through. It is the closest rule in the ledger
to promotion and the furthest from being drained mechanically.

Because nothing was promoted, there is no red-then-green evidence table this
wave; the plan's §"Standing constraints" #3 attaches that requirement to
promotions and harness checks, and this wave added neither.

## 4. What shipped

### 4.1 `b5cdac0` — nullable-boolean conditionals stated explicitly

43 conditionals tested a `boolean | undefined` optional prop or ref
(`sticky`, `disabled`, `dragRef.current?.dragging`, `ev.shiftKey`, …). For an
optional boolean, truthiness *is* `=== true` — there is no empty-string or zero
case to decide, which is exactly what separates these from the 185 nullable
strings in §5b. Every rewrite is the same expression.

Two cleanups fell out of the same pass, both provable from control flow rather
than from a type:

- `selection-keymap.ts:81` re-derived `ev.metaKey || ev.ctrlKey` one line after
  binding it as `mod`. The second copy is gone.
- the same function's `default` branch re-tested `!ev.metaKey && !ev.ctrlKey`
  *after* `if (mod) return null`, so both halves were dead.

`field-value.tsx`'s `showEmpty` now types as `boolean`, which cleared the four
downstream conditionals that read it.

### 4.2 `130324d` — conditions the wire schema already rules out

`@kb/ui` parses every server payload through the zod contracts —
`GraphSnapshotSchema.parse` in `api/graph.ts:29`, `ServerMessageSchema.safeParse`
in `api/ws.ts:189`. `WireNodeSchema` types `text` as `z.string()` and every
`PropValue` variant's `v` as a non-nullable primitive. Sixteen `?.` / `??` /
`=== null` guards were re-deciding that *after* the parse: `?.text?.trim()`
(the second `?.` cannot fire), `String(value.v ?? "")`, and
`empty={value.t !== "num" || value.v === null || value.v === undefined}`. One
more, `field-row.tsx:89`, gave a `??` fallback to `FIELD_ICON`, a
`Record<PropValue["t"], Icon>` indexed by an expression whose return type *is*
`PropValue["t"]`.

Deleted only where a schema or a total record makes the fact true. The
DOM-shaped ones stayed — see §5d.

Three assertion clusters were collapsed in the same commit, each of which
stated one fact more than once:

- `api/action.ts` asserted `ActionReceipt` three times inside the type guard
  that was establishing it;
- `caret.ts:213-232` spelled the two vendor caret APIs out in four separate
  `document as unknown as {…}` casts; they now have one named
  `CaretDocument` interface;
- `md-edit.ts:198` reached `globalThis` through two casts to read one field.

### 4.3 `9f38ae1` — branches their own union already decided

`resolveLayout` tested for `"grid"` after eliminating the other three
`LensLayout` members; the canvas pointer-move handler tested for `"edge"` after
every other drag kind had returned; the asset-append path asked whether a
node's text was empty twice in one expression (`!node?.text ||
node.text.trim() === ""`).

`defaultPostAction` keeps its runtime status check but stops asserting
`ActionReceipt` to make it. `"status" in json` narrows the property to
`unknown`, which is what an unparsed response actually is, so the check reads
as a check. (Asserting the type first made oxlint correctly report the check as
unnecessary — the assertion was the thing making it look redundant.) There is
no `ActionReceiptSchema` in `@kb/contracts` to parse against; see §5c.

### 4.4 `66cc461` — assert the drag target once per handler

Four canvas `onPointerDown` handlers re-asserted `e.target as HTMLElement` on
every line that read it (three lines each), and the force-3d neighbour loop
asserted both link endpoints twice. The assertion is unchanged and still
unsafe; it is now made once where the value enters the scope, so a future guard
has one place to land instead of nine.

## 5. Needs owner

Everything below was left undone on purpose. Each is a decision or a refactor,
not a drain.

**a. `typescript/no-non-null-assertion` — 391 in ui (299 in tests, 92 in src).**
Unchanged, and `d2`'s reading holds after a second look. The distribution is
`arr[i]!` under `noUncheckedIndexedAccess` inside index loops (`palette-index`,
`convex-hull`, `cluster-graph`'s hull path), `map.get(k)!` behind a
`map.has(k)` on the previous line, and `regexMatch[1]!` after a successful
`exec`. Each states an invariant the type system cannot carry; replacing one
means choosing what happens when the invariant breaks, which is a behaviour
decision per site. There is no mechanical subset left: `d2` already ran
`no-unnecessary-type-assertion --fix`, so every *redundant* `!` is gone and the
391 that remain are all load-bearing. Backend carries 201, so the rule cannot
promote from this scope regardless.

**b. `typescript/strict-boolean-expressions` — 200 remain, 185 of them
"nullable string".** This is the empty-string question the brief asked to have
listed rather than guessed. 181 are in `src`, 4 in tests, and **about 112 of the 185
name an id- or key-shaped binding** (`if (canvasId)`, `if (afterSiblingId)`,
`if (o.activeNodeId && o.activeInstanceKey)`, `if (plan.focusId)`). For an id,
`""` is not a value in the domain, so `!== undefined` would be right — but that
claim belongs to the data model, not to a linter pass, and if it is wrong
anywhere the rewrite silently changes a branch. The other 73 are display text
where `|| "Untitled"` is a deliberate empty-string fallback and must stay
truthy. Recommendation unchanged from `d2`: decide `allowNullableString`, or
budget a wave that answers "can an id be empty?" once and applies it.

The 15 non-string sites split further:

- 8 "object is always truthy" — all in §5d's DOM class
  (`window.matchMedia` ×3, `getBoundingClientRect` ×2, `DataTransfer.files`,
  `Graph.cameraPosition()`, and `canvas-page.tsx:1100`);
- 5 "union with inconsistent truthiness" — `ReactNode` truthiness
  (`sidebar.tsx:84`, `node-command-palette.tsx:582`,
  `view-error-boundary.tsx:84`) and `!value.v` over `string | number | boolean`
  (`field-value.tsx:89`, `:110`), where `0` and `""` and `false` are three
  different questions;
- 1 `any` in a test's happy-dom probe, 1 the CFA false positive below.

**c. `typescript/no-unsafe-type-assertion` — 78 remain.** By shape:

| Shape | n | Why it is not mechanical |
|---|---|---|
| `e.target as HTMLElement` / `as Node` / `as HTMLInputElement` | 31 | React types `target` as `EventTarget`; the honest fix is an `instanceof` guard, which adds a runtime branch |
| `(l as FgLink)` / `(n as FgNode)` in `3d-force-graph` callbacks | 13 | the library hands back `object`; a typed adapter is a design move |
| `node as HTMLElement` / `as Text` after `nodeType === …` | 6 | a `n is HTMLElement` predicate would be runtime-identical, but it moves an unsound claim rather than checking it — a green rule that checks nothing |
| `e.target.value as ThemePref` and friends | 8 | the `<select>` options come from a const list; a parse is the fix and it changes what happens on an unexpected value |
| host globals absent from `lib.dom` | 3 | see the `CaretDocument` shape in §4.2 — the remaining three are the same class |
| other (datalog rows, `action.input`, `JSON.parse`, `graphData()`) | 17 | boundary parses; `@kb/contracts` has no schema for `ActionReceipt`, `Prefs` or a datalog row |

Two of these are worth a decision rather than a drain: `@kb/contracts` defines
`ActionReceipt` as a bare TS union while every other wire shape next to it has
a zod schema, and `Prefs` has none at all. Adding those two schemas would turn
`api/action.ts`, `prefs.store.ts:53` and `optimistic.ts:29`/`:42` from
assertions into parses — but it also changes what the UI does with a malformed
payload, so it is an API decision.

**d. `typescript/no-unnecessary-condition` — 30 remain, and every one is a
place where the type is lying or blind.** This is the class `d2` warned about
with `prefs.store.ts`, and the second pass confirms it:

- 9 guard browser APIs the types declare mandatory but the runtime may omit:
  `setPointerCapture?.()` ×7 (`canvas-page.tsx:616, 628, 659, 1197, 1621, 1666,
  1726`), `mq.addEventListener?.` (`prefs.store.ts:155`), `row?.scrollIntoView?.`
  (`command-palette.tsx:67`);
- 3 are `window.matchMedia` (`graph-page.tsx:33`, `prefs.store.ts:76`, `:153`) —
  the exact site that taught `d2` this lesson;
- 7 are happy-dom fallbacks inside tests (`dom.PointerEvent ?? dom.MouseEvent`,
  `dom.NodeFilter ?? { SHOW_TEXT: 4 }`, `textContent?.trim()` ×5);
- 5 are TypeScript control-flow blind spots, where a `let` is mutated inside a
  nested closure and TS still believes the initial value: `caret.ts:203, 275,
  277`, `md-edit.ts:180`, `canvas-page.tsx:1100`. Deleting any of these breaks
  the code;
- 4 are DOM values the lib types as non-nullable (`getBoundingClientRect`,
  `DataTransfer.files`, `Node.textContent`);
- 1 is `query-results.tsx:56`, where `edn === null` is what makes the effect
  body typecheck.

None of these is drainable by narrowing. Closing the rule means either scoping
it off for DOM-facing modules or accepting the 30 as permanent — an owner call,
and the reason the rule sits at 31 workspace-wide with 1 backend hit.

**e. `typescript/no-deprecated` — 10, all of them this repo's own markers, and
the replacement exists for only one of the three.**

- `getPreviousVisibleNode` / `getNextVisibleNode` (4 hits): the replacements
  `getPreviousVisibleInstance` / `getNextVisibleInstance` **do exist and are
  what production already calls**. Grep says the deprecated pair has *no*
  production caller left — the only references are their interface
  declarations and definitions (`outline.store.ts:126`, `:128`, `:780`, `:786`)
  and one test (`outline.store.test.ts:175`,
  `:176`) that pins them. Deleting both methods and that test closes 4 of the
  10 and removes a store API; that is an API decision, so it is listed rather
  than done.
- `cursorPosition` (4 hits): the replacement is `CaretIntent`, and the canvas
  card still reads the old field (`canvas-card.tsx:38`, `:135`). Migrating the
  canvas to `CaretIntent` is the work; gap `01M1MGT307N4K243CBPJTXNG5X` already
  names it.
- `LEGACY_COLLAPSED_STORAGE_KEY` / `LEGACY_EXPANDED_QUERIES_STORAGE_KEY` (2):
  there is no replacement — these are a one-way localStorage migration with no
  removal condition. Gap `01M1MGT2A6Y9ZVG5J1CGJMJ2AH`.

**f. `caret.ts` calls one vendor caret API bound and the other unbound.** Found
while collapsing the four `document as unknown as {…}` casts in §4.2 and
**deliberately preserved verbatim**, with a comment at the site.
`caretRangeFromPoint` is read off `document` and then called as a bare
function, so `this` is `undefined`; `caretPositionFromPoint` is called on
`document`. In a browser the first form throws `Illegal invocation`, and
`offsetFromPoint` swallows it in its `try/catch` and returns `null` — so on
Chrome, click-to-place-caret has been falling through to the `null` path rather
than using the API it prefers. Unifying them is a one-word change and a real
behaviour fix, which is why it is here and not in a commit.

**g. "a pointerdown that began in a port, a resize handle or an inner editor is
not a drag" is written out four times.** `canvas-card.tsx:97` and `:205`,
`shape-card.tsx:130`, `canvas-page.tsx:1576`. The first two clauses are
identical in all four; only the third differs (`.node-content` / `TEXTAREA` /
`input` / none). §4.4 deduplicated *within* each handler, which is as far as a
mechanical pass reaches; collapsing the four into one predicate is the Rule 1
move and needs someone to decide what the third clause is a parameter *of*.

**h. Click-outside is implemented four times too.** `graph-settings.tsx:30`,
`edge-inspector.tsx:41`, `shape-inspector.tsx:23` use
`!ref.current.contains(e.target as Node)`; `ref-add-popover.tsx:62` uses the
`e.target instanceof Node` form and needs no assertion. The last one is the
shape the other three want, but converting them changes what happens when
`e.target` is not a `Node`, so this is one `useClickOutside` hook away rather
than three edits.

**i. Two graph components decode graphology attributes with the same cast.**
`cluster-graph.tsx:285` and `sigma-graph.tsx:305` both write
`graph.getNodeAttributes(node) as { x: number; y: number }`. One typed accessor
would own it; it is a new shared export, so it is listed.

**j. Untouched by instruction.** `oxc/no-map-spread` (9) and
`eslint/no-await-in-loop` (4) are owner decisions carried over from `d2` §7e/§7f
and were not modified. The size sensors — `max-lines-per-function` (55),
`max-depth` (12), `consistent-function-scoping` (8), `max-params` (2),
`max-lines` (2) — stay on the ratchet forever per plan D12; ten of the twelve
`max-depth` sites are inside functions that already carry a `complexity` `#gap`,
so the extraction that closes those closes these.

**k. No `#gap` nodes were created.** The brief put `.kb/nodes.jsonl` out of
scope for this wave, so §5f, §5g, §5h and §5i are recorded here only. If the
owner wants them tracked as nodes, they are four `kb add --tag gap` lines.

## 6. Test status

`bun run test:ui` finishes **629/630**. The single failure is
`src/lib/palette-index.test.ts` "meets perf bar at 50k nodes: open <50ms,
keystroke <10ms", and it is not this wave's:

- reproduced on the **unmodified base** (`c541b27`, all edits reverted): same
  one failure, 629/630;
- passes in isolation (`vp test src/lib/palette-index.test.ts`);
- `d2` §7m already recorded it as a wall-clock limit that flakes under load.

`editor-behavior.test.tsx` also failed once in each of two full runs — a
*different* test each time (`§3.3` in one run, `D10` in another) and never
twice in a row, passing in isolation and passing in the final two full runs.
That is the same load-sensitivity `d2` documented, not a regression; it is
noted here because it will keep costing the next worker a bisect.

`bun test packages/harness` hit `d2` §7o's other flake once during the final
check: `lint-warn-ratchet` "no blocking rule count rose above baseline" timed
out at bun's 60000 ms limit on a loaded machine, then passed twice in a row at
67 s and 45 s. The test shells out to a full type-aware oxlint run, so its
runtime tracks machine load, not the ledger. It is still worth a raised
timeout or a cached lint pass.

Nothing in this wave changed a test. `field-visibility.test.ts:108` and
`ontology-scope.test.ts:168, 227` were edited only to state the same condition
explicitly.

## 7. Shared-file touches

`tools/kb/packages/harness/lint-warn-baseline.json` — regenerated with
`bun run harness:snapshot` after every commit, never hand-edited. Three counts
changed (§2); the other 37 blocking rules and the advisory rule are byte-identical.

Nothing else outside `tools/kb/packages/ui` was modified.
`tools/kb/.oxlintrc.json` is untouched (§3). `.kb/nodes.jsonl` is untouched.
