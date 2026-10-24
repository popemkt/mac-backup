# bb theming and micro-interactions: feasibility and design ("bb-lively")

Date: 2026-10-24. Status: research and design only. Nothing was built or installed.

Versions inspected:
- bb server and web app on shared-server: `bb-app` 0.46.1, at `~/.local/lib/node_modules/bb-app`.
- bb Desktop on this Mac: `/Applications/bb.app`, version 0.47.0. Its frontend lives in `app.asar` and was not unpacked.
- Plugin SDK types: `@get-bb/plugin-sdk` 0.6.49, read from the bbim worktree at `.claude/worktrees/agent-a6d21bbdef21dbbc4/assets/bb-plugins/bbim/node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts`. Below this is called **SDK**.
- The `bb-plugin-authoring` skill references. Below these are called **skill/<file>**.
- bb's built-in `bb-theme-authoring` skill, which ships inside the built-in `theme-preview` plugin.

The active theme is currently `dracula` (`bb theme show`), and no custom themes exist (`~/.bb/theme` is empty on shared-server).

Sources:
- The typeui catalogue at https://www.typeui.sh/micro-interactions sits behind a Vercel bot checkpoint. It was read with a headless browser.
- It lists **113 patterns in 11 categories**.
- The implementation prompts are paywalled ("Unlock prompt"), so each pattern below is described from its name and its live demo.

---

## 1. What bb supports

### 1.1 Theme plugins: `bb.themes` in the manifest (supported; the main token hook)

**How a plugin declares a theme**
- A plugin declares `"bb": { "themes": [{ id, name, description?, css: "./themes/x.css", codeTheme? }] }`. bb lists it in Settings → Appearance and in `bb theme list` as `plugin:<pluginId>:<id>`. Sources: skill/quickstart.md:47-53 and theme-preview `skills/bb-theme-authoring/references/plugin-themes.md`.
- Theme CSS lives independently of the plugin's UI lifetime: "Put app-wide selectable palette CSS in manifest `bb.themes` entries; theme CSS has an independent app-theme lifetime" (skill/frontend-core-slots.md:45-51).

**SDK schema evidence**
- `appThemeSchema` `{ customCss, faviconColor, resolvedCodeTheme, themeId }` (SDK:265-300).
- Plugin capability kind `theme` (SDK:9385).
- `pluginThemes[]` in `systemConfigResponse` (SDK:11064).
- `themeCatalogResponseSchema` (SDK:11110).

**Server behaviour** (`server/dist/start-server.js` on shared-server)
- `resolveSelectedTheme` asks `pluginService.readThemeCss(themeId)` first, then falls back to custom themes on disk (lines 186676-186689).
- `readThemeCss` reads the file and accepts it if it is at most `CUSTOM_THEME_CSS_MAX_LENGTH`, which is 256,000 characters (lines 210034-210043 and 17106).
- Custom themes on disk follow the same rule: `<dataDir>/theme/<name>/theme.css` (lines 185955-185990).
- **No content sanitizer was found, only a length cap.**

**Client behaviour** (`app/dist/assets/index-DLL4t6p_.js`)
- The resolved CSS text is written verbatim into `<style id="bb-app-theme">` in `<head>`. In the minified source: `c7="bb-app-theme"`, `function d7(){… document.createElement("style"); t.id=c7; document.head.appendChild(t) …}`, and `function u7(e){return ii(e.themeId)?Uue[e.themeId]:e.customCss??""}`.
- The built-in palettes are default, nord, dracula, solarized, gruvbox and catppuccin.

**Theme file contract** (bb-theme-authoring SKILL.md)
- Light values go in `:root, .light {}` and dark values in `.dark {}`.
- Only overridden tokens need declaring.
- Element-scoped blocks are allowed, for example `.dark .fixed.bg-sidebar {}`.
- Live reload happens while Theme Preview is open. Plugin themes need `bb plugin reload` after CSS edits.

**Light/dark** is a separate per-client setting: `classList.toggle("dark", mode === "dark")` in index-DLL4t6p_.js. The theme layers on top of it. Built CSS has 59 `.dark{…}` blocks.

**Limit:** only one theme can be active. A theme therefore cannot be the vehicle for a motion layer that should also work with dracula or nord.

### 1.2 Design tokens bb actually uses

Main stylesheet: `app/dist/assets/index-1BIQuOCf.css`, minified to one line, so evidence is by grep pattern. It is Tailwind v4 with shadcn conventions, using **326 distinct custom properties**.

| Group | Tokens |
|---|---|
| Palette anchors (theme skill) | `--canvas` `--ink` `--primary` `--sidebar` |
| Surfaces | `--card` `--popover` `--secondary` `--muted` `--surface-recessed-solid` `--surface-scrim` |
| Ink | `--foreground` `--muted-foreground` `--subtle-foreground` |
| Accent and state | `--surface-selected` `--state-hover` `--state-active` `--sidebar-accent` `--timeline-accent` `--file-accent` |
| Status | `--success` `--warning` `--destructive` `--pr-merged` `--diff-added` `--diff-removed` |
| Lines | `--border` `--border-hairline` `--border-seam` `--input` `--ring` |
| Type | `--font-sans` `--font-mono` `--font-terminal` |
| Shape | `--radius: .5rem` (`--radius-md`/`lg` derive from it) |
| Elevation | `--shadow-xs` … `--shadow-2xl`, `--shadow-lift`, `--shadow-color` and `--shadow-opacity`, all with light and dark variants |
| **Motion (token level)** | `--default-transition-duration: .15s` and `--default-transition-timing-function: cubic-bezier(.4,0,.2,1)`, **each referenced by 31 rules** (every Tailwind `transition-*` utility); `--ease-out`, `--ease-in-out`, `--animate-pulse`, `--animate-spin` |
| Layout chrome | `--bb-app-chrome-row-height`, `--bb-sidebar-control-size`, … |

The motion tokens are the useful discovery. A theme that sets `--default-transition-duration` and `--default-transition-timing-function` retimes every hover and colour transition in bb with **zero selectors**.

The tw-animate `enter`/`exit` keyframes (menus, popovers, dialogs, `data-motion` slides) read `--tw-duration` and `--tw-ease`. Those are per-element and not inherited, so they cannot be retimed from `:root`. They need class or attribute selectors.

Existing keyframes:
- `accordion-down`/`up`
- `bb-count-flash`/`roll-in`/`roll-out`
- `bb-hero-*`
- `bb-search-flash`
- `bb-settings-search-flash`
- `caret-blink`
- `enter`/`exit`
- `indeterminate-progress`
- `pulse`, `spin`
- `ultracode-shimmer`/`sparkle`

### 1.3 Reduced motion

bb's CSS has only **7** `prefers-reduced-motion` rules:
- `.prompt-ultracode-highlight`
- `motion-safe:animate-pulse`
- `motion-reduce:animate-none`
- `.animate-indeterminate-progress`
- `.bb-search-flash`
- `.bb-count-roll-in`
- `.bb-hero-chip`

The generic tw-animate `enter`/`exit` and the 31 transition utilities are **not** gated.

**There is no in-app reduced-motion setting.** `reducedMotion` appears in the JS only as a prop of one onboarding/hero component. A plugin has to bring its own setting and also honour the system preference.

### 1.4 Frontend extension points relevant to appearance (SDK)

| Hook | What it gives | Evidence |
|---|---|---|
| `app.contentScripts.register({ id, mount })` | Full-trust same-origin script, mounted once per window per generation. **The documented place for "styling or decorating existing app-shell DOM"**. It may create `<style>` nodes but must remove everything on abort. | SDK:20670-20711; skill/frontend-core-slots.md:3-58 |
| `ctx.experimental_setThreadRowStatus(threadId, { icon, label, tone })` | Decorates a sidebar thread row. **`tone: "running"` gets the host's animated shimmer**; `success` and `error` are static. | SDK:20684, 21000-21013 |
| Imported `app.css` | Plugin stylesheet, live only while a slot, panel or content script of the plugin is active. "Not an app-wide CSS hook." | skill/frontend-core-slots.md:45-51 |
| `slots.experimental_appOverlay` | App-wide React owner with no props. Can call app-level hooks such as `experimental_useSidebarThreads` and `useSettings`. bbim uses it to sync settings. | SDK:18623-18629, 19085-19089, 20575 |
| `app.composer.customize({ actions, banners, … })` | Components mounted in each composer, where `useComposer()` exposes `onSubmitted(listener)`, a **supported "message sent" signal**, and `setTextEffect({ className })`, a **host-applied class on the composer text**. | SDK:20826-20850, 21107, 21115 |
| `experimental_useSidebarThreads()` | Live thread list with indicators: `runtime`, `waiting-for-input`, `unread-success`, `unread-error`, `workflow`, … | SDK:21830, 19374 |
| `slots.experimental_threadList` | **Replaces** the whole sidebar thread list. It can draw `experimental_ThreadStatusGlyph`. This gives full control of row motion at the cost of reimplementing the list. | SDK:20594-20599, 19714-19733 |
| `experimental_timelineRenderer`, `messageDirective`, `experimental_codeFenceRenderer`, `messageAction` | Render **only the plugin's own** rows, directives or fences. They cannot restyle bb's message rows. | SDK:20598-20660 |
| `experimental_useCodeTheme()` / `PluginCodeThemeData` | Read-only VS Code theme document for embedding editors. **Not a styling hook.** The skill says not to approximate the palette from `--canvas`/`--ink`. | SDK:19603-19645; skill/frontend-hooks-and-ui.md:142-156 |
| `experimental_icons.register` | Shadows built-in icon names app-wide, so an animated SVG icon is possible. | SDK:20748-20770 |
| Plugin settings (`string`, `boolean`, `number`, `select`) | Host-rendered settings form, with one descriptor per effect. | SDK:22448-22480 |
| Tailwind in plugin builds | Host token classes compile against live variables; `tw-animate-css` utilities are available. Hard-coded colours are disallowed. | skill/frontend-hooks-and-ui.md:303-309 |

**Not available:**
- motion or theme tokens in the SDK;
- a reduced-motion context;
- a public toast API with animation control;
- a "turn started/finished" frontend event (only polling `useSidebarThreads` indicators);
- semantic attributes on sidebar rows (thread id or indicator).

### 1.5 Which bb DOM hooks are stable enough to target

Fragility ratings used below:
- **L**: supported API or design token.
- **M**: semantic `data-*` attribute or `bb-*` class written by hand in bb, or a third-party library attribute (Radix, sonner, vaul).
- **H**: Tailwind utility classes, DOM shape, text, or hashed chunk names.

| Selector | Meaning | Rating |
|---|---|---|
| `[data-promptbox-submit-action]` | Send button (and Stop, as `aria-label="Stop run"`). Carries `aria-busy`. | M |
| `[data-promptbox-shell]`, `[data-app-composer]`, `[data-app-composer-role=primary]`, `[data-follow-up-composer]`, `[data-promptbox-voice-active]` | Composer | M |
| `[data-timeline-row-id]`, `[data-timeline-row-list]`, `[data-message-column]`, `[data-thread-window]` | Timeline rows. **Virtualized**: rows remount on scroll. | M |
| `[data-sidebar=menu-button|menu-item|menu|content|footer]`, `.bb-sidebar-selected-row`, `.bb-sidebar-accent-row`, `.bb-sidebar-hover-actions*`, `[data-sidebar-dragging]`, `[data-last-hovered]` | Sidebar | M |
| `[data-sonner-toast].bb-app-toast`, `[data-swiping]`, `[data-swipe-out]`, `[data-expanded]`, `[data-front]` | Toasts (sonner) | M |
| `[data-state=open|closed|checked|on|delayed-open|instant-open]`, `[data-side]`, `[data-slot=popover-content]` | Radix menus, popovers, tooltips, switches | M |
| `[data-vaul-drawer]` | Compact-screen drawers | M |
| `[data-testid=route-navigation-indicator]`, `[data-testid=notification-row]`, `[data-testid=command-palette]` | Test ids. bb uses about 90; they are fairly stable but not a contract. | M |
| `[data-bb-portaled-overlay]`, `[data-bb-plugin-root]` | Overlay and plugin roots | M |
| `.dark` on the root element | Mode | L/M |
| Thinking/streaming line in the timeline | `activeThinking` renders with **no data attribute** (ThreadDetailView chunk) | H |
| Sidebar row thread id and indicator | Not in the DOM: no `data-thread-id` or indicator attribute | H (via `href`) |

---

## 2. Mapping the typeui patterns onto bb

Mechanisms:
- **API**: a supported SDK surface.
- **CSS**: a content-script CSS layer over the selectors and tokens above.
- **JS+CSS**: a content script that also watches the DOM (MutationObserver) to add transient classes.
- **Own UI**: possible only inside UI the plugin renders itself (panels, slots).
- **No surface**: bb has no such control.
- **Not possible**: the needed signal or exit hook does not exist.

### Buttons (27)

| Pattern | bb mapping | Mechanism | Fragility |
|---|---|---|---|
| Press | `button:not(:disabled):active, [role=button]:active, [data-sidebar=menu-button]:active` → `scale(.97)` in 90 ms | CSS | M (element selector; low risk) |
| Denied action shake | A disabled send button swallows clicks, so the shake would need a pointerdown on the disabled wrapper | JS+CSS | H |
| Toggle reaction state | No reactions | No surface | — |
| Swap state icon | Icon crossfade on `[data-state=on/off] [data-icon-root]`, e.g. split, sidebar or diff toggles | CSS | M |
| Reveal secondary actions | Already native in `.bb-sidebar-hover-actions*`; only retime it | CSS | M |
| Hold to confirm | Would need to intercept destructive host actions | Not possible for bb actions; Own UI | — |
| Fluid action button, Confirm reveal, Action slide-out, Roll / Wall / Slide-off reveal | Plugin-owned panels only | Own UI | L |
| Copy feedback | bb's own copy buttons swap icons; animating the swap means targeting the icon by structure | CSS | H; L in own `messageAction` |
| State morph (loading) | Send ↔ Stop on `[data-promptbox-submit-action]` keyed on `aria-busy` and `aria-label` | CSS | M |
| Refresh spin | `.animate-spin` already exists | — (native) | — |
| Undo countdown | See Toasts | CSS | H |
| Bounce dots, Dual ring, Bar wave | Replacing bb's spinners means structural selectors | Own UI (L); bb spinners H | — |
| Count ramp | bb already has `bb-count-roll-in/out/flash` | native; retime with CSS | M |
| Fill sweep, Upload progress, Multi-file upload | Composer attachments; no stable progress attribute | CSS | H |
| Slide bar | `[data-testid=route-navigation-indicator]` gets an eased indeterminate sweep | CSS | M |
| Shimmer | Sidebar row status `tone: "running"` (own statuses only); the timeline "thinking" line has no hook | API (L) / CSS (H) | L / H |

### Inputs (24)

| Pattern | bb mapping | Mechanism | Fragility |
|---|---|---|---|
| Focus (ring) | `:focus-visible` outline from `--ring`, with `outline-offset` 4px→2px over 120 ms; composer shell `:focus-within` glow drawn as a `::after` opacity fade | CSS + token | L/M |
| Auto-grow | The composer already grows. Animating its height is a layout animation and breaks the budget. | Excluded | — |
| Chip pop-in | Mention pills `.prompt-mention-pill`, attachment chips | JS+CSS | M (pill) / H (attachment) |
| Toolbar reveal | Promptbox compact/expanded controls (`[data-promptbox-expanded-only]`, `[data-promptbox-compact-label]`) | CSS | M |
| Filter-triggered suggestions | Mention/slash popover entry: Radix `[data-state=open][data-side]` | CSS | M |
| Typing feedback | `useComposer().setTextEffect({ className })` with a soft caret glow; the host applies the class | API | L |
| Invalid submit shake | The frontend gets no failed-send event (`onSubmitted` fires on success only) | Not possible (request) | — |
| Reveal toggle, Copy confirm, Prefix reveal, Suffix fade, Confirm delayed state, Clear fade, Segment fill, Counter tick, Ring drain, Strength fill, Count spring, Digit grouping, Mask fill, Build derived value, Inline validation, Offer inline correction, Confirm matching values, Reveal modifier warning | No such inputs in bb chrome (Settings fields are plain) | No surface; Own UI | — |

### Selection controls (24: checkbox 10, toggle 7, radio 6, plus the section header)

| Pattern | bb mapping | Mechanism | Fragility |
|---|---|---|---|
| Toggle switch thumb spring | Radix `button[role=switch][data-state]` thumb `> span`: translate with spring easing | CSS | M/H (thumb is structural) |
| Checkbox tick draw | Radix `button[role=checkbox][data-state=checked] svg`: stroke-dashoffset is paint-only | CSS | M |
| Animate completed item | Pending todos in the timeline; no stable hook | CSS | H |
| Icon toggle group | `[role=radiogroup] [data-state=on]` | CSS | M |
| Filter chips | Notification/sidebar filters, if any | CSS | H |
| Select-all cascade, Reveal contextual actions, Recalculate derived value, Enable dependent action, Update derived progress, Enforce selection threshold, Update selection summary, Reveal dependent content, Toggle visual layer, Change display density, Reveal dependent settings, Swap dependent timeline, Update masked preview, Update linked values, Move shared item, Swap dependent controls, Update option matrix, Rebuild dependent steps | Application logic, not a skin | No surface; Own UI | — |

### Modals (7)

| Pattern | bb mapping | Mechanism | Fragility |
|---|---|---|---|
| Dialog enter / exit | `[role=dialog][data-state=open]`: scale .96→1 plus opacity with spring easing. Exit is already tw-animate's `exit`; retime only. | CSS | M |
| Drag down to dismiss | Native through vaul on compact screens | native | — |
| Backdrop-click nudge, Block unsafe dismissal, Error shake, Confirm completed action | Radix dismisses on outside click; no "refused" signal | Not possible for bb dialogs; Own UI | — |
| Gate exact-match action, Hold to trigger action | Own UI only | Own UI | L |

### Drawers (4)

| Pattern | bb mapping | Mechanism | Fragility |
|---|---|---|---|
| Edge swipe open, Drag-linked backdrop | Native (mobile sidebar, vaul) | native | — |
| Collapse persistent panel | The sidebar collapse is a width change (layout). Leave it to the host. | Excluded | — |
| Expand shared surface | No hook | No surface | — |

### Tooltips (3)

| Pattern | bb mapping | Mechanism | Fragility |
|---|---|---|---|
| Warm delay group | Radix already uses `data-state=delayed-open` vs `instant-open`. Animate only `delayed-open` and make `instant-open` appear immediately; the delay values themselves are JS props. | CSS (partial) | M |
| Hover card, Link preview | Own UI only | Own UI | L |

### Toasts (3) plus the "toast spring" from the brief

| Pattern | bb mapping | Mechanism | Fragility |
|---|---|---|---|
| Toast spring | Override the sonner transition on `[data-sonner-toast].bb-app-toast` with `linear()` spring easing on `transform` | CSS | M |
| Swipe to dismiss | Native in sonner (`data-swiping`, `data-swipe-out`) | native | — |
| Promise toast morph | sonner `[data-type=loading → success]` icon crossfade | CSS | M |
| Undo countdown toast | bb's archive Undo toast. A countdown bar needs the toast duration, which is not exposed, and sonner pauses on hover. | CSS approximation | H |

### Step navigation (4)

Stepper progress, Block invalid advance, Return to completed step and Update remaining time all map to **No surface**. The only bb question forms are `pendingInteraction` (own UI only).

### Lists (7)

| Pattern | bb mapping | Mechanism | Fragility |
|---|---|---|---|
| Insert new list item | New timeline rows `[data-timeline-row-id]` and new sidebar rows: fade plus 4px rise | JS+CSS (seen-set, see §3.4) | M |
| Accordion | Retime `accordion-down`/`up` (Radix collapsible) | CSS | M |
| Drag to reorder / move between groups | Lift and shadow on the dragged row `[data-sidebar-dragging]` | CSS | M |
| Archive item with undo | Native Undo toast. A row **exit** animation is impossible because React unmounts the node at once and there is no exit hook. | Not possible (request) | — |
| Pin item to top | FLIP needs JS measuring rows | JS+CSS | H (skip) |
| Preview selected item | — | No surface | — |
| (Full control) | `experimental_threadList` replacement + `experimental_ThreadStatusGlyph` | API | L, but reimplements the list |

### Sliders (11)

Drag thumb, Stepped snap, Tooltip thumb, Tick highlights, Dual-thumb range, Before / after compare, Snap carousel, Rubber band overdrag, Scrubber preview, Magnetic detents and Update level icon all map to **No surface**. bb's panel resizers already snap (`data-panel-resize-snap-handle`). They are Own UI only.

### Cards (6)

| Pattern | bb mapping | Mechanism | Fragility |
|---|---|---|---|
| Hover lift (brief) | Homepage sections, resource-detail sections, notification rows: `translateY(-1px)` plus a shadow on a `::after` that fades in by opacity | CSS | M (`[data-resource-detail-section]`, `[data-testid=notification-row]`); H for generic `.rounded-lg.border` |
| Flip card, Expandable, Action reveal, Swipe to dismiss, Stacked deck cycle, Shared element expand | Own UI only | Own UI | L |

### Brief extras without a typeui counterpart

| Effect | Mapping | Fragility |
|---|---|---|
| Send-message animation | A composer `actions` component (renders nothing) subscribes to `useComposer().onSubmitted`. It then plays a 220 ms ripple on `[data-promptbox-submit-action]` and gives the next appended `[data-message-column]` row a lift-in. The trigger is an **API**; the paint is CSS. | L trigger / M paint |
| Status pulses | The overlay polls `experimental_useSidebarThreads()` for indicator transitions (`runtime`→`unread-success`, →`waiting-for-input`). It finds the row by `a[href$="/<threadId>"]` and adds a one-shot ring pulse (opacity/scale on `::after`). The supported alternative is `setThreadRowStatus` with `tone: "running"`, but that **replaces** the glyph. | M/H (row lookup by href) |
| Streaming / thinking shimmer | Timeline: no hook. Phase 3 only, behind a canary, by matching the active-thinking row by structure. Sidebar: the host already shimmers the `runtime` indicator. | H |

**Totals:**
- About 30 of the 113 patterns have a meaningful bb counterpart:
  - about 8 at **L** (supported API or tokens);
  - about 17 at **M** (data-attribute or library-attribute CSS);
  - about 7 at **H**.
- About 15 are already native in bb.
- About 5 are **not possible** without new hooks.
- The remaining ~60 are "no surface" or "own UI only": bb is an IDE, not a forms app.

---

## 3. Proposed design

### 3.1 Two deliverables in one plugin

1. **Theme: `plugin:bb-lively:lively`** (`bb.themes`). This is the token level: palette, radius, elevation and the two global motion tokens. It is opt-in and exclusive like any theme. It is valuable but not required.
2. **Motion layer: content script `motion`**. It works on top of **any** theme, including the current dracula: one `<style data-bb-lively>` node with every effect gated by a root attribute. This is the documented route ("styling or decorating existing app-shell DOM belongs in a content script").

Motion must **not** ride inside the theme CSS, even though the server would accept it (no sanitizer, 256 KB cap). Doing so would tie motion to one palette and break the documented "theme = palette" contract.

### 3.2 Layout (bbim and kb conventions: core/adapter split, npm workspaces, `verify`)

```
assets/bb-plugins/bb-lively/
  package.json        bb.name "bb-lively [Experimental]", bb.app, bb.server, bb.themes,
                      engines bb>=0.46, workspaces ["core"],
                      scripts: typecheck, lint (oxlint), test, verify (= all + bb plugin build)
  server.ts           declares the settings (descriptors come from adapter/settings.ts)
  app.tsx             contentScripts.register("motion"), slots.experimental_appOverlay("sync"),
                      composer.customize({ actions: [{ id: "send-signal", component: SendSignal }] })
  adapter/
    bb.ts             mount(signal) → core; owns the bb-specific wiring only
    selectors.ts      the ONE home of every bb selector (table: id, selector, rating, sinceVersion)
    settings.ts       settings table → descriptors + typed core input (as bbim does)
  core/               @popemkt/bb-lively-core, bb-agnostic
    src/domain/       EffectId union, Settings schema (Effect Schema), MotionPolicy
                      (resolve(systemReduced, mode, perEffect) → enabled set), budget constants
    src/dom/          stylesheet builder (rules per effect, keyed to root attributes),
                      root-attribute writer, reduced-motion media listener,
                      entry observer (MutationObserver + seen-set), one-shot class pulser,
                      selector canary (match counts per selector)
    tests/            policy tests, stylesheet snapshot, observer tests (jsdom)
  themes/lively.css   palette + motion tokens
  skills/bb-lively/SKILL.md   settings, effects, how to report a broken selector
  tests/              adapter tests: selectors.ts vs a captured bb DOM fixture per bb version
```

The core knows nothing about bb, the adapter knows nothing about animation, and `selectors.ts` is the single file to touch after a bb upgrade.

### 3.3 The token theme (`themes/lively.css`)

```css
:root, .light {
  --canvas: …; --ink: …; --primary: …;            /* palette: warm-neutral canvas, saturated accent */
  --ring: color-mix(in oklch, var(--primary) 70%, transparent);
  --radius: .625rem;
  --shadow-lift: 0 6px 18px -8px color-mix(in oklch, var(--ink) 25%, transparent);
  --default-transition-duration: 160ms;            /* retimes all 31 transition utilities */
  --default-transition-timing-function: cubic-bezier(.2,.8,.2,1);
  --ease-out: cubic-bezier(.16,1,.3,1);
}
.dark { --canvas: …; --ink: …; --primary: …; --ring: …; }
```

- Validate it in Theme Preview: WCAG ink rows at 4.5:1 or better, dark text below about 12:1.
- Ship a `codeTheme` pair so code matches the palette.
- Optionally ship a "lively-dracula" variant so the owner keeps the palette they use today.

### 3.4 The motion layer

**Root attributes, written by the content script on `document.documentElement`:**
- `data-lively` = `full` | `reduced` | `off`
- `data-lively-<effect>` on each enabled effect

Every rule is scoped `:root[data-lively-press] …`, so turning a setting off is just removing an attribute. No stylesheet rebuild is needed.

**Motion tokens, defined inside the layer so they work on any theme:**
- `--lively-dur-1: 90ms`, `--lively-dur-2: 160ms`, `--lively-dur-3: 240ms`
- `--lively-spring: linear(0, .55 8%, 1.08 20%, 1.01 32%, .995 46%, 1)`. CSS `linear()` is supported in bb's Chromium/Electron.
- `--lively-ease-out: cubic-bezier(.16,1,.3,1)`

| Effect (setting id) | Target | Motion | Trigger |
|---|---|---|---|
| `press` | buttons, `[role=button]`, sidebar menu buttons (not resize handles or inputs) | `scale(.97)` down in 90 ms, spring back in 160 ms | `:active` |
| `hoverLift` | homepage sections, `[data-resource-detail-section]`, `[data-testid=notification-row]` | `translateY(-1px)`; shadow on `::after` with **opacity** 0→1 | `:hover` (only under `@media (hover:hover)`) |
| `listEnter` | new `[data-timeline-row-id]` at the tail; new `[data-sidebar=menu-item]` | opacity 0→1, `translateY(4px)`→0, 200 ms; stagger 30 ms, at most 4 rows | entry observer adds `.lively-enter` once per **new id** |
| `focusRing` | `:focus-visible`; composer `[data-promptbox-shell]:focus-within` | outline from `--ring`, offset 4→2 px; composer glow on `::after` by opacity | CSS |
| `sendPulse` | `[data-promptbox-submit-action]`, then the next `[data-message-column]` row | ripple: `::after` scale .6→1.6 with opacity .35→0 over 220 ms; message lift-in | `useComposer().onSubmitted` (API) |
| `statusPulse` | sidebar row for a thread whose indicator just became `unread-success`, `unread-error` or `waiting-for-input` | 2 ring pulses on `::after` (scale, opacity), 600 ms total, then stop | overlay diffs `experimental_useSidebarThreads()` |
| `toastSpring` | `[data-sonner-toast].bb-app-toast` | spring easing on sonner's transform transition; loading→success icon crossfade | CSS |
| `overlayEnter` | `[role=dialog]`, `[role=menu]`, popovers, `[data-state=delayed-open]` tooltips | scale .96→1 and opacity with spring, 160 ms; `instant-open` gets no animation | CSS |
| `toggles` | `[role=switch]` thumb, `[role=checkbox]` tick | thumb translate with spring; tick stroke-dashoffset draw | CSS |
| `thinkingShimmer` (off by default, Experimental) | active-thinking line | text gradient `background-position` sweep, 1.6 s loop | canary-gated structural selector |
| `typingGlow` (off by default) | composer text | soft caret glow class | `setTextEffect` (API) |

**Avoiding a replay storm on the virtualized timeline.** The entry observer keeps a seen-set of row ids per `[data-thread-window]`. It animates only ids that:
1. appear after mount,
2. sit at the list tail, and
3. arrive while the user is at or near the bottom.

Rows remounted by scrolling are never animated. The seen-set resets on thread switch.

### 3.5 Reduced motion

The `motion` setting is a select: `system` (default) | `full` | `reduced` | `off`.
- **`system`** follows `matchMedia("(prefers-reduced-motion: reduce)")` live, through a change listener disposed on abort.
- **`reduced`** removes every transform, loop and stagger. It keeps colour and opacity fades of 120 ms or less (focus ring, overlay fade), so state changes remain perceivable.
- **`off`** removes the stylesheet's effect attributes entirely.

The stylesheet also carries a defensive `@media (prefers-reduced-motion: reduce)` block, so a stale `full` attribute can never animate for a user who asked the OS for less motion while in `system` mode.

The layer can also gate bb's own ungated tw-animate `enter`/`exit` under reduced motion. That gating is opt-in as the setting `calmHost`, because it changes host behaviour.

### 3.6 Performance budget

- Animate **`transform` and `opacity` only**.
  - Shadows, glows and rings are drawn on a pseudo-element whose opacity animates.
  - Never animate `box-shadow`, `height`, `width`, `top`, `left` or `filter: blur`.
- Do not read layout in the hot path:
  - the entry observer reads only attributes;
  - no `getBoundingClientRect`;
  - no FLIP; "pin to top" is skipped for this reason.
- At most **4 concurrent `listEnter`** animations; the rest appear instantly.
- Durations: no animation over 300 ms. Loops are allowed only for `thinkingShimmer`, which is off by default and paused with `animation-play-state` when `document.hidden`.
- `will-change` is set only while `.lively-enter` or a pulse class is present, then removed. It is never set statically.
- One MutationObserver, scoped to `[data-timeline-row-list]` and the sidebar menu, with `childList` only, never `subtree: true` over `body`.
- A verify gate: a jsdom test asserts that the generated stylesheet contains no animated property outside `{transform, opacity}`, and that it contains a reduced-motion block.

### 3.7 Settings (one per effect)

| Setting | Type | Default |
|---|---|---|
| `motion` | select | `system` |
| `press`, `hoverLift`, `listEnter`, `focusRing`, `sendPulse`, `statusPulse`, `toastSpring`, `overlayEnter`, `toggles` | boolean | `true` |
| `thinkingShimmer`, `typingGlow`, `calmHost` | boolean | `false` |
| `speed` | select (`snappy` .8× / `normal` / `relaxed` 1.25×) | `normal`; scales the `--lively-dur-*` tokens |

A `settingsSection` renders the **selector canary report**. For each selector it shows the match count on the current screen and the bb version it was verified against, so a broken hook shows up as "0 matches" instead of failing silently.

### 3.8 Build order

1. Theme plus the press, focusRing, overlayEnter and toastSpring effects. These are CSS only, rated L or M.
2. sendPulse (onSubmitted), listEnter (entry observer), statusPulse (useSidebarThreads).
3. Canary report, then the Experimental effects (thinkingShimmer, typingGlow).

Also:
- `verify` = typecheck + oxlint + tests + `bb plugin build`, as in bbim.
- Register the plugin in the bb stack's `my.pkgs.bbPlugins`, like canvas-links.

---

## 4. Risks

### 4.1 Selector breakage on bb upgrades

- bb ships about weekly; the Mac is already on 0.47.0 while shared-server is on 0.46.1. Data attributes such as `data-promptbox-*`, `data-timeline-row-id` and `data-sidebar` are hand-written, but **none is a documented contract**. Tailwind utility classes and DOM shape can change in any release.
- **Mitigations:**
  - keep every selector in `adapter/selectors.ts`, each with a rating and the version it was verified against;
  - CSS-only failure is benign: an unmatched selector does nothing;
  - the canary report;
  - a DOM fixture test per bb version;
  - the H-rated effects default to off.
- **Bigger risk: a selector that still matches but now means something else.** Example: `[role=button]:active` scaling a drag handle and shifting hit targets. Mitigations:
  - an exclusion list (`[data-panel-resize-hit-target]`, `[data-vaul-handle]`, inputs, terminal);
  - the press scale is limited to .97.
- Experimental SDK names (`experimental_appOverlay`, `experimental_useSidebarThreads`, `setThreadRowStatus`) can be renamed. Feature-detect them, as bbim does, and degrade to CSS only.
- The desktop client (0.47.0) and the server-served web UI (0.46.1) can differ. Verify on both before claiming a selector works.

### 4.2 Conflicts with bbim's overlay

bbim draws hints in a closed shadow root host `[data-bbim-overlay]`. The host is `position:fixed; inset:0; z-index:2147483647; contain:strict; pointer-events:none`, and its CSS is isolated, so **lively's CSS cannot reach bbim's labels** and vice versa.

The real conflict is geometry:
- bbim positions labels from `getBoundingClientRect` of targets at the moment hints open.
- If a target is mid-transform (hover lift, press scale, list enter, overlay spring), the label lands 1–4 px off and stays there.
- **Fix:** while hints are visible, lively suspends all transforms with `:root[data-bbim-active] [data-lively-*] { transform: none !important; animation: none !important }`. This needs a tiny change in bbim, which owns that change: set `data-bbim-active` on `<html>` while hints are shown.
- Until then, `listEnter` and `overlayEnter` finish within 240 ms, so stale rects are rare.

Other conflicts:
- bbim's `.flash` uses its own `--bbim-accent` and is unaffected. Optionally, bbim could read `--ring` from the lively theme for a coherent accent (bbim's `THEME_PROPERTIES` already supports overrides).
- **Both plugins mount content scripts.** They must not share global listeners. Each keeps its own `AbortSignal`, and neither touches the other's attributes.
- Content scripts are full-trust. A bug in lively's MutationObserver could slow the whole app. Keep the observer scoped and run its callbacks only through `requestAnimationFrame`.

### 4.3 Accessibility and taste

- Motion fatigue: pulses are one-shot and no loop is on by default.
- Focus rings must keep their contrast against both palettes; check them in Theme Preview.
- `system` is the default motion mode.

---

## 5. Requests to the bb developers

1. **Motion tokens as a contract.** Document `--default-transition-duration` and `--default-transition-timing-function` as theme tokens. Add `--motion-duration-{fast,base,slow}`, `--motion-ease-{out,spring}`, and route tw-animate `enter`/`exit` through them, so themes can retime menus and dialogs without selectors.
2. **An app reduced-motion setting** (`system` / `reduce` / `full`), exposed as `data-motion-preference` on the root element and as a frontend hook (`useMotionPreference()`). Gate bb's own `enter`, `exit` and transition utilities on it.
3. **Semantic, documented `data-bb-*` hooks** on the surfaces themes want:
   - thread rows with `data-thread-id` and `data-thread-indicator`;
   - timeline rows with `data-row-kind` (user, assistant, tool, thinking) and `data-row-state` (streaming, done);
   - the thinking/streaming line;
   - composer, send button, toasts and dialogs.
   Declare them in the SDK docs as stable, versioned like slot props.
4. **Frontend lifecycle events:** `turn.started`, `turn.completed`, `turn.failed`, `message.appended { threadId, rowId, isLocalSend }` and `composer.submitFailed`. Today only `onSubmitted` (success) exists, and turn transitions must be inferred by polling `useSidebarThreads`.
5. **Exit hooks or presence attributes** for removed list items (archive, dismiss), for example keeping the node for one frame with `data-exiting`. Without this, no exit animation is possible.
6. **A content-script context with a route and thread snapshot.** The docs note it "deliberately has no route/project/thread snapshot yet". This would let a motion layer reset per-thread state without global observers.
7. **A non-exclusive "theme addon" or `bb.styles` manifest entry.** App-wide CSS with theme-like lifetime that composes with whichever palette is active, so a motion or density layer does not need a content script that injects `<style>`.
8. **A toast API for plugins** with an optional `duration` exposed as `--toast-duration` on the toast, which would make countdown bars possible.
9. **Clarify the theme-CSS policy.** Theme CSS is injected verbatim; the only check found is the 256 KB cap. State whether non-token rules (selectors, keyframes) in theme CSS are supported, tolerated or going to be stripped.
