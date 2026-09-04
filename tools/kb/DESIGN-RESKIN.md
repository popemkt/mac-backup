# kb reskin — nxus base + Tana improvements (rev 2)

## 0. Design invariants (govern this wave and every wave after)

Your two rules, made mechanical:

1. **Element identity invariance.** A node row, tag chip, or field row renders
   IDENTICALLY everywhere it appears — outline, References section, query results,
   ref-valued fields, config popovers, settings (Tana pic: outline nodes inside a
   settings input are normal-size node rows). Context may change the _container_
   (border, background, width), never the element. Enforced structurally: exactly
   ONE `<NodeRow>`, ONE `<TagChip>`, ONE `<FieldRow>` component exported from
   `components/outline/`, imported by every surface — no local re-implementations
   (today's chip is duplicated 5× in nxus; we do it once). Same for shared
   constants: border alphas, hover timings (75/100/150/200ms), popover anatomy.
2. **Pattern economy.** Few base patterns, reused: row, chip, field-row, floating
   popover, palette list. New UI = composition of these. A new pattern needs a
   reason the existing ones can't express — reviewers reject otherwise.

Scope rule from your annotation: **`apps/nxus-editor` is the only reference.**
nxus-core/gallery patterns (18 alt palettes, card radii etc.) are out.

Verdict on current UI: agreed, it regressed. W1 added _metrics_ (indent, row height)
but never replaced the old "warm paper" skin: body font is still the serif stack in
`index.css`, field values render as full-width bordered `<input>`s (the "lines
everywhere"), background is a radial gradient, content is full-span, and the right
NODE panel + Query tab are leftovers. Reskin is now **W8, before views (W7) and
viz (V-wave)**.

Source of truth: full design-system extraction from
`/Users/popemkt/jean/nxus/tana-gap-closer-claude-code-0b73` (`apps/nxus-editor`,
`src/styles.css` is the entire token file) + live app at :3001. kb ui is already
Tailwind v4 (`@tailwindcss/vite`), so the token block ports 1:1.

---

## 1. What gets adopted from nxus VERBATIM

### 1.1 Token sheet (replaces kb `tokens.css` palette + `index.css` body styles)

- Full `:root` + `.dark` oklch palettes (background/foreground/card/popover/
  primary/muted/accent/border/input/ring/sidebar/warning/success/info).
  Primary = warm amber `oklch(0.67 0.16 58)` light / `oklch(0.77 0.16 70)` dark.
- Radius scale: `sm 6 / md 8 / lg 12 / xl 18 / 2xl 16 / 3xl 26 / full`.
- **Opacity ladder as the color system** — everything is `foreground/N`:
  `85` body · `70` values · `50` secondary · `45` bullets · `35` field labels ·
  `25` placeholders · `10–[0.02]` fills and hairlines. No literal grays.
- Dark mode: `.dark` class on `<html>`, blocking inline script reading
  `localStorage['kb-theme']`, `prefers-color-scheme` fallback, cross-tab sync.
  Toggle = palette command + header button.
- Auto-hiding 6px scrollbar (`data-scrolling` + 1s idle timer).
- DELETE: serif font stack, radial gradient background, teal accent, legacy
  `--kb-*`/`--bg` bridge names.

### 1.2 Typography (exact values)

```
node text     14.5px / 1.6 / 400 / foreground-85     (empty: /25)
field label   14.5px / 1.6 / 500 / foreground-35     width 120px, truncate
field value   14.5px / 1.6 / 400 / foreground-70     (empty: "Empty" italic /25)
tag chip      11px   / 1.8 / 500 / bg tagColor@~9% + text tagColor, radius 6px
breadcrumb    13px / foreground-40 (hover /70)
zoom title    20px / 1.4 / 600 / foreground-90
section hdr   12px / foreground-30 / uppercase tracking-wide  ("References")
```

Font: **configurable — Outfit Variable (default, = nxus) or Inter (= Tana)**, both
self-hosted via `@fontsource-variable/*`, no CDN. Setting lives with theme (§1.8).

### 1.3 Row anatomy (all nxus numbers)

```
        ├─24px─┤├24┤4px
depth 0 │      │ ●  │ Node text at 14.5/1.6, foreground-85    ⟶ flex-1 ⟶  #tag #tag
depth 1 │      ┆    │ ● Child …                                          ↑
        │      ┆ ↑bullet: 24×24 hit, 6px radius,                chips right-aligned
        │      ┆  dot 4px (5px w/children) fg-40/50             to column edge —
        │      ┆← guide line: 1px @ depth*24+11,                load-bearing look
        │      ┆   fg-6% → 15% hover, 20px click strip,
        │      ┆   stops 8px short of bottom, click = collapse
```

- Rows: **zero vertical padding**, min-height 24px — rhythm from line-height only.
- **No hover background on rows.** Only bullet (`fg/5`) and guide line react.
- Selection: `primary/5` row + `primary/8` content (stacked tint). Editing: no bg,
  caret `foreground/70`.
- Bullet glyph variants (nxus has our W1 catalog already styled): dot / `#` supertag
  (11px bold fg-45) / magnifier query (14px) / dashed-circle ref (18px) / collapsed
  halo (18px disc fg-8% or tagColor@12%) + count badge (9px, `-right-1 -top-1`).
- Collapsed-with-tag: halo takes the tag color.

### 1.4 Fields inline — kills the bordered inputs

```
        │  ● Buy domain                                          #todo
        │      T  status      doing                    ← py-1 (4px), no border,
        │      T  due         Aug 12, 2026               no input box, value is
        │      T  notes       Empty                      editable text in place
           ↑icon  ↑label 120px ↑value fg-70; "Empty" italic fg-25
            13px   fg-35, 500
```

- Field row = flex, indented one step deeper than its node
  (`marginLeft = (depth+1) × --kb-indent`), type icon 24×24 slot at 13px
  fg-25, label 120px, value flex-1. Indent is space _before_ a row, never
  padding inside it — otherwise the hover separators (and a node row's
  selection fill and focus ring) paint across the indent gutter and over the
  guide lines. One owner: `packages/ui/src/lib/indent.ts`.
- Value editors become borderless contenteditable-style; boolean = 36×20 pill
  toggle; URL = primary underline; ref = chip (`primary/8` bg) or full node row.
- **Focus belongs to the gesture that created the slot, not to the slot being
  empty.** An unset field's slot exists so the field is editable without a
  gesture, so it renders as the quiet `Empty` placeholder and opens its editor
  when it _receives focus_; a slot minted by "+ value" is the continuation of
  that click and opens focused. `FieldValueStack` is the only component that
  knows which is which, so it threads that one boolean (`autoOpen`) down to the
  editors that have an open/closed state (ref, date). Deriving it inside the
  editor from "is my value empty?" is what made every unset option field on a
  page mount open, with several `autoFocus` inputs fighting each other and
  outline keyboard navigation for the caret.
- Remove-field ×: hidden until row hover (opacity-0 → 100).
- `>` at line start = add-field flow (Tana affordance, nxus has it too).

### 1.5 Layout — shell rewrite

```
┌──────────────────────────────────────────────────────────────────────┐
│ kb   ⌘K search               rev · live                   ◐ theme    │ 44px, hairline
├──────────────────────────────────────────────────────────────────────┤
│              ┌────────────── max-w 768px, centered ─────────────┐    │
│              │ ⌂ Home / Project                    (breadcrumb) │    │
│              │                                                  │    │
│              │ Zoomed title 20px/600            #tag            │    │
│              │  ● node …                              #todo     │    │
│              │  ● node …                                        │    │
│              │      T status   doing                            │    │
│              │  ● node …                                        │    │
│              │                                                  │    │
│              │ REFERENCES (3)          ← inline, replaces panel │    │
│              │  ● backlink row …                                │    │
│              │            (160px bottom runway)                 │    │
│              └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

- **DELETE right NODE panel.** Fields already inline; backlinks become inline
  "References (N)" section at bottom of zoomed view (nxus pattern); tag add/remove
  moves to chip interactions (hover ×, autocomplete popover) + palette.
- **DELETE Query tab.** Query nodes + palette cover it. Saved queries stay reachable
  as `sys.query.*` nodes.
- Zoomed root: title row + tag-colored radial _wash_ (no border), fields at
  depth −1, children below.
- Floating surfaces only: command palette (`max-w-520, rounded-xl, shadow-2xl,
backdrop black/30, pt-15vh`), tag-config popover (`w-320, rounded-lg, shadow-xl,
border fg/10`), dropdowns. All borders `foreground/10`.

### 1.6 Borders policy

Hairlines (`fg/[0.03]–/10`) only at container boundaries: top bar, floating
surfaces, table row separators. **Never on node rows, never on field values.**
Everything else = background shifts (`fg/[0.02]–/12`) and spacing (`pb-40` runway,
`bottom-2` guide stop, `py-1` field rows, `mt-3 mb-1` References block).

### 1.7 Settings surface (new — from your font annotation)

Device-level preferences: **theme** (light/dark/system) · **font** (Outfit/Inter) ·
**width** (centered 768px / full). Stored in `localStorage['kb-prefs']` (device
concern, not repo data — `.kb/nodes.jsonl` is committed and shared).

UI consistency per invariant #1: settings open as a floating popover (same anatomy
as tag-config: `w-320 rounded-lg border-fg/10 bg-popover shadow-xl`) whose rows ARE
`<FieldRow>` components — label 120px fg-35, value as select/toggle in the same
borderless value style. Settings look like editing a node's fields, because that is
the only field pattern in the app. Reachable via palette (`Preferences…`) + header
theme button. Every pref applies instantly, no save button.

```
 ┌─ Preferences ──────────────────────┐
 │  ◐  theme       system ▾           │   rows = FieldRow, exact same
 │  Aa  font       Outfit ▾           │   metrics as outline fields
 │  ⇔  width      centered ▾          │
 └────────────────────────────────────┘
```

Width modes (2, confirmed): `centered` = max-w 768px (default) · `full` = fluid
with 32px gutters. Palette commands `Toggle width` / `Toggle theme` too.

### 1.8 Tag colors

Deterministic 12-color hash (djb2 % 12: red orange yellow green teal cyan blue
violet fuchsia pink indigo emerald). Chip bg = hex + `18` alpha. Tana improvement:
tag node may carry explicit `color` prop (ref: field on `sys.tag` template) —
overrides hash. Bullet dot + collapsed halo inherit tag color.

---

## 2. Tana improvements layered on top (small, deliberate)

1. **Tag `color` prop** overriding the hash (Tana lets you pick chip colors).
2. **Field type icons** by value type (str/num/date/ref/bool) in the 24px icon slot.
3. **Breadcrumb path always visible** in zoomed view (Tana: `H / Daily / Week 30`).
4. **`>` add-field affordance** documented in empty-state hint (Tana toast pattern).
5. NOT adopting: journal/day template (you said no journal), banners, credits UI.

---

## 3. Execution

**W8a — tokens + shell (claude worker):** styles.css port (light/dark/@theme),
Outfit + Inter font packages, blocking theme script, `kb-prefs` store (theme/font/
width), Preferences popover + palette commands, shell rewrite (kill panel + Query
tab, centered/full column modes, 44px header, theme button), References inline
section, palette restyle. Old `tokens.css`/`index.css` replaced wholesale.

**W8b — rows + fields + chips (cursor worker, after W8a merges):** the ONE
`<NodeRow>` / `<TagChip>` / `<FieldRow>` set (invariant #1) consumed by outline,
References, query results, ref values, Preferences; bullet/guide restyle to nxus
spec; field rows → borderless inline editors (biggest diff: replace input-styled
`PropValueEditor` display path); tag color hash + color prop; selection states.

Both waves: existing 88 UI tests must pass (update assertions), `bunx vp build`,
screenshot diff vs :3001 nxus before merge (playwright --channel=chrome), cavecrew
review, merge. Then W7 views (cards/table/board — can lift nxus `kanban-view.tsx`/
`table-view.tsx` styles verbatim), then V-wave. Views plan + V-wave plan from
previous doc unchanged otherwise.

Token-discipline test (your nxus complaint): unit test greps built CSS/components
for pixel font-size literals outside the §1.2 whitelist — new sizes need a
whitelist edit, which reviewers see.

---

## 4. Resolved choices (your rev-1 annotations)

1. **Font**: configurable Outfit/Inter via Preferences popover (§1.7). Default Outfit.
2. **Width**: 2 modes — centered 768px default + full-width, in Preferences + palette.
3. **Alt palettes**: cut. `apps/nxus-editor` is the only reference; light/dark only.
4. **Design invariants** (§0) now govern all waves — one NodeRow/TagChip/FieldRow
   everywhere, pattern economy, container-not-element changes per context.
5. **Node panel**: deleted outright (no annotation objection; backlinks → inline
   References, tags → chip interactions, props → inline fields, settings → §1.7).
