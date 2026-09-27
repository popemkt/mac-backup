# Field value UX: one slot grammar for every type

Research note, 2026-09-28. Scope: how kb's inline field values display, edit,
follow and grow, compared with other tools; a recommended interaction model;
and a restructure-first implementation plan.

**Adopted.** The normative text is
[`tools/kb/DESIGN-UI.md` → Field values: one slot grammar](../../../tools/kb/DESIGN-UI.md#field-values-one-slot-grammar),
which also names what was not built. This note is the reasoning behind it and
is not kept in step with the code; where the two differ, DESIGN-UI.md is live.
The open question in §5 (text) was decided: a `[[ref]]` in a text value is a
mention.

## 1. Current state (code as of `e2fde385`)

Where things live:

- `packages/app/ui/src/components/outline/field-value.tsx` has the editor
  registry `FIELD_EDITORS: Record<FieldType, FieldEditor>` (icon + `Editor`),
  `FIELD_ID_EDITORS` (per-field override, only `sys.f.color`), `PropValueEditor`
  and `EmptyTypedEditor`.
- `components/outline/fields-section.tsx` has `FieldValueStack`, which renders
  one field's values, the hover "×" per value and the "+ value" button, and
  `FieldsSection`, which renders one `FieldRow` per prop under a node.
- `components/outline/field-row.tsx` has `FieldRow` (type glyph, 120px label,
  value slot, hover-revealed remove-field button).
- `components/outline/table-view.tsx` (`TableCellField`) and
  `components/outline/board-cards-view.tsx` each have **their own copy** of the
  "values → one editor each, or one empty editor" loop. Neither has remove or
  add. This is a mirror of `FieldValueStack`, which Rule 1 forbids.

Behaviour by type:

| Type | Display | Enter edit | Click | Keys while editing | Empty | Validation / format |
|---|---|---|---|---|---|---|
| text | plain string, `text-foreground/70`, **no markdown** | click → contentEditable, caret at **end** (node text now lands at the click point) | edit | Enter commits (blur), Esc reverts, every key `stopPropagation` | CSS `:empty::before` placeholder | none |
| url | same editor as text, underlined in primary colour, but **not a link**: no `<a>`, no href | click → edit | edit only, so there is no way to open it | as text | as text | none: no scheme check or normalisation. `isSafeHref` exists in `lib/md-inline.ts` but is unused here |
| number | raw `String(v)` | click → edit | edit | as text | placeholder when `t !== "num"` | `Number(text)`. NaN is **silently dropped** and the old value stays with no feedback. No locale grouping or decimal handling |
| date | `toLocaleDateString("en-US", …)` (hard-coded locale) | click → native `<input type=date>` | edit | native control. Blur closes | placeholder | `new Date("YYYY-MM-DD")` parses as **UTC**, so west of UTC it shows the previous day. No natural language. Two stored carriers (`str`/`date`, GAP `01M39X7NQV187BDQVGH81997M5`) |
| checkbox | 36×20 **toggle switch** | n/a | toggles | n/a | shows off | n/a |
| ref | resolved: a `NodeRow` (bullet + target text + tag chips). Unresolved: chip. Unset: focusable placeholder | click the text or the row → `RefSearch` picker | text or row click **opens the picker**. Bullet **plain** click **navigates** | picker: arrows, Enter picks, Esc cancels. Free text commits as an id | `EmptyRefSlot` opens on focus | allowed set via `refSearchOf`. Server does not check targets (GAP `01M39YM7FQ9S231XW8JBA5MG0E`) |
| options (ref field whose targets are its own children) | same as ref: a full bulleted row per option | as ref | as ref | as ref | as ref | as ref |
| `sys.f.color` | swatches + hex input, always open | n/a | picks | Enter blurs | n/a | hex regex |

Multi-value and "+ value":

- Props are multi-valued, and cardinality defaults to `many` (`cardinalityOf`
  in `packages/domain/model/src/field-type.ts`: absent ⇒ many). So **almost
  every user field shows "+ value"**.
- The button is its own flex row under the values, `opacity-0` until the field
  row is hovered. It is invisible but **always takes up its line**, which is
  the extra line per field the user sees.
- Clicking it adds a pending slot with `autoOpen`. Enter in a text slot
  commits and blurs. Nothing ever creates the next value from the keyboard.
- A value can only be removed by the hover "×", which has no keyboard path.

Keyboard integration: none. Field values are not part of outline navigation.
Arrow keys never move from a row into its fields. Textual values have no
`tabIndex` at rest, so they are not Tab stops. Only the empty ref slot is.

Inconsistencies with the recent row conventions:

- **697373f9**: on rows, a bullet plain click toggles and ⌘-click opens. A ref
  **value**'s bullet navigates on a *plain* click, so the same glyph means two
  different things.
- **e2fde385**: node text is one live-preview surface, a click lands at the
  point, and `routeInlineClick` (`lib/md-edit.ts`) lets a `[[ref]]` pill or a
  markdown link keep its click (it follows) in both read and edit state. Field
  text has none of this: no markdown, no refs, caret always at the end, and a
  url value never follows.

## 2. How other tools do it

| Tool | URL value | Ref / relation value | Options | Date | Number | Add another value |
|---|---|---|---|---|---|---|
| **Tana** | stored as a link. **⌘/Ctrl-click opens** (plain click edits) [3] | value is a bulleted node reference, same as any reference row | dropdown of the field's option nodes. Auto-collect adds new ones [1] | Space or `@` opens the date picker. Click changes it, right-click offers "go to day node" [1] | min/max validation [1] | values are child nodes of the field. Option/instance multi-select goes through the picker, and a community guide warns that Enter-then-type "doesn't work that way" [2] |
| **Notion** | "opens the link in a new tab when clicked" [4]. From memory, not in the docs: in page view, hover shows edit/copy buttons; in table view, the cell edits and a hover arrow opens | relation picker, a multi-step flow [4]. A page chip click opens the page | "typing … and pressing enter after each" [4] | picker with end-date/time toggles [4] | typed directly. Format set per property | in-picker Enter keeps the menu open. No "+" row |
| **Airtable** | "Clicking on a URL will bring you to that URL" [5]. Cell selection comes first (grid model) | linked record chips. A chip opens the record. From memory: a "+" in the cell adds one | type + Enter, picker stays open | picker | formatted per field | inside the cell's picker |
| **Obsidian properties** | text values render URLs and `[[links]]` [6] | `[[link]]` in list | list type: one value per line [6] | date doubles as a daily-note link [6] | "must always be a literal number" [6] | list pill input (Enter adds a pill, from memory). Keys: ↓/Tab next property, ↑/Shift-Tab previous, → edits the value, Alt-↓ jumps to the editor [6] |
| **Logseq DB** | url type "limits text to only allow urls" [7] | node type, `:many` cardinality [7][8] | choices in a value chooser | picker, **keyboard-first**: arrows move days, Tab focuses the input, natural language ("next week") [7] | stored as numbers for sorting [7] | multiple values allowed for every type **except checkbox and datetime** [7]. The chooser stays open for many |
| **Anytype** | Email/Phone/URL have a special format [9]. From memory: an open-link button beside the value | Object property. Clicking the object opens it | Select / Multi-select, "no limit" [9] | date with optional time [9] | plain | in the picker |
| **Capacities** | URL "you can open or copy to clipboard" [10][11] | Object Select dropdown, single or multiple, fixed sets [11] | Label property, single or multi [10] | Datetime, range optional [10] | formatting options [10] | in the dropdown |
| **Linear** | n/a | picker from a keyboard shortcut (`L` for labels) or by clicking the property [12] | one per label group [12] | picker | n/a | multi-select inside the picker |

What they agree on:

1. A value that **points somewhere** (url, relation, object) follows on a click
   **on its own text**. Editing happens beside it, through a keyboard path or a
   modifier. Tana is the exception: there, plain click edits and ⌘-click follows.
2. Nobody uses a click-then-choose popover as the *primary* gesture for a url.
   Where Notion and Anytype show extra buttons, they appear on hover as
   secondary actions.
3. Nobody reserves a permanent "+ add" line per multi-valued property. Adding is
   **Enter-to-add** for typed values and a **picker that stays open** for
   choices.
4. Checkbox and date-time are single-valued by nature (Logseq enforces it).

## 3. Evaluating the "click → Open / Edit toolbar" idea

It does solve discoverability, but I recommend against it as the primary gesture:

- **Every action costs two clicks.** Opening, the most common action on a url,
  needs two clicks, and so does editing.
- **It is a bespoke widget for one type.** Rule 1 and "everything is a node"
  name this as the signal of a wrong model. The same choice (follow or edit)
  exists for refs, options, dates and links inside text. A url-only popover
  would be a second mechanism for a distinction that node text already
  resolves with `routeInlineClick`.
- **It hides what a real `<a href>` gives for free:** the browser status-bar
  preview, middle-click, ⌘-click to a background tab, and the native context
  menu ("Copy link").

Keep one piece of it: a hover affordance for the *secondary* verb, placed
inline at the end of the value so it takes no extra line (§6).

## 4. Recommended model: one value slot, three verbs

A **value slot** is one value of one field. Every slot, of every type,
answers the same three verbs with the same gestures. A type contributes only
**data**: how it renders, which editor it uses, what it follows to, how it
parses and formats, and how it adds.

| Verb | Mouse | Keyboard (slot focused, not editing) | Keyboard (editing) |
|---|---|---|---|
| **Follow** (open url, navigate ref/option, go to day node) | plain click **on a pointer segment** (link text, ref label, option chip), the same rule as node text (`routeInlineClick`). ⌘/Ctrl-click **anywhere** on the slot, which matches bullet ⌘-click | ⌘Enter | ⌘Enter |
| **Edit** | plain click **anywhere else** in the slot (the trailing space, the plain text, the slot of an empty value). For textual types the caret lands at the click point, as in node text | Enter, or start typing (typing replaces the value for picker types) | n/a |
| **Add** (many-fields only) | inline "+" at the end of the last value, shown on hover or focus. It takes no line of its own (§6) | Enter on the last value (§6) | Enter at the end commits and opens the next slot |

Common keys:

- **Esc** while editing reverts and leaves the slot focused. Esc again selects
  the owning row. This mirrors row edit → row selection.
- **Tab / Shift-Tab** move to the next or previous value slot, then to the next
  field, then back to the row. Indenting is meaningless inside a value.
  Obsidian uses the same keys [6].
- **↑ / ↓** (not editing, or at the first/last line) move between slots and
  rows. This joins field slots to outline navigation: ↓ from a row's text goes
  to its first field value, as Tana and Obsidian do.
- **Backspace on an empty slot** removes that value and puts the caret at the
  end of the previous value, which is the row merge gesture. The hover "×"
  stays as the mouse path.
- IME: keep today's composition guard for every commit key.

Why this is one model and not a set of cases:

- **Follow** is one function, `follow(target)`: a ref goes to `zoomTo`, a url
  goes to `window.open(href, "_blank", "noopener")`. Node-text pills, markdown
  links, bullets and value slots all call it.
- Plain-click-follows applies only to the pointer segments that already follow
  in node text. So after this change, **a link looks and behaves the same
  wherever it appears in kb**, and ⌘-click follows everywhere, the same as the
  bullet.
- A value slot is a pointer or a scalar. It is never a row's content. That
  explains the one deliberate difference from 697373f9's referenced rows: a
  *row* shows its target's text, so a click edits that text; a *ref value*
  holds a pointer, so editing it means choosing another target. Renaming the
  target is done where the target is shown as a row (expand the value, or
  follow it).

## 5. Per-type spec

The columns are the registry's data. "Slot grammar" (§4) is shared by all.

### text

- **Display:** rendered through the same inline tree as node text
  (`inlineNodes` / `InlineMarkdown`), so `**b**`, links and `[[ref]]` pills
  show and follow.
- **Edit:** live preview as in node text, caret at the click point.
- **Follow:** only the inline pointer segments.
- **Empty:** faint field-name placeholder.
- **Multi:** Enter at the end adds the next value. Shift+Enter is a soft break
  inside the value.
- **Open question:** a `[[ref]]` inside a *str* prop does not produce
  `:node/mentions` today (only node text and `{t:"ref"}` values do). Either
  extend the mention extraction or render such refs without the backlink
  promise. Decide before shipping, and file a `#gap` if deferred.

### url

- **Display:** a real `<a href>` link segment. The label is a shortened form
  (host plus a truncated path, `max-w` about 60% of the slot) so there is
  always trailing space to click. The full URL is in `title` and the status bar.
- **Edit:** click beside the link, or Enter. Editing shows the raw URL.
- **Follow:** plain click on the link, ⌘-click anywhere, or ⌘Enter. Opens in a
  new tab with `noopener`.
- **Secondary:** native context menu (a real anchor), plus the hover inline
  "copy" glyph if wanted, which takes no line.
- **Validation:** `normalizeUrl` lives in `@kb/model`, beside
  `parseFieldValue`, so the CLI, MCP and UI agree. It trims, adds `https://` to
  a bare domain (`example.com/x`), and keeps `mailto:`. It rejects schemes
  outside the `isSafeHref` allowlist: the value is not committed, and the slot
  keeps the text and shows the existing mismatch warning. It never drops input
  silently.
- **Paste:** pasting a URL into an empty slot commits it. Pasting several lines
  into a many-field splits them into values.

### number

- **Display:** `Intl.NumberFormat(navigator.language)` with grouping and
  `tabular-nums`. Later, a format option set (plain / percent / currency) is
  modelled as option **nodes** under a `sys.f.number.format` field, never as a
  UI setting.
- **Edit:** shows the raw number with no grouping.
- **Parse:** accepts the locale decimal separator and strips grouping and
  spaces. Invalid input stays in the slot with a mismatch outline and is not
  committed. Esc reverts. This replaces the current silent drop. Honour
  min/max if the field declares them (Tana [1]); those are field props, which
  are nodes.
- **Keys:** no ↑/↓ increment, because arrows are outline navigation.

### date

- **Display:** locale-aware, relative near today ("Today", "Tomorrow",
  "Mon"), "Sep 28" within the current year, and with the year otherwise. Parse
  `YYYY-MM-DD` as a **local** date to fix the off-by-one.
- **Edit:** a text input with natural-language parsing ("next fri", "in 3
  days") and a live preview, plus a calendar popover under it. The calendar is
  keyboard-first, as in Logseq [7]: arrows move days, and Enter commits the
  preview.
- **Follow:** ⌘-click goes to the day node **only if kb has one**. Otherwise
  there is no follow, and nothing is invented.
- **Model:** close the two-carrier GAP (`01M39X7NQV187BDQVGH81997M5`) first,
  so there is one stored shape. Time and ranges are later additions as data.

### checkbox

- **Display:** a checkbox, not a switch. Tana, Notion, Obsidian and Logseq all
  use a checkbox, and a switch reads as a device setting.
- **Edit:** the toggle itself. Plain click, or Space/Enter when focused.
- **Follow:** none. **Add:** none.
- **Model:** single-valued by type. State it in `@kb/model` (a type caps
  cardinality, as Logseq does [7]), not as a UI `if`.
- **Empty:** unset and false look the same (faint box).

### ref (open, targetTag or targetQuery)

- **Display:** keep the Tana-style bulleted row (bullet, target text, tag
  chips). The **bullet follows the row convention**: plain click expands the
  target's children inline, ⌘-click navigates. That fixes today's
  plain-click-navigates.
- **Label:** a pointer segment. Plain click navigates, the same as a `[[ref]]`
  pill.
- **Edit (replace):** click the slot beside the label, Enter, or start typing.
  This opens `RefSearch` seeded with the current label, all selected.
- **Remove:** Backspace on the selected, empty value, or the "×".
- **Unresolved:** keep the warning chip. Click it to re-pick.
- **Multi:** the picker **stays open** in many-fields. Enter picks and keeps
  the query open; picked items show checked, and toggling one unpicks it. Esc
  closes. This is Notion [4], Linear [12] and Logseq behaviour.

### options (a ref field whose targets are its own children)

- **Display:** an inline **chip** in the option node's `sys.f.color`, using
  the same chip renderer as tags (`TagChipGroup`). An option is a node with a
  colour, just like a tag, so no new widget is needed. Chips wrap horizontally,
  so a many-options field stays on one line.
- **Follow:** clicking the chip opens the option node. That page lists every
  node that holds the option, which is useful graph navigation and not a
  special case.
- **Edit:** click beside the chips, Enter, or typing opens the picker, which
  stays open for many.
- **Create:** typing a new name offers "Create option", which adds a child node
  under the field (the auto-collect of Tana [1]).
- **Note:** the "is this an option set" distinction is already data (the
  constraint fingerprint `c:` in `lib/field-type.ts`). The renderer choice
  (chip or row) is one registry column keyed on it, never an `if` at a call
  site.

### color (`sys.f.color`) and future types (email, phone)

- **color:** stays a per-field editor row. Its "edit" is the swatch grid shown
  in a popover on click, so at rest it is a single swatch and no longer always
  open.
- **email / phone:** these are url-like pointer types whose follow targets are
  `mailto:` and `tel:`. Each one is one registry row plus one `sys.ft.*` option
  node.

## 6. The "+ value" affordance

**Is it needed? Not as a line.** It costs a full row on every multi-valued
field, and nearly every field is multi-valued because of the `many` default.
No surveyed tool reserves a line. The job it does, adding the next value, is
better done by the gesture already in hand:

1. **Keyboard, typed types (text, url, number, date):** Enter at the end of a
   value in a many-field commits it and opens an empty slot directly below it.
   Enter on that **empty** slot closes it and returns to the row. This is the
   empty-list-item rule, so a mistaken Enter costs nothing. In a one-field,
   Enter only commits.
2. **Keyboard and mouse, picker types (ref, options):** the picker stays open
   after a pick in many-fields, so adding five tags is one open, five Enters
   and Esc. No "+" is involved.
3. **Mouse, discoverability:** a small "+" appears **inline at the end of the
   last value's line**, positioned in the trailing space so it has no layout
   cost. It shows on field-row hover or when a slot in the field has focus. For
   chip layouts, clicking the empty space after the last chip does the same
   thing.
4. **Empty field:** the single placeholder slot is enough. No "+" is shown.
5. **One-fields and checkbox:** no add affordance at all. Editing replaces.
6. **Hint:** the placeholder of a freshly added slot reads, for example,
   "Enter to add another · Esc to finish".

Tradeoff: hover-only affordances are weak on touch and for first-time users.
Enter-to-add is the outliner's own vocabulary, so a kb user already knows it.
The inline "+" is mouse-discoverable without costing space. The ⌘K node
palette can carry "Add value to <field>" for full keyboard coverage. Optionally,
revisit the `many` default per type in `@kb/model` (checkbox must be `one`;
date is probably `one`). That is a model decision, not a UI patch.

## 7. Implementation plan (restructure first, each step its own commit)

1. **refactor: one value stack for every surface.** Make `FieldValueStack` the
   only renderer of a field's values. `TableCellField` (`table-view.tsx`) and
   the card loop (`board-cards-view.tsx`) render it inside their `FieldRow`
   chrome, which already has `valueOnly` / `depth`. Deletes two mirrors.
   Behaviour note: table and cards gain remove/add. Either accept that, or pass the
   stack's existing `readOnly` input to keep them as they are.
   Touches `fields-section.tsx`, `table-view.tsx`, `board-cards-view.tsx`, and
   the stories in `catalog/`.
2. **refactor: the editor registry states data, and one `ValueSlot` owns the
   gestures.** Split `FieldEditor` into columns: `render` (display segments),
   `editor` (`caret | picker | toggle | calendar`), `follow(value) → target |
   null`, `parse` / `format`, and `adds` (`enter | picker | none`). A
   `ValueSlot` component owns focusability (`tabIndex`), click routing, and the
   Enter / Esc / ⌘Enter / Backspace keymap. Types stop owning click handlers.
   This must be behaviour-preserving, proven by
   `field-editors.characterization.test.tsx`, `ref-editor.test.tsx` and
   `ref-slot-focus.component.test.tsx`. Touches `field-value.tsx` and a new
   `value-slot.tsx` (or the slot inside `fields-section.tsx`).
3. **refactor: follow is one function.** Generalise `routeInlineClick`
   (`lib/md-edit.ts`) into a `follow` / pointer-segment module used by node
   text, bullets (`node-block.tsx`) and value slots. A url target is a new
   branch of the same function, not a new handler.
4. **feat: url values are links.** Render them as a link segment and add
   `normalizeUrl` in `@kb/model` (`packages/domain/model/src/field-type.ts` or
   a sibling module), used by `parseFieldValue`
   (`packages/application/operations`) and the UI. Add a contract test so the
   CLI, MCP and UI agree.
5. **feat: text values render and edit as inline markdown.** Reuse
   `inlineNodes` / `NodeTextHost`, and resolve the str-prop mention question
   first (file a `#gap` if deferred).
6. **feat: typed formatting.** Number `Intl` display and locale parse with
   visible rejection. Date local parse, relative display, NL input and a
   keyboard calendar. Close the date-carrier GAP first. Checkbox visual.
   Option chips via the tag chip renderer.
7. **feat: field slots join outline navigation.** The outline store's visible
   list gains field slots, so ↑/↓/Tab reach them. Touches `outline.store.ts`,
   `editing-keymap.ts`, `use-node-keydown.ts` and `use-selection-keymap.ts`.
   This is the largest step, and it can ship after steps 1–6.
8. **feat: adding a value is Enter or the picker.** Delete the "+ value" row.
   Add Enter-to-add in the `ValueSlot` keymap, multi-pick `RefSearch`, the
   inline hover "+", and the palette command.
9. **docs:** add a "Field values: one slot grammar" section to
   `tools/kb/DESIGN-UI.md` as the canonical statement, link it from here, and
   add `#rule`/`#gap` nodes for any deferral.

## Sources

1. Tana, Fields: https://outliner.tana.inc/learn/features/fields (redirect from https://tana.inc/docs/fields)
2. Dee Todd, "Intro to Tana Fields": https://deetodd.substack.com/p/intro-to-tana-fields
3. Fis Fraga, Tana keyboard shortcuts (⌘/Ctrl-click opens): https://medium.com/@fisfraga/work-faster-than-ever-in-tana-with-speedy-keyboard-shortcuts-e05397893552
4. Notion, Database properties: https://www.notion.com/help/database-properties
5. Airtable, URL field: https://support.airtable.com/docs/url-field
6. Obsidian, Properties: https://obsidian.md/help/properties
7. Logseq, DB version docs: https://github.com/logseq/docs/blob/master/db-version.md
8. Logseq property system (cardinality): https://deepwiki.com/logseq/logseq/3.2-property-system
9. Anytype, Properties: https://doc.anytype.io/anytype/llms-full.txt (section "Properties")
10. Capacities, Properties: https://docs.capacities.io/reference/properties
11. Capacities, Object properties: https://docs.capacities.io/reference/object-properties
12. Linear, Labels: https://linear.app/docs/labels

Items marked "from memory" in the table above are observed product behaviour
that the cited docs do not state. Verify them before quoting them as fact.
