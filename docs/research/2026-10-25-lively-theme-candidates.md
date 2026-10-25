# bb-lively theme presets: candidates, and what a preset can carry

Date: 2026-10-25. Status: research and ideation only. No plugin code was changed.

Deliverables:
- **Visual comparison**: [assets/2026-10-25-lively-theme-candidates.html](assets/2026-10-25-lively-theme-candidates.html).
  - It is one self-contained file: no network, fonts or images.
  - Each candidate is a mock bb chunk (sidebar rows, timeline, diff, composer, toast, buttons) with its
    motion on hover, press and the controls under it.
  - It has Dark/Light and Full/Reduced toggles.
  - URL hooks for screenshots: `?only=<id>`, `?mode=light`, `?state=turn`, `?art=user`, `?still=1`.
- **Screenshots**: `~/.dotfiles/.kb/assets/bb-lively/2026-10-25-themes/`. They are Mackup-backed and not
  committed.
  - `00-overview-{dark,light}.png`;
  - `01-transistor-*` (dark, light, Turn() in both modes, user art slot, cells wipe);
  - `NN-<id>-{dark,light}.png`;
  - `wipe-<id>.png`;
  - `mark-*.png`.
- **Per-theme mappings**: [assets/bb-plugins/bb-lively/ART-DIRECTION.md](../../assets/bb-plugins/bb-lively/ART-DIRECTION.md)
  is the canonical home of each theme's source analysis and its mapping onto files, tokens, effects and
  selectors. This doc does not repeat those tables. It evaluates, costs and recommends.
- **Background**: [2026-10-24-bb-theming-feasibility.md](2026-10-24-bb-theming-feasibility.md) and
  [2026-10-24-bb-lively-zzz-wobble.md](2026-10-24-bb-lively-zzz-wobble.md).

Versions:
- bb 0.46.1 on shared-server and 0.47.0 on this Mac.
- `@get-bb/plugin-sdk` 0.6.49, from its `bundled-types/bb-plugin-sdk.d.ts`, called **SDK** below.

---

## 0. Short version

**Candidates.** Each is one choice that sets a palette, a motion personality and an art layer:

1. **Transistor "Cloudbank"** (the owner's pick, fully worked).
   - Look: Jen Zee's Art Nouveau dusk: a violet sky over a warm horizon, a turquoise sword-light, gold line,
     and an original skyline.
   - Motion: clean / lively.
   - New: **Turn()**. While the agent waits for approval, the timeline freezes into a cyan wireframe plan
     with a Turn() bar and a dashed planned path, and approving "executes".
2. **Persona 5 "Phantom"**: red, black and white; skewed slabs; a jagged calling-card wipe; a star burst.
   Motion: wobbly / bold / snappy, with skew and red stickers.
3. **NieR:Automata "YoRHa"**: beige paper, khaki ink, square corners, grid and corner brackets, scan-bar wipe.
   Motion: mechanical (clean / subtle / snappy, overshoot 0). Failures glitch.
4. **Hollow Knight "Hallownest"**: blue-black depths, pale soul light, ceiling drips, a faint arch, rain.
   Motion: clean / subtle / relaxed. Threads open out of darkness.
5. **Balatro "Joker"**: felt, chips blue and mult red, a pinwheel swirl, a faint CRT. Motion: wobbly / lively
   with matched jelly and dark stickers. Statuses land as score pops.
6. **Splatoon "Turf"**: two team inks on night purple, corner splats, an ink-wall wipe, a splat on send.
   Motion: wobbly / bold / matched jelly.
7. **Risograph "Riso"**: paper and two spot inks, grain and halftone, a pink misregistered sticker shadow.
   Motion: clean / lively with a 2 px misregistration on arrival.
8. **Ukiyo-e "Ukiyo"**: washi, Prussian blue, a vermilion seal, a seigaiha sidebar and a curling wave of our
   own. Motion: clean / subtle / relaxed with an ink-bleed blur and a brush-stroke wipe.

**Top 3** (§6): **Transistor**, **YoRHa**, **Joker**. They cover three different motion personalities:
plan-and-execute, mechanical and juicy.

**Can a plugin switch bb's active theme? Yes.**
- `bb.themes` in the manifest only *registers* themes.
- `sdk.theme.set(...)` *selects* one. It is reachable from the frontend (`useSdk()`) and the backend
  (`api.sdk`).
- The selection is **server-wide**: one row for every client and device of that bb server. Light/dark stays
  per client. Details in §1.1.

**Can a theme carry art? Technically yes; by contract it should carry tokens, and lively should paint.**
- Theme CSS is injected verbatim, so url(), @font-face and pseudo-elements all work.
- bb's theme contract is token blocks, though. The proposal (§2) is that a theme declares **`--lively-*`
  art tokens**: inline-SVG masks plus paints. lively's stylesheet paints them as layers behind the timeline
  and sidebar, and as wipe and burst shapes.
- One seam serves every theme, and a theme without lively degrades to a plain palette.

**Copyright.**
- **(a)** Original art, made in each game's spirit and committed as SVG and CSS. Every mock here is (a).
- **(b)** An optional **user art slot**: a URL or host path the owner fills with his own image, kept out of
  git.
- Recommendation: ship (a) as the default and add (b) as a small follow-up. Details in §2.3.

---

## 1. What bb lets a preset do

### 1.1 Selecting the active theme from a plugin

**The SDK**
- `ThemeArea` has `get`, `catalog`, `resolve` and `set(selection | themeId)` (SDK ~17738–17743).
- It is an area of `BbSdkAreas` (`theme: ThemeArea`, SDK ~18484).
- Both plugin clients expose it:
  - the backend `PluginBbSdk = Omit<BbSdk, "threads"> & …` (SDK ~24201), as `api.sdk`;
  - the frontend `PluginBrowserBbSdk = Omit<BbSdkAreas, "threads"> & …` (SDK ~19700), from
    `useSdk()` (SDK ~21980).
- The browser client "runs with the user's own authority; there is no narrower plugin scope".
- The authoring skill lists it too (`backend-sdk.md`: "`theme`: `get` `catalog` `resolve` `set`").

**The server** (`start-server.js`, bb 0.46.1)
- `put(routes.appearance)` calls `requireKnownTheme(themeId)`, which accepts built-ins, a plugin theme with
  readable CSS, or a custom theme on disk.
- It then calls `setStoredAppearance(db, { themeId, faviconColor })` and
  `hub.notifySystem(["config-changed"])` (lines ~186837–186843).
- Storage is **one row** (`APP_THEME_ROW_ID`, lines ~43365–43380).
- Every connected client repaints on `config-changed`.

**What follows**
1. A lively "preset" select can call `sdk.theme.set({ themeId: "plugin:bb-lively:lively-transistor", faviconColor })`
   from its existing app overlay. It must read `faviconColor` with `theme.get()` first, or use the string
   overload, so it does not reset the favicon.
2. The switch is **app-wide for that bb server**: the phone, the desktop and the shared-server web UI all
   change. Motion settings are per-plugin settings, which are also server-side, so a preset is consistent
   across devices. This should be stated in the preset UI.
3. The reverse direction is also possible. A theme can declare `--lively-preset: transistor;`, and lively's
   content script can read it once per theme change (the `<style id="bb-app-theme">` swap) to offer the
   matching motion. That supports a "Motion follows theme" option for people who pick themes in Settings →
   Appearance.
4. A plugin theme only exists while the plugin is loaded ("Only loaded plugins contribute"). If lively is
   disabled, bb falls back as it does for any missing theme.

### 1.2 What a theme file can carry

**What bb does** (from the 2026-10-24 feasibility doc, re-checked)
- Theme CSS is written verbatim into `<style id="bb-app-theme">`.
- The cap is 256,000 characters, and no sanitizer was found.
- The main app has no CSP. The only CSP headers found are on sandboxed file responses (`start-server.js`
  ~185393, ~196467: `default-src 'none'; style-src 'unsafe-inline'`).
- So a theme can technically hold:
  - `url("data:image/svg+xml,…")` values;
  - `@font-face` with `data:` fonts;
  - element-scoped blocks;
  - pseudo-elements.

**The contract is narrower** (bb's `bb-theme-authoring` skill)
- Token blocks under `:root, .light` and `.dark`.
- "Element-scoped blocks are allowed — … but keep palette values in the two top-level blocks so tooling can
  read them".
- The feasibility doc's request #9 asks bb to state whether non-token rules are supported.

**Recommendation**
- Themes declare **custom properties only**: bb's tokens plus `--lively-*` art tokens, whose values may be
  inline SVG data URIs and gradients.
- Selectors, pseudo-elements and any `@font-face` live in lively's content-script sheet, which already owns
  every selector in `adapter/selectors.ts`.
- This keeps themes inside bb's contract, keeps them readable by Theme Preview, and survives a future
  sanitizer that keeps custom properties.

**Fonts**
- bb has `--font-sans`, `--font-mono` and `--font-terminal`.
- Changing `--font-sans` restyles every word, which is too risky for a dense, all-day UI. Keep it.
- A display face for headers and brand labels needs a *new target*, because bb has no heading token. It
  would be an OFL font (Josefin Sans, Federo, Cinzel, Shippori Mincho) bundled in the plugin and declared by
  lively's sheet.
- No game's own font is used. Transistor's and Persona 5's fonts are unidentified or custom; Balatro's m6x11
  licence is unconfirmed.

### 1.3 Can lively add an art layer that the theme controls?

**Yes.**
- lively's content script already injects one `<style data-bb-lively>`, and `pageWipe` already sets
  `position: relative` on `pageView` (`[data-thread-window]`) and paints `pageView::after`.
- An art layer is a sibling: `pageView::before` with `isolation: isolate` on the host and `z-index: -1`, so
  it paints above bb's own background and under the rows. More layers need more pseudo-elements on nested
  stable hosts (`rowList`, the composer), or one injected `<div data-lively-art>` per window. The div is
  simpler for four layers and still removed on abort.
- The sidebar needs a *new target* (`[data-sidebar="content"]`, rated M), captured into the fixture first.

**Constraints**
- **Live check: where bb paints the thread background.** If an inner element paints an opaque `--canvas`, the
  layer is hidden. The fix is a theme-scoped `--canvas` for that element (an element block, rated M), or
  making the layer the painter. Not verified yet.
- **Paint only.** Art layers never animate, so they cost nothing against `BUDGETS` and need no
  reduced-motion handling: they stay under reduced motion like sticker shadows do (`policy.ts`: "a shadow is
  paint, not motion").
- **Legibility rule.**
  - Art behind the reading column stays at **≤ 16% alpha**, or is masked away from it.
  - Strong art sits only in the margins, the corners, or **below the top of the composer**. The Transistor
    skyline is 84 px tall and sits behind the translucent composer.
  - Full-window overlays such as scanlines, grain and rain stay at **≤ 6%**.
- **Virtualized rows** are unaffected: the layer is on the window, not on rows.

---

## 2. Proposal: the art-layer contract

These are theme tokens. Each is optional, and an absent token paints nothing. Shape and colour are separate
(a **mask** plus a **paint**), so one drawing serves light and dark.

| Token | Painted by lively on | Today |
|---|---|---|
| `--lively-art-timeline` | `pageView` backdrop (any `background` value) | new |
| `--lively-art-timeline-{1..4}-paint` / `-mask` / `-opacity` | stacked layers over the backdrop | new |
| `--lively-art-sidebar` / `-sidebar-paint` / `-sidebar-mask` | sidebar backdrop and one masked layer (*new target*) | new |
| `--lively-art-overlay` / `-opacity` | a static whole-window texture: scanlines, grain, rain | new |
| `--lively-wipe-fill` / `--lively-wipe-mask` | `pageWipe` slab | hard-coded dots and a 105° mask in `stylesheet.ts` (`pageWipe` block) |
| `--lively-burst-fill` / `--lively-burst-mask` | `sendPulse` burst | hard-coded halftone ring (`.lively-send::after`) |
| `--lively-sticker-color` | every sticker shadow | hard-coded `#000` in `stylesheet.ts` |
| `--lively-chroma-a` / `-b` | the chromatic split | hard-coded `#3fd4ff` / `#ff3dbb` (`lively-chroma` keyframes) |
| `--lively-font-display` | brand and header labels (*new target*) | new |
| `--lively-user-art` | set by lively from the user art slot, never by a theme | new |
| `--lively-preset` | read by lively to offer the matching motion | new |

The last four rows of hard-coded values are the cheapest win. They turn ZZZ's look into tokens without
changing ZZZ, which is Rule 1: extend the existing seam.

### 2.1 Presets beyond settings: per-preset token overrides

Several candidates need one motion token nudged, not a new style:

| Candidate | Override |
|---|---|
| YoRHa | `overshoot: 0`, which gives mechanical motion without a third style row |
| Riso | `chroma: 2` in clean, for misregistration |
| Hallownest | `flash` below 0, so pages open from dark |
| Ukiyo | `blur: 3`, for ink bleed |
| Transistor | `breatheMs: 3200`, `glow: .3`, for the sword hum |

**Proposal:** a preset is `{ themeId, settings, overrides?: Partial<MotionTokens> }`. `tokensFor` applies
the overrides after the (style, intensity) row and before speed, and `REDUCED_TOKENS` still wins under
reduced motion.
- `BUDGETS` must hold *after* overrides. The stylesheet test that checks budgets would iterate the presets
  too.
- This is for the agent building the preset mechanism. It keeps "every setting can still be tweaked" true,
  because overrides only fill what the person has not set.

### 2.2 One new effect family instead of five: status marks

Four candidates want a one-shot mark on a sidebar row when its status changes:
- Hallownest: soul motes rise;
- Joker: a score pops;
- Ukiyo: a seal is stamped;
- Phantom: a cut-in band;
- YoRHa: a glitch slice.

These are one effect, **`statusMark`**, on `statusRow` (the `statusPulse` trigger already exists in
`adapter/bb.ts`), with:
- the mark's **shape and text from theme tokens**: `--lively-mark-success: "済"` and its paint;
- a **curve from a small named set**: `stamp`, `float`, `rise`, `slice`, `band`.

Budgets: clean marks run within 400 ms and wobbly marks within 560 ms. The mock's seal stamps in 360 ms,
the score pops in 520 ms, the motes rise in 400 ms, and the cut-in runs 540 ms.

Under reduced motion the mark fades in at 120 ms (stamp) or does not show (float, band). A stamped seal can
then *stay* as a static "finished, unread" badge: paint, not motion.

### 2.3 Art provenance: (a) committed original art, (b) a user art slot

**(a) Original art (recommended default).**
- Every drawing in the mock is ours:
  - a seeded procedural skyline of arched towers, onion domes and spires;
  - an Art Nouveau cartouche;
  - stepped "Process" cells;
  - shards, a star, splats, drips, a gothic arch, suits;
  - seigaiha, a carved curling wave, a brush stroke.
- Each is a few hundred bytes to a few KB of SVG, far inside the 256,000-character theme cap.
- It works on every host and every client, and is safe in a public repo.
- Ukiyo's sources are public domain (Hokusai died in 1849; Wikimedia Commons applies PD-Art), but its art is
  drawn from scratch anyway.

**(b) A user art slot (optional follow-up).**
- A lively setting `artImage` (a string) holds a URL.
- The natural source is a kb asset: `.kb/assets/` is Mackup-backed and never committed, and the kb service
  serves it on the tailnet. A plain host path also works, served through a plugin HTTP route on the bb
  server's host.
- lively's content script sets `--lively-user-art: url(…)` on `:root`. Each theme decides where it goes, for
  example under the Transistor skyline at ≤ 50% with a mask that clears the reading column (mock:
  `?art=user`, shown with a stand-in gradient).
- Caveats:
  - the bb server runs on shared-server and on this Mac, and `~/.dotfiles/.kb/assets` only exists on the
    Mac, so a URL is simpler than a host path;
  - a CSS `background-image` from another origin needs no CORS;
  - every theme must still look complete with the slot empty.

---

## 3. Candidates in detail

The per-theme analysis and the mapping onto code are in [ART-DIRECTION.md](../../assets/bb-plugins/bb-lively/ART-DIRECTION.md).

**How the numbers were measured**
- Contrast is WCAG, computed for the mock's tokens: ink on canvas, muted on canvas, accent on canvas, and
  `--primary-foreground` on `--primary`.
- bb's theme skill asks to keep dark-mode body text **below about 12:1** on near-black, to avoid OLED bloom.
  Two candidates sit above it, and that is noted in their rows.

### 3.1 Transistor — "Cloudbank" (fully worked)

**Palette** (theme `themes/lively-transistor.css`, planned)

| Role | Dark | Light ("Cloudbank day") |
|---|---|---|
| `--canvas` / `--sidebar` / `--card` | `#13142a` / `#0e0f22` / `#1b1d3a` | `#f3ecdf` / `#ebe2d1` / `#f9f4ea` |
| `--ink` / `--muted-foreground` | `#d0d3e6` (12.2:1) / `#9397bb` (6.4:1) | `#1b1d36` (14.0:1) / `#55587a` (5.8:1) |
| `--primary` / `--primary-foreground` | `#3ee6d4` (11.6:1) / `#06201e` (10.9:1) | `#08706a` (5.1:1) / `#ffffff` (5.9:1) |
| `--timeline-accent` (gold) | `#e0b25a` (9.2:1) | `#8a5c0c` (4.9:1) |
| `--destructive` (Red) / `--warning` / `--success` | `#ff6b57` (6.5) / `#f2a14a` (8.6) / `#7fdc9a` (10.9) | `#b2361f` (5.2) / `#985210` (5.0) / `#2b7444` (4.9) |
| `--pr-merged` (magenta) / `--border` | `#d94f8a` / `#2d3060` | `#9a2f66` / `#d2c3a6` |
| `--radius` | `6px`: frames, not pills | same |
| art | dusk sky; far skyline `#4a3a78→#2a2350`; turquoise rim; near skyline `#0b0c1d`; gold windows at 55%; gold cartouche | parchment haze; skyline `#6b6d92`; rim `#2a8f88` |

**Motion personality**
- Settings: style `clean`, intensity `lively`, speed `normal`, stickers `off`, `pageWipe` **on** (cells).
- Overrides: `breatheMs: 3200`, `glow: .3`.
- Effects:
  - all defaults on, `typingGlow` (accent caret) on;
  - the working line hums with a small scale breath;
  - the chromatic split uses turquoise and Red.

**New work**
- **`turnFreeze`** (new effect, shown in the mock with "Turn() — await approval"):
  - *Trigger*: the open thread's sidebar indicator becomes `waiting-for-input`. `adapter/bb.ts` already
    diffs indicators for `statusPulse`; this adds a "current thread" check against the path lively already
    watches for `pageEnter`. It runs while that indicator holds, and ends when it changes.
  - *Look*:
    - `rowList` takes `filter: saturate(.2) brightness(.72)`, stepped in over 140 ms;
    - a cyan wireframe veil (`rowList::after`: a 24 px grid, 3 px scanlines and a cyan wash) fades in over
      120 ms;
    - a **Turn() bar** on the composer's top edge (`focusBox::before`) fills to 72% on the intensity's
      spring (`enterMs × 1.4` = 392 ms at lively), and three queued marks pop in at 60 ms steps;
    - a dashed **planned path** draws down the gutter (336 ms) with a diamond node on each row;
    - the approval UI stays in full colour with a turquoise glow.
  - *Exit*:
    - **approve = execute**: one 220 ms brightness flash (saturate 1.4, brightness 1.4, then none), then
      the bar drains on the exit ease (320 ms);
    - deny, or any other indicator change: the veil fades out (120 ms).
  - *Budgets*: every run is ≤ 400 ms (clean). The hold is a **state, not a loop**, so the two-loop rule
    stands. Filters only, no layout.
  - *Reduced motion*: veil, desaturation and bar appear at once at their end state (an opacity fade of
    120 ms at most). There is no flash, path draw or pop.
  - *Gap*: the approval UI has no captured selector yet. The effect needs only `rowList` and `focusBox`,
    but keeping the approval card in colour needs its selector in the fixture. Until then, the whole
    `rowList` freezes and the composer stays live.
  - Open question: should **plan mode** (a Claude permission mode) also trigger it? The SDK exposes no
    plan-mode signal to a content script; only `waiting-for-input` is observable.
- **`traceLine`**: a 2 px turquoise trace draws down the gutter of each arriving row (`row::before`, `scale`
  from the top, `enterMs × 1.4`), then fades. It can be a theme-shaped arrival mark on `listEnter` rather
  than a new effect id.
- Tokens (§2): the four-layer timeline art, the sidebar cartouche, the cells `--lively-wipe-mask` and grid
  fill, the ray `--lively-burst-fill`, and `--lively-chroma-a/b`.
- Display font: Josefin Sans (OFL) for the brand and headers, behind a *new target*.

**Legibility.**
- Body text at 12.2:1 sits at the skill's ceiling. The muted foreground is 6.4:1.
- The turquoise primary is for links, focus and the send fill; it is never body text.
- The skyline occupies only the bottom 84 px behind the composer. The painted sky is ≤ 3% texture plus
  low-alpha glows.
- **Risk**: the Turn() freeze drops the frozen rows to about 6:1, deliberately, because they are "the past"
  while you decide. If that grates, use brightness .82.

**Build cost**: **medium**.
- Theme CSS: small.
- The art-layer contract (§2): shared, and the biggest piece.
- `turnFreeze`: a new effect, but on existing seams.
- `traceLine`: small.

**Why it's fun to daily drive.**
- An agent tool's most frequent "moment" is waiting for your approval, and today it is a dull card.
- Here the whole world stops, turns into a plan, and executes when you press Approve. It is Transistor's
  core mechanic mapped onto the one place bb has a real "plan, then act" beat.
- The rest of the time it is a calm violet dusk with a turquoise pulse and gold lines.

### 3.2 Persona 5 — "Phantom"

**Palette**

| Role | Dark | Light |
|---|---|---|
| canvas / ink / muted | `#0b0b0b` / `#d6d6d6` (13.5:1) / `#a6a6a6` (8.1:1) | `#f3efe6` / `#0b0b0b` (17.2:1) / `#4c4c4c` (7.5:1) |
| primary / on-primary | `#ff2a2a` (5.3:1) / `#000000` (5.6:1) | `#c8101e` (5.2:1) / `#ffffff` (5.9:1) |
| timeline-accent | `#f4f4f4` | `#0b0b0b` |
| destructive / warning / success | `#ff5c8a` / `#ffc21a` / `#38e08a` | `#a1003c` / `#8f5a00` / `#16723f` |
| shape | `--radius 2px`; sidebar always black | — |

**Motion**: wobbly, bold, snappy, skew on, stickers always (red), jelly shared, `pageWipe` on (jagged).

**New work**:
- tokens only: jagged `--lively-wipe-mask`, star `--lively-burst-mask`, `--lively-sticker-color`, and
  shard art;
- the selected row's skewed slab needs an element block on `.bb-sidebar-selected-row` (rated M);
- `statusMark: band` (the cut-in) is optional and off by default: it covers the timeline for 540 ms.

**Legibility**:
- 13.5:1 body is above the ceiling, because the look is maximum contrast. `#cfcfcf` would bring it to
  about 12.6:1.
- Red is the accent and sits beside the error colour (`#ff5c8a` is pink-red to separate them).
- Errors stay distinguishable by icon and position, not hue alone.

**Cost**: low for tokens; medium if the cut-in ships.

**Why fun**: every send is a heist. **Fatigue risk**: wobbly / bold / snappy all day is loud. It is better
as a weekend or demo preset; the "subtle" intensity tames it.

### 3.3 NieR:Automata — "YoRHa"

**Palette** (light-first)

| Role | Light | Dark (night) |
|---|---|---|
| canvas / ink / muted | `#d8d2b8` / `#38352d` (8.1:1) / `#5d5848` (4.7:1) | `#22211c` / `#d6cfb4` (10.3:1) / `#a39d86` (5.9:1) |
| primary / on-primary | `#4a463b` (6.2:1) / `#d8d2b8` (inverted selection) | `#d6cfb4` / `#22211c` |
| timeline-accent / destructive / success | `#8e3b26` (4.9) / `#9b2a20` (5.0) / `#3f5a26` (5.1) | `#d9876a` / `#e5735f` / `#9fb97a` |
| shape | `--radius 0`; condensed letter-spaced headers | — |

**Motion**:
- clean, subtle, snappy; override `overshoot: 0`;
- `pageWipe` on (scan bars);
- the focus ring is a bracket outline with an offset, not a glow;
- `statusMark: slice` on failure.

**New work**: tokens, plus one override, plus `slice`. Optionally `--lively-focus-shape`.

**Legibility**:
- Light-first and low-glare. Body is 8.1:1.
- The muted foreground at 4.7:1 is the weakest pair here. It passes AA but should not shrink below 12 px.

**Cost**: low.

**Why fun**: the most livable "game" theme. Paper, ink and precise motion; it feels like a tool, until a
failure glitches.

### 3.4 Hollow Knight — "Hallownest"

**Palette**

| Role | Dark | Light |
|---|---|---|
| canvas / ink / muted | `#0e1317` / `#cdd4da` (12.5:1) / `#8b96a1` (6.2:1) | `#ecebe6` / `#1a2127` (13.6:1) / `#4f5962` (6.0:1) |
| primary / on-primary | `#b7d4f0` (12.2:1) / `#0e1317` | `#2d5a82` (6.1:1) / `#ffffff` |
| timeline-accent / destructive / success | `#efe4c4` / `#e46a64` (5.8) / `#8fd1a0` (10.5) | `#6b5a2e` / `#a8322d` / `#2e6b40` |

**Motion**: clean, subtle, relaxed; overrides `blur: 1` and `flash < 0` (pages open from dark); wipe off;
`statusMark: rise` (soul motes).

**New work**: tokens (vignette, drips, arch, rain overlay), two overrides, and `rise`.

**Legibility**:
- Dark body text at 12.5:1 is just over the ceiling; `#c6cdd3` brings it to about 11.8:1.
- The rain overlay must stay ≤ 4% or it shimmers against text.

**Cost**: low.

**Why fun**: the quiet one. Weightless and slow, with pale glows. It is the easiest of the eight to live in
all day, but it overlaps Transistor's "dark and painterly" niche.

### 3.5 Balatro — "Joker"

**Palette**

| Role | Dark | Light |
|---|---|---|
| canvas / ink / muted | `#1b2b2b` / `#ebe6d9` (11.8:1) / `#9fb0ab` (6.5:1) | `#efe8d8` / `#1f2a2a` (12.1:1) / `#4f5b5a` |
| primary (chips) / on-primary | `#2fa9ff` (5.8:1) / `#04182a` (7.0:1) | `#0068b8` (4.7:1) / `#ffffff` (5.7:1) |
| timeline-accent (money) / destructive (mult) / success | `#f5b143` (7.9) / `#fe5f55` (4.9) / `#4fd19a` (7.7) | `#8a5a00` (4.9) / `#b03224` / `#1a6e48` |

**Motion**: wobbly, lively (the README's all-day wobbly), stickers always with a dark sticker colour, jelly
matched, wipe off; `statusMark: float` (score pops: "+40 chips", "×0 bust").

**New work**: tokens (pinwheel swirl, CRT overlay, suits), `--lively-sticker-color`, and `float`.

**Legibility**: the swirl is darkened at the centre where text sits. Scanlines stay ≤ 6% at a 3 px pitch;
denser scanlines moiré with 12–13 px text.

**Cost**: low.

**Why fun**: an agent finishing a thread feels like scoring a hand. Cards tilt under the cursor, and the
CRT haze is cosy. The wobble is the friendlier, all-day kind.

### 3.6 Splatoon — "Turf"

**Palette**

| Role | Dark | Light |
|---|---|---|
| canvas / ink / muted | `#15121d` / `#d9d3e8` (12.7:1) / `#a49cb8` (7.1:1) | `#f4f2ea` / `#1a1626` (15.8:1) |
| primary / on-primary | `#eaff3d` (16.6:1) / `#15121d` | `#5a2bd9` (6.7:1) / `#ffffff` (7.5:1) |
| timeline-accent / destructive / success | `#ff4fa3` (6.1) / `#ff5a5a` (6.0) / `#2ee6a6` | `#c2185b` (5.2) / `#c62828` / `#00796b` (4.7) |
| shape | `--radius 16px`; a blob-shaped send button | — |

**Motion**: wobbly, bold, jelly matched, stickers off, `pageWipe` on (ink wall).

**New work**: tokens only (splat burst, ink-wall mask, corner splats).

**Legibility**:
- Lime as primary is loud (16.6:1 as a fill); it is fine for focus and fills, never for text runs.
- Corner splats must stay out of the reading column. In the mock the pink splat touches "Working…", which is
  the failure mode to avoid.
- Low-alpha lime over purple turns olive, so splats need ≥ 60% alpha and a small size.

**Cost**: low.

**Why fun**: the send button throws ink, and everything squishes. **Risk**: like Phantom, bold all day is
a lot.

### 3.7 Risograph — "Riso"

**Palette** (light-first)

| Role | Light | Dark |
|---|---|---|
| canvas / ink / muted | `#f5efe3` / `#1d1b2c` (14.7:1) / `#55526a` (6.5:1) | `#1a1922` / `#e6dfcf` (13.1:1) / `#a7a1b4` (7.0:1) |
| primary (Riso Blue) / on-primary | `#0070b8` (4.6:1) / `#ffffff` (5.2:1) | `#59b3ff` (7.7:1) / `#0b1a29` |
| timeline-accent / destructive / success | `#c4126f` (5.0) / `#c42341` (5.0) / `#00757b` (4.8) | `#ff6cbd` / `#ff6a7f` / `#3fd0c2` |
| second ink | Fluorescent Pink `#ff48b0`: paint only (2.7:1 on paper, never text) | same |

**Motion**: clean, lively; override `chroma: 2` (misregistration on arrival, in pink and blue); stickers
always in pink; `pageWipe` on (two halftone screens).

**New work**: tokens (grain overlay, halftone, wipe fill), `--lively-chroma-a/b`, and one override.

**Legibility**: good. Blue at 4.6:1 is the floor and is used for links, focus and the send fill only. Grain
stays ≤ 5%.

**Cost**: low.

**Why fun**: the only print-born, light-first theme. Rows land a little out of register and snap into
place, and the second ink shows only as shadow.

### 3.8 Ukiyo-e — "Ukiyo"

**Palette** (light-first; night borrows Kanagawa)

| Role | Light | Dark |
|---|---|---|
| canvas / ink / muted | `#f1eadb` / `#1c2540` (12.6:1) / `#4c5470` (6.2:1) | `#1f1f28` / `#dcd7ba` (11.3:1) / `#9a9787` (5.6:1) |
| primary / on-primary | `#1f4a85` (7.4:1) / `#ffffff` (8.8:1) | `#7e9cd8` (5.9:1) / `#16161d` (6.5:1) |
| timeline-accent / destructive / success | `#a8432c` (5.0) / `#a12a2a` (6.1) / `#3f6b3a` (5.2) | `#e6c384` (9.7) / `#e46876` (5.1) / `#98bb6c` (7.5) |
| seal | `#b8382a` | same |

**Motion**: clean, subtle, relaxed; override `blur: 3` (ink bleed); `pageWipe` on (brush stroke);
`statusMark: stamp` (a 済 seal that stays as a static "finished" badge).

**New work**: tokens (wave, seigaiha, brush mask) and `stamp`.

**Legibility**: good in both modes. The wave sits at 16% behind the bottom-right; the seigaiha pattern is at
7%.

**Cost**: low.

**Why fun**: calm and literary. Rows bleed in like ink, and finished work gets stamped. It has the cleanest
art provenance of the eight.

### 3.9 Also considered

| Candidate | Why not on the list |
|---|---|
| Hades | Same art director and painterly niche as Transistor. The ember-and-gold palette is lovely, but two Jen Zee themes is one too many. |
| Terminal/CRT phosphor (green P1, amber P3) | Strong and legal, but its motion personality (type-on, phosphor afterglow) overlaps YoRHa's mechanical style and Joker's CRT. A good *variant* of YoRHa's night mode. |
| Frutiger Aero / Y2K | Glossy glass and bubbles want blur and specular highlights everywhere, which is expensive (`backdrop-filter`) and dated for dense text. |
| Celeste | A pixel look that bb's anti-aliased UI cannot carry without a pixel font. Its dash-trail motion is lovely; borrow it for `traceLine`. |
| Metaphor: ReFantazio | Atlus again (Persona 5's sibling). Painterly-medieval, and close to Transistor's Art Nouveau. |
| Honkai: Star Rail | A clean sci-fi UI with gold accents; not distinct enough from the existing Lively and ZZZ. |
| Catppuccin, Nord, Gruvbox, Dracula, Solarized | Already built into bb. Lively Dracula shows the pattern of adding Lively tokens to one. They are recolors, not art directions. |
| Rosé Pine, Tokyo Night, Kanagawa | Recolors without an art or motion source. Kanagawa's palette is used as Ukiyo's night mode, where the art direction (Hokusai) is. |

---

## 4. Comparison

| | Mode | Style / intensity / speed | Signature | Art | New work | Daily-drive risk | Cost |
|---|---|---|---|---|---|---|---|
| **Transistor** | dark + light | clean / lively / normal | Turn() freeze on approval wait | sky, 4-layer skyline, cartouche | `turnFreeze`, `traceLine`, contract | low (freeze is brief) | medium |
| Phantom | dark + light | wobbly / bold / snappy | slam-in, jagged wipe, cut-in | shards, halftone | contract, `band` mark | high (loud) | low–med |
| **YoRHa** | light-first | clean (overshoot 0) / subtle / snappy | mechanical, scan wipe, glitch | grid, brackets | override, `slice` mark | low | low |
| Hallownest | dark + light | clean / subtle / relaxed | from-black, soul motes | vignette, drips, arch, rain | overrides, `rise` mark | lowest | low |
| **Joker** | dark + light | wobbly / lively / normal | score pops, card tilt | swirl, CRT, suits | `float` mark, sticker colour | low–med | low |
| Turf | dark + light | wobbly / bold / normal | splat, ink wall | corner splats | tokens only | med–high | low |
| Riso | light-first | clean / lively / normal | misregistration | grain, halftone | override, chroma tokens | low | low |
| Ukiyo | light-first | clean / subtle / relaxed | ink bleed, brush wipe, seal | seigaiha, wave | override, `stamp` mark | low | low |

The **shared enabling work** is the same for all eight:
1. the art-layer contract (§2);
2. per-preset token overrides (§2.1);
3. `statusMark` (§2.2).

After that, every candidate except Transistor is mostly a theme CSS file plus a preset entry.

---

## 5. Constraints checked

- **BUDGETS.** Every new run in the mock fits its style's budget at normal speed:
  - clean: ≤ 400 ms once, presses ≤ 100 ms;
  - wobbly: lands ≤ 120 ms, total ≤ 560 ms.
  - Speed `relaxed` multiplies durations by 1.25, as it already does for shipped effects.
  - Two mock items run longer than a budget would allow and are flagged:
    - the page wipe runs `max(enterMs, 400)`, as the shipped wipe does;
    - Hallownest's from-black runs `enterMs × 1.5` (330 ms at normal speed).
- **Reduced motion.** Art layers are paint and stay. New effects collapse to ≤ 120 ms opacity, or to
  nothing:
  - `turnFreeze` shows its end state at once;
  - `traceLine`, `float` and `band` are off;
  - `stamp` fades in.
- **Loops.** No new loops. The Transistor hum is the existing `workingGlow` loop with a slower breath.
- **One theme at a time.** A preset sets exactly one bb theme. Each candidate ships light and dark blocks in
  one file. Bold variants are not needed: the preset carries intensity.
- **bbim.** New rules carry `:not([data-bbim-active])` like every other lively rule.
- **Copyright.** No game art, screenshots, logos or fonts are committed or referenced. The research helper
  could not download reference images (no network in its sandbox), so none were saved under
  `.kb/assets/bb-lively/2026-10-25-themes/refs/`.
- **Hex accuracy.** Source colours marked `~` in ART-DIRECTION.md are approximate. Only the Riso ink values
  (stencil.wiki via `riso-colors`) and the existing ZZZ values were sourced.

---

## 6. Recommendations: top 3

1. **Transistor "Cloudbank": build it first.**
   - It is the only candidate whose signature is tied to a real agent state, not decoration: approval wait
     as a Turn() freeze.
   - It is also the most complete art direction: sky, skyline, cartouche, cells wipe and sword hum. Its art
     is fully original, and it reads at 12.2:1.
   - Building it forces the shared work (art-layer contract, overrides), so every later preset is cheap.
2. **YoRHa: the best second pick.**
   - It is the most different from what exists: light-first, square, mechanical, no bounce.
   - It is also the most livable all day, because paper and ink are low-glare.
   - It costs one override and one status mark. Beside Transistor (dark, painterly, springy) and ZZZ (dark,
     wobbly), it completes the range.
3. **Joker: the fun one that still survives a workday.**
   - It uses wobbly at lively, the README's own all-day recommendation.
   - Statuses landing as score pops is the most delightful status feedback in the set.
   - The felt-and-swirl palette is calm at 11.8:1.

**If the owner wants different picks**:
- Hallownest is the safest dark daily driver, but overlaps Transistor.
- Ukiyo is the safest light one, with public-domain roots.
- Phantom is the loudest; good as a weekend preset.
