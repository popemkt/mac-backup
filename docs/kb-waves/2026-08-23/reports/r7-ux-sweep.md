# R7 — whole-surface UX sweep (excluding outline / graph / canvas ownership)

Research-only audit for the 2026-08-23 kb wave. This covers the app shell,
sidebar, global and node palettes, inline node metadata flows, references,
query-node UX, preferences, Table/Board/Cards, filters, toasts, focus, motion,
and cross-surface consistency. Outline editing mechanics, graph renderers, and
canvas mechanics are mentioned only where a shared surface exposes the issue.

## Method and evidence bound

- Read `DESIGN-UI.md`, `DESIGN-RESKIN.md`, `DESIGN-REFINE.md`, the Tana report,
  and the database-views report. The reports live in the main checkout at
  `/Users/popemkt/.dotfiles/.research/kb-refine/{tana,views}/report.md`; this
  worktree does not contain `.research/`.
- Audited the current `tools/kb/ui/src` tree. Several names in the brief are
  historical: global search is now `components/palette/command-palette.tsx`,
  the old node panel was intentionally removed, and the old Query page is now
  query nodes plus `sys.queries`.
- Booted the production app against this worktree at `127.0.0.1:4321`. The
  graph API loaded 168 nodes, two query definitions, and the full command-node
  seed. No controllable in-app/external browser was attached to this session,
  so this report does not pretend to contain screenshot or pointer repros.
  Position/focus findings below are direct DOM/control-flow consequences.
- Verification baseline: `bun run typecheck` passed and `bun run test` passed
  47 files / 264 tests. The documented `npm run ...` entry points were not
  runnable with the admitted shell's npm 10.9.8 because the UI package demands
  npm 12.0.2; that tooling mismatch is outside this UX audit.
- Severity: **P0** unusable/data-loss path; **P1** broken or strongly
  misleading primary flow; **P2** recurring professional-quality defect;
  **P3** worthwhile nicety. No P0 was found.

## Top 10 feel killers

1. **Board is a selectable mode with no way to configure its group field.** It
   lands on developer copy telling the user to set `view.group`.
2. **A bad live query gets stuck on “loading results…” forever.** The actual
   error is detached into a transient `ws query_error` toast.
3. **“Search and open” is on ⌘S while ⌘K is a node-only command menu.** This
   contradicts the documented/Tana contract and captures the standard Save
   shortcut.
4. **Sidebar Home can be highlighted yet do nothing.** While zoomed on `/`, it
   calls a route no-op instead of returning to the workspace root.
5. **Outline zoom has no URL/history or scroll contract.** Reload, Back, copied
   URLs, breadcrumbs, and sidebar navigation do not behave like page navigation.
6. **Query editing is a generic one-line field editor.** There is no multiline
   workbench, validation, insert help, or stable local error presentation.
7. **The inline-metadata redesign omitted “Add field”.** Users can edit or
   remove existing props, but cannot add an ad-hoc field to the current node.
8. **Search looks fast but not intelligent.** No frecency, path/context,
   highlighting, or active-row scroll; fuzzy candidates disappear whenever
   even one substring match exists.
9. **Create tag/field makes an `untitled-*` node and zooms to a static title.**
   The user must navigate away, find the node again, and rename it as a row.
10. **Keyboard/focus behavior is below app-grade.** Closed sidebar controls
    remain tabbable, palettes do not trap/restore focus, and the shared tag chip
    is a clickable `<span>` with hover-only remove/config controls.

## Ranked findings

### P1 — primary flows that currently feel broken

#### R7-01 — Board setup is a dead end

- **Evidence:** the shared toolbar exposes only mode buttons and a filter gear
  (`components/outline/view-toolbar.tsx:69-112`); Board requires
  `groupFieldId`, then renders “Set `view.group`” with only “Switch to cards”
  (`components/outline/board-cards-view.tsx:93-99,149-170`). There is no UI
  caller for the existing `setViewGroup`/`setViewDisplay` mutations.
- **Fix direction:** make the gear a complete view-settings popover: Group,
  Display fields, Sort stack, Filters, page size. The unconfigured Board state
  should lead directly to a type-aware “Group by…” picker, never expose a
  storage key.
- **Owner:** **i5-polish**.

#### R7-02 — live query errors can never reach the inline error branch

- **Evidence:** `liveError` is initialized and cleared only when rows arrive;
  no subscription error callback sets it
  (`components/outline/query-results.tsx:41-59`). WebSocket errors go to one
  global raw toast (`api/live.ts:35-49`). With the socket open, `rows === null`
  therefore renders “loading results…” indefinitely
  (`query-results.tsx:79-102`).
- **Fix direction:** route server errors by subscription id to the owning query
  component, retain last-good rows, show a persistent inline error with
  line/column detail and Retry/Edit actions, and reserve the global toast for
  connection-wide failures.
- **Owner:** **i4-backend** for error routing, **i5-polish** for the inline state.

#### R7-03 — query authoring is not a query workbench

- **Evidence:** all text props, including `sys.f.query`, route through generic
  `EditableText` (`components/outline/field-value.tsx:98-107`); Enter blurs and
  commits (`field-value.tsx:164-184`). Current error UI is a raw exception line
  (`query-results.tsx:87-94`). The running repo also still presents the seeded
  command text “Go to query page” even though `run-command.ts:48-51` says that
  page is gone.
- **Fix direction:** special-case the query field with a multiline monospace
  editor, debounced validation/run state, EDN bracket/keyword helpers, starter
  clauses, result count, and save/duplicate/delete affordances. Migrate stale
  command-node labels to “Saved queries”.
- **Owner:** **i5-polish**; **i4-backend** only if parser completion metadata is
  added.

#### R7-04 — global search and node commands have the wrong shortcut contract

- **Evidence:** `matchGlobalShortcut` maps ⌘K to the contextual node palette and
  ⌘S to global search (`lib/keyboard-shortcuts.ts:1-13`); the capture listener
  prevents the browser/default action (`components/App.tsx:209-234`); header
  chrome advertises ⌘S (`components/palette/command-palette.tsx:190-205`).
  `DESIGN-REFINE.md` W3 explicitly defines ⌘K as “Search and open”.
- **Fix direction:** restore ⌘K to the unified global surface. Put contextual
  node commands behind a secondary chord, `/`/insert menu, or a “Commands for
  selected node” section inside the same palette. Do not appropriate ⌘S unless
  it communicates a real save/sync action.
- **Owner:** **i5-polish**.

#### R7-05 — search ranking and keyboard navigation are shallow

- **Evidence:** ranking has only prefix/substring/id/subsequence tiers and
  alphabetical ties (`lib/palette-index.ts:71-137`); fuzzy scanning happens
  only when there are zero substring hits (`:120-134`) and stops after the
  first 20 alphabetically encountered candidates. Empty query is alphabetical
  commands, not recent/frequent activity (`:90-96`). Result rows show no match
  highlight or ancestry, only text plus internal id
  (`components/palette/command-palette.tsx:155-180`). Arrow navigation changes
  `aria-activedescendant` but never scrolls the active result into view
  (`:78-101,145-184`).
- **Fix direction:** rank the full candidate set by word boundary, compactness,
  type, pin, recent-open and frequency; merge substring and subsequence results;
  highlight matched spans; show breadcrumb/tag context; persist recency as a
  device preference; call `scrollIntoView({block:'nearest'})` on active changes.
- **Owner:** **i5-polish**.

#### R7-06 — Sidebar Home is active but does not exit zoom

- **Evidence:** Home is active for every outline route and calls only
  `navigate('/')` (`components/sidebar/sidebar.tsx:146-152`). `navigate` exits
  early when already on `/` (`lib/router.ts:16-20`), while zoom state is an
  independent `rootNodeId` reset only by `zoomHome`
  (`stores/outline.store.ts:251-271`). Pinned rows also never receive an active
  state (`sidebar.tsx:200-213`).
- **Fix direction:** Home must call `zoomHome()` as well as route home; its active
  state must require the workspace root. Mark the current pinned node active.
- **Owner:** **i5-polish**.

#### R7-07 — outline navigation is not represented in URL/history or scroll

- **Evidence:** the route model contains only outline-as-root, graph, and canvas
  (`lib/router.ts:38-58`). `zoomTo` only mutates Zustand and neither pushes
  history nor adjusts the main scroller (`stores/outline.store.ts:251-271`),
  while only search/jump has an explicit smooth scroll (`:376-393`).
- **Fix direction:** add a canonical `/node/:id` (or URL query) route, push on
  zoom, pop on Back, hydrate the zoom root on reload, provide “Copy link”, and
  define scroll behavior: new zoom starts at top; Back restores prior scroll.
- **Owner:** **i5-polish**.

#### R7-08 — adding a field to the current node is missing

- **Evidence:** `FieldsSection` returns nothing when no props exist and only
  maps edit/remove controls for existing values
  (`components/outline/fields-section.tsx:20-75`). The contextual palette has
  Add tag but no Add field (`node-command-palette.tsx:92-140`). Field creation
  exists only while configuring a tag schema
  (`tag-config-panel.tsx:200-239`). The documented `>` field affordance is not
  implemented anywhere in the current UI.
- **Fix direction:** add “Add field…” to the node palette and an inline empty
  affordance under expanded nodes; search existing fields, allow defining a new
  one in place, initialize a typed empty value, and support the documented `>`
  trigger.
- **Owner:** **i1-editor** for the typing trigger, **i5-polish** for picker/flow.

#### R7-09 — create tag/field does not collect or focus the name

- **Evidence:** global commands create literal `untitled-tag` and
  `untitled-field`, then zoom to them (`lib/run-command.ts:34-45`). The zoomed
  title is a static `<h1>` (`components/outline/zoomed-root-header.tsx:31-45`),
  so the command does not end in a renameable surface.
- **Fix direction:** make command results collect the requested name before
  committing, or mount a shared editable `NodeRow` title and immediately focus
  it. Apply the same finish-state to New query and New canvas.
- **Owner:** **i5-polish**.

#### R7-10 — destructive actions have no recovery contract

- **Evidence:** contextual “Delete node” invokes deletion immediately
  (`components/outline/node-command-palette.tsx:130-138`); selection-mode
  Backspace/Delete does the same (`components/outline/use-selection-keymap.ts:27-43`,
  `lib/selection-keymap.ts:75-83`). There is no undo/redo or trash surface.
- **Fix direction:** implement a short-lived undo toast backed by inverse
  mutations or recoverable trash; require confirmation only for unusually
  destructive/cascading cases. The node palette should communicate the shortcut
  and recovery behavior.
- **Owner:** **i1-editor** (mutation/history semantics), **i5-polish** (toast/UI).

#### R7-11 — closed sidebar leaves invisible controls in the tab order

- **Evidence:** collapse sets width zero and `aria-hidden`, but keeps all button
  descendants mounted (`components/sidebar/sidebar.tsx:135-145`). `aria-hidden`
  does not make descendants unfocusable.
- **Fix direction:** apply `inert` while closed (with the compatibility path),
  or conditionally unmount content after the width transition. Return focus to
  the toggle when a focused sidebar is collapsed.
- **Owner:** **i5-polish**.

#### R7-12 — shared tag chips are pointer/hover only

- **Evidence:** `TagChip` is a clickable `<span>` with no role, tab stop, or key
  handler; remove/configure are nested hover-only spans
  (`components/outline/tag-chip.tsx:22-69`). Because this is the one shared chip,
  the defect repeats in outline rows, references, table/cards, schema, and ref
  fields.
- **Fix direction:** use an actual button (or roving composite) for navigation,
  expose remove/configure as keyboard-reachable actions, add accessible names,
  and preserve the invariant that the same chip renders everywhere.
- **Owner:** **i5-polish**.

#### R7-13 — popover positioning and focus management are not shared or robust

- **Evidence:** the global dialog focuses its input but has no Tab trap or focus
  restoration (`command-palette.tsx:49-55,106-148`). Node palette placement
  never clamps right or bottom (`node-command-palette.tsx:302-315`). Filter
  placement clamps the *top* to 12 px above the viewport bottom without
  accounting for panel height (`view-filter-popover.tsx:174-185`). Tag config
  can calculate a negative top in a viewport below 420 px
  (`tag-config-panel.tsx:79-88`). Preferences and filters close on outside
  pointer/Escape but never focus an initial control or restore the trigger
  (`preferences-popover.tsx:21-58`; `view-filter-popover.tsx:111-143`).
- **Fix direction:** one floating-surface primitive should own portal, flip/shift,
  max-height, outside click, Escape, focus trap/roving behavior, trigger focus
  restoration, and reduced-motion transitions.
- **Owner:** **i5-polish**.

#### R7-14 — inline field editing is not IME-safe

- **Evidence:** main node text correctly tracks composition
  (`components/outline/node-content.tsx:234-252`), but shared `EditableText`
  commits on Enter with no `isComposing`/composition handlers
  (`components/outline/field-value.tsx:147-185`). This editor is reused in
  node fields, Table, Board, Cards, and query EDN.
- **Fix direction:** give every editable primitive the same composition guard;
  Enter must not commit while an IME candidate is being accepted. Add component
  tests for compositionstart → Enter → compositionend.
- **Owner:** **i5-polish**.

#### R7-15 — initial graph failure has no recovery action

- **Evidence:** load errors become a raw destructive-colored string
  (`components/App.tsx:189-202`, `OutlineShell:139-140`), unlike lazy Graph and
  Canvas crashes, which use `ViewErrorBoundary` with Try again.
- **Fix direction:** use the same recovery anatomy for initial load: plain-language
  summary, technical details disclosure, Retry, and explicit fixture/offline
  choice where allowed.
- **Owner:** **i5-polish**.

### P2 — recurring friction and professional-quality gaps

#### R7-16 — view configuration is only partially surfaced

- **Evidence:** `ViewConfig` parses persisted sort, display, column widths,
  page size, group, and filters, but the toolbar exposes only mode/filter
  (`lib/view-config.ts:190-222`; `view-toolbar.tsx:69-112`). Sort is only
  discoverable by clicking a table header; Display and page size have no UI.
- **Fix direction:** fold all persisted settings into the R7-01 popover, show
  active sort/filter badges, and make every setting reversible without editing
  system props.
- **Owner:** **i5-polish**.

#### R7-17 — Table and filters omit ad-hoc props

- **Evidence:** fallback columns are derived only from fields templated by each
  child's tags (`lib/view-config.ts:230-255`), despite kb props being valid
  without a tag template. The filter field picker reuses that same result
  (`components/outline/view-filter-popover.tsx:26-40`).
- **Fix direction:** union visible non-system prop keys actually present on rows
  with tag-template fields; retain deterministic order and allow explicit
  Display config to override it.
- **Owner:** **i5-polish**.

#### R7-18 — Board columns are “values currently present”, not a stable workflow

- **Evidence:** columns are synthesized from the first group value on existing
  children, sorted alphabetically, then an empty bucket is appended
  (`lib/view-config.ts:358-393`). A valid status with zero current cards has no
  column/drop target; semantic option order is lost.
- **Fix direction:** model/resolve field options (or persist board column values
  and order), render empty configured columns, allow adding/reordering columns,
  and define multi-value grouping rather than silently taking the first.
- **Owner:** **i4-backend** if option nodes are introduced; otherwise
  **i5-polish** using persisted view configuration.

#### R7-19 — Board drag is mouse/native-only and has no drop feedback

- **Evidence:** columns use HTML5 `onDragOver`/`onDrop`; cards use `draggable`
  (`components/outline/board-cards-view.tsx:209-244,299-312`). `dragNodeId` is
  not used to style a source or destination. Query-source cards simply disable
  drag without explaining why (`:124,240`).
- **Fix direction:** add visible source/target states and a keyboard “Move to
  column…” action; use a pointer/touch-capable drag layer or explicit move menu;
  explain/query-test whether moving a query result updates its source field.
- **Owner:** **i5-polish**.

#### R7-20 — pagination and density diverge across views

- **Evidence:** Table slices by `pagesize` and offers Show more
  (`components/outline/table-view.tsx:91-102,248-260`), while Board/Cards render
  every filtered child (`board-cards-view.tsx:188-249`). Cards render every
  resolved display column rather than the research target of 2–3 footer fields
  (`:196-205,330-379`).
- **Fix direction:** share the same page window across projected views; show
  counts and incremental loading per board; cap default card footer fields and
  make Display explicit.
- **Owner:** **i5-polish**.

#### R7-21 — Table controls are mouse-only and empty tables are visually blank

- **Evidence:** sortable headers are click handlers on `<div>` and resize
  handles are hover-only `<div onMouseDown>` controls
  (`components/outline/table-view.tsx:171-223,386-399`). `<tbody>` maps rows
  with no zero-row fallback (`:228-245`).
- **Fix direction:** buttons with `aria-sort`, keyboard-operable resize handles,
  resize values/limits, and an empty row/CTA (“Add child” or “No rows match
  filters”) spanning the visible columns.
- **Owner:** **i5-polish**.

#### R7-22 — filter UI leaks ids, ignores invalid config, and is not type-aware

- **Evidence:** saved chips show raw `fieldId` (`view-filter-popover.tsx:21-24`),
  equality always uses a text input (`:251-263`), and malformed persisted EDN is
  dropped with only `console.warn` (`lib/view-config.ts:211-220`). Ref equality
  accepts id or exact case-sensitive label, while booleans/numbers/dates remain
  string entry (`view-config.ts:115-120`).
- **Fix direction:** resolve field labels in chips; render the shared typed field
  editor for filter values; show invalid clauses as recoverable warnings rather
  than silently changing results; expose AND semantics and result count.
- **Owner:** **i5-polish**.

#### R7-23 — pinning has no product flow

- **Evidence:** Pinned is a read-only list selected by a tag whose text is
  exactly `pinned` (`components/sidebar/sidebar-nav.ts:14-26`). Empty copy says
  “Tag nodes #pinned” (`sidebar/sidebar.tsx:200-204`), but there is no Pin/Unpin
  action in either palette; this worktree's live graph contains no such tag.
- **Fix direction:** add Pin/Unpin to node/global commands and row context,
  create/migrate the canonical model automatically, preserve manual order, and
  show the current pin as active.
- **Owner:** **i5-polish**.

#### R7-24 — sidebar lacks information scent and section controls

- **Evidence:** sections have no collapse state/counts; perspectives/canvases
  are unbounded flat lists and pinned nodes sort alphabetically
  (`components/sidebar/sidebar.tsx:83-99,155-215`; `sidebar-nav.ts:14-26`).
- **Fix direction:** collapsible sections with counts, recents, manual pin
  ordering, per-section empty CTA, and virtualization/search once a list exceeds
  a modest threshold.
- **Owner:** **i5-polish**.

#### R7-25 — ref autocomplete cannot be cleanly dismissed and has weak empty UX

- **Evidence:** while candidates exist, Escape prevents default but leaves the
  `[[` trigger/cursor state unchanged, so the same popup remains open
  (`components/outline/node-content.tsx:190-210,280-285`). The shared popup has
  no id/context, no ancestry/highlighting, and no empty state/create action
  (`components/ref-autocomplete.tsx:15-50`). Field-ref editing permits arbitrary
  manual ids when no candidate exists, even when suggestions were constrained
  (`field-value.tsx:415-427`).
- **Fix direction:** track explicit dismissed/open state until the trigger
  changes; show path/tags and highlights; give “No matches” and optional “Create
  node” actions; prohibit invalid manual ids for constrained refs.
- **Owner:** **i1-editor** for the inline trigger, **i5-polish** for shared popup
  and constrained ref semantics.

#### R7-26 — references lack mention context and navigation cues

- **Evidence:** backlink query data is reduced to source id/text/tags and a
  shallow row (`components/outline/references-section.tsx:19-36,48-55,78-109`).
  It does not show the source path, where in the text the mention occurs, sort,
  grouping, or an empty-state explanation.
- **Fix direction:** show highlighted mention snippets plus compact breadcrumbs,
  group multiple contexts by source, sort by recent/path, and add a collapse
  affordance for long lists.
- **Owner:** **i5-polish** (query changes are unnecessary for the first pass).

#### R7-27 — toast and failure feedback is technically worded and inaccessible

- **Evidence:** toast kinds are only error/info and auto-expire at six seconds
  (`stores/ui.store.ts:4-7,54-60`). They render as unlabeled dismiss-on-click
  buttons without an ARIA live region (`components/App.tsx:55-77`). Guidance
  such as “select a frame first” goes through the error-only `toast()` shim;
  WebSocket copy is `ws <code>: <message>` (`api/live.ts:45-48`). Canvas create
  failures only log to console (`lib/canvas-api.ts:216-227`).
- **Fix direction:** shared status model with success/info/warning/error,
  `role=status`/`alert` live regions, title/body/action, explicit close, hover/
  focus pause, dedupe, and user-facing copy. Route every failed visible action
  through it.
- **Owner:** **i5-polish**.

#### R7-28 — visible developer controls/copy make the shell feel unfinished

- **Evidence:** normal Preferences exposes “debug fields / Show all fields
  (debug)” (`components/prefs/preferences-popover.tsx:113-127`); the command
  seed exposes “Debug: show all fields”; search results display raw ULIDs and
  `sys.*` ids (`command-palette.tsx:174-179`); Board exposes `view.group`.
- **Fix direction:** move debug controls behind a development/advanced toggle,
  replace ids with type/path metadata by default, and put ids in an inspect or
  copy affordance.
- **Owner:** **i5-polish**.

#### R7-29 — motion has no reduced-motion path

- **Evidence:** sidebar width, selection, chips, bullets, toggles, and smooth
  search jumps use transitions/`behavior:'smooth'`; no source contains
  `prefers-reduced-motion` or Tailwind `motion-reduce` handling
  (`components/sidebar/sidebar.tsx:139-143`; `stores/outline.store.ts:388-393`).
- **Fix direction:** a global reduced-motion media rule plus conditional instant
  scrolling; preserve color/state feedback when motion is disabled.
- **Owner:** **i5-polish**.

### P3 — useful finishing touches

#### R7-30 — command coverage is visibly incomplete

- **Evidence:** seeded global handlers cover add node/tag/field/query,
  preferences, expand/collapse, view mode/filter, but not New canvas, Pin/Unpin,
  Copy link/id, Rename, open Graph, attach file, or focus References
  (`lib/run-command.ts:19-120`). Context commands similarly stop at tag,
  structure, delete, view/filter, and query conversion
  (`node-command-palette.tsx:92-209`).
- **Fix direction:** add the missing high-frequency verbs only after R7-04
  unifies the command surface; include aliases/keywords and display shortcuts.
- **Owner:** **i5-polish**.

#### R7-31 — breadcrumbs are visually useful but semantically thin

- **Evidence:** breadcrumbs have no accessible label or `aria-current`, and
  each segment is capped at 12 rem with only a title tooltip
  (`components/outline/breadcrumbs.tsx:21-54`).
- **Fix direction:** label the nav, mark current page, offer an ellipsis menu for
  deep paths, and integrate it with the URL/history work in R7-07.
- **Owner:** **i5-polish**.

#### R7-32 — small empty states state facts but do not help users recover

- **Evidence:** global/node search says only “No matches”; queries say “No
  results”; schema says “None yet”; views can be blank. None offers query reset,
  create, clear filter, or learn-more actions
  (`command-palette.tsx:150-153`; `node-command-palette.tsx:378-381`;
  `query-results.tsx:114-135`; `schema-section.tsx:57-61`).
- **Fix direction:** give each empty state one relevant next action and preserve
  restrained Tana-level chrome.
- **Owner:** **i5-polish**.

## Cross-surface consistency summary

| Concept | Current behavior | Coherent target |
|---|---|---|
| Search/commands | ⌘S global, ⌘K contextual, header shows ⌘S | ⌘K unified search/open/commands; contextual scope inside it |
| Open a node | Search sometimes `jumpToNode`, sys/schema nodes `zoomTo`; refs/pins zoom; no URL | One documented open vs zoom modifier model, both reflected in history |
| Selection | List/Table/Cards use instance keys; query refs often navigate immediately; Board drag is pointer-only | Same selected/active styling and keyboard verbs in every view; refs state whether action edits source |
| View configuration | Modes and filters visible; group/display/page size hidden in props | One view-settings surface backed by the existing `sys.f.view.*` props |
| Errors | inline raw query error offline; live query global toast; canvas console; load raw page string | Inline error at point of action + shared accessible toast for global status |
| Floating UI | four independent outside-click/Escape/position implementations | One popover/dialog primitive with positioning, focus, and motion policy |

## Proposed i5-polish overnight wave

This is deliberately sized as one integration wave. It fixes the highest-value
UI-only paths and leaves data-model/history work with i1/i4.

### Ship in i5 (ordered)

1. **Navigation correctness (S):** Sidebar Home calls `zoomHome`, correct Home/
   pinned active state, zoom resets the main scroller, breadcrumbs gain
   `aria-current`. URL/deep-link persistence remains a follow-up if it cannot be
   completed without broad router churn.
2. **Query error presentation (S):** add subscription-id error delivery on the
   existing client seam, persistent inline error/retry, retain last-good rows,
   and remove query-specific raw WS toasts. Coordinate the small protocol seam
   with i4 if needed.
3. **Unified shortcut (S):** ⌘K opens Search and open; remove ⌘S interception;
   make contextual commands a section filtered by current selection. Update
   visible shortcut copy and tests together.
4. **View settings completion (M):** turn the existing gear into Group, Display,
   Sort, Filters, and Page size using existing mutations. Unconfigured Board
   opens Group by instead of showing `view.group`.
5. **Field/add flow (M):** contextual Add field picker with existing/new field
   options and typed initial value. Do not attempt the editor-level `>` trigger
   in this wave; hand that to i1.
6. **Search quality pass (M):** active-row scrolling, matched-span highlighting,
   breadcrumb/type context, and local recent-open weighting. Preserve the 50k /
   10 ms benchmark; defer sophisticated token scoring if it breaks the bar.
7. **Floating/focus primitive (M):** consolidate preferences, filters, and node
   palette on one flip/shift + focus-restore primitive; add `inert` to the closed
   sidebar. Global palette gets a focus trap.
8. **Shared accessibility fixes (S):** keyboard-operable TagChip, table sort
   buttons with `aria-sort`, labeled tag-color swatches, and composition guards
   in `EditableText`.
9. **Feedback/empty states (S):** accessible live-region toasts with friendly
   copy/actions, initial-load Retry, Board/Table/query/filter empty-state CTAs,
   and move debug controls behind Advanced.
10. **Regression verification (S):** component tests for Home-from-zoom, live bad
    EDN, Board configure CTA, ⌘K/⌘S, focus restore/inert, IME field Enter, palette
    scroll, and empty table. Run typecheck, full UI suite, build, and light/dark +
    narrow viewport manual smoke when a browser is attached.

### Explicitly defer from i5

- Undo/trash and the editor `>` trigger → **i1-editor**.
- Canonical `/node/:id` history/deep links if it requires navigation-state
  architecture rather than the small router seam → follow-up **i5-polish** task.
- Query parser completion metadata, field option nodes, and subscription error
  protocol changes beyond id routing → **i4-backend**.
- Touch/keyboard board DnD beyond an explicit “Move to column…” menu → follow-up
  **i5-polish** task.
- Backlink snippets/path grouping, pin ordering/recents, and advanced saved-query
  management → next polish wave after the primary flows above are stable.

### Acceptance bar

- A first-time user can create/name a tag or field, add a field to a node, switch
  a frame to Board, choose Group, and move a card without seeing a system id.
- ⌘K always means Search and open; ⌘S is not captured.
- Invalid EDN never leaves a spinner indefinitely and its error remains attached
  to the query until fixed/retried.
- Home always goes home; a closed sidebar has no tabbable descendants.
- Every opened dialog/popover is on-screen, Escape-closeable, and returns focus.
- Existing 264 UI tests remain green, new interactions have regression tests,
  and no light/dark or reduced-motion regression is introduced.
