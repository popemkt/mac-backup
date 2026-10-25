# bb-lively art direction

This is the canonical home for what each Lively theme is *after* and where that lives in code. Each theme is
mapped from its source look, to UI concepts, to the file, token, effect and selector that carry each concept.
The README and the research docs link here and do not restate these mappings.

Evaluations, contrast numbers, build costs and recommendations live in the research docs:
- [docs/research/2026-10-24-bb-theming-feasibility.md](../../../docs/research/2026-10-24-bb-theming-feasibility.md)
- [docs/research/2026-10-24-bb-lively-zzz-wobble.md](../../../docs/research/2026-10-24-bb-lively-zzz-wobble.md)
- [docs/research/2026-10-25-lively-theme-candidates.md](../../../docs/research/2026-10-25-lively-theme-candidates.md), which includes the
  proposed art-layer contract that the *planned* rows below refer to.

The visual mock of every candidate is
[docs/research/assets/2026-10-25-lively-theme-candidates.html](../../../docs/research/assets/2026-10-25-lively-theme-candidates.html).

## How a section is laid out

Every theme has the same two parts.

**A. Topic analysis (portable).**
- What defines the source, written with no bb terms, so another product can reuse it unchanged. kb's own
  art-direction file (popemkt/kb) uses the same five headings: **World**, **Art**, **UI**, **Motion** and
  **Sound → motion**.
- The **Anchors** line lists source colours by what they are in the source, not by bb role. Hex values marked
  `~` are approximate (sampled by eye or from memory), not measured.
- Copy a part A verbatim. Do not paraphrase it, so the two files stay comparable.

**B. bb translation.** A table with one row per concept:
- **Concept**: the UI idea.
- **From**: the cue in part A that it comes from.
- **Lives in**: file · token or effect id · selector.
- **Status**: `shipped`, `planned`, or `gap` (needs something bb does not offer).

Selectors are named by their key in `adapter/selectors.ts` (`pageView` is `[data-thread-window]`, `row`,
`focusBox`, `sendButton`, `statusRow`, `threadRow`, `toast`, `overlayOpen`, `working`). A new key is marked
*new target*.
- Effect ids are the keys of `EFFECTS` in `core/src/domain/effects.ts`.
- Motion tokens are the fields of `MotionTokens` in `core/src/domain/motion.ts`.
- Theme tokens are bb's custom properties in `themes/*.css`. `--lively-*` theme tokens are the planned
  art-layer contract.

Copyright: the dotfiles repo is public. Every piece of art here is drawn by us (SVG, CSS) in the spirit of
its source. No game art, screenshots, logos or fonts are committed. A user's own art goes through the
**user art slot** (planned; see the Transistor section and the research doc), which stays out of git.

---

## Lively

**A. Topic analysis.** Lively is a house style with no outside source.
- **World**: a calm workspace that feels awake.
- **Art**: warm paper neutrals and one soft violet. Corners are a little rounder than default. Elevation
  is soft and lifts upward.
- **UI**: no ornament. The accent marks focus, links and selection only.
- **Motion**: one spring family with a single overshoot; things arrive, settle and stop.
- **Sound → motion**: none.
- **Anchors**: paper `#faf8f5`, ink `#1f1d24`, violet `#5b4bd1`, teal `#0f7a6c`.

**B. bb translation.**

| Concept | From | Lives in | Status |
|---|---|---|---|
| Warm paper and violet accent | Art | `themes/lively.css` · `--canvas` `--ink` `--primary` `--timeline-accent` | shipped |
| Springier host transitions | Motion | `themes/lively.css` · `--default-transition-duration` 160ms, `--default-transition-timing-function`, `--ease-out` | shipped |
| Rounder corners, upward soft lift | Art | `themes/lively.css` · `--radius` .625rem, `--shadow-lift` | shipped |
| Accent carried further (Bold) | Art | `themes/lively-bold.css` · `--surface-selected` `--state-active` `--sidebar-accent` `--shadow-color` | shipped |
| One spring, one overshoot | Motion | `core/src/domain/motion.ts` · `MOTION_TOKENS.clean` · `springEasing` | shipped |
| Every micro-interaction | Motion | `core/src/domain/effects.ts` · all `EFFECTS` under `style: clean` | shipped |

## Lively Dracula

**A. Topic analysis.** Dracula is the editor theme by Zeno Rocha, 2013.
- **World**: a vampire's night in a code editor.
- **Art**: a purple-grey night with pastel neon accents (purple, pink, cyan, green, yellow).
- **UI**: flat, colour-coded syntax; the palette is the identity.
- **Motion**: none of its own.
- **Sound → motion**: none.
- **Anchors**: night `#282a36`, foreground `#f8f8f2`, purple `#bd93f9`, pink `#ff79c6`, cyan `#8be9fd`,
  green `#50fa7b`.

**B. bb translation.**

| Concept | From | Lives in | Status |
|---|---|---|---|
| bb's Dracula palette, verbatim | Art | `themes/lively-dracula.css` · top two blocks (copied from bb 0.46.1) | shipped |
| Lively's shape and timing on top | (Lively) | `themes/lively-dracula.css` · "Lively's tokens on top of Dracula" block | shipped |
| Accent carried further (Bold) | Art | `themes/lively-dracula-bold.css` · Bold block | shipped |

## Lively ZZZ (Zenless Zone Zero)

**A. Topic analysis.** HoYoverse's *Zenless Zone Zero* (2024). Source and measurements are in
`docs/research/2026-10-24-bb-lively-zzz-wobble.md` §1.
- **World**: New Eridu, a city-pop, 90s–2000s urban fantasy. Its story is told like an interactive comic,
  and its machines are CRT and VHS era.
- **Art**:
  - near-black panels with thick lighter bezels, like a CRT;
  - lime and yellow for "active", orange and red for events, cyan for reveals;
  - hard offset shadows and thick outlines, so things read as stickers;
  - halftone dots; parallelogram (skewed) shapes.
- **UI**:
  - heavy italic grotesque type, and letter-spaced small-caps strips;
  - tab pills that cut to the new tab, then swell once;
  - slanted, dotted wipe panels;
  - result tiles that pop in one per frame with a flash.
- **Motion**:
  - a hard attack (≤ 1–3 frames to full presence), then one short secondary motion (a swell, flash or
    settle);
  - exits are cuts;
  - the "wobble" people remember is the characters' squash, stretch and overlap, not the widgets.
- **Sound → motion**: the snap lands on the click. Idle loops belong to characters and marquees.
- **Anchors**: near-black `#0e0e10`, lime `#c8f031`, pressed-yellow `#f7da00`, event orange `#ff8a1f`,
  reveal cyan `#3fd4ff`.

**B. bb translation.**

| Concept | From | Lives in | Status |
|---|---|---|---|
| Near-black, lime and yellow palette | Art | `themes/lively-zzz.css` · `--canvas` `--primary` `--timeline-accent` | shipped |
| Hard offset shadows | Art | `themes/lively-zzz.css` · `--shadow-*` and `--shadow-lift` (hard offsets) | shipped |
| Tab cut, held still | UI | `themes/lively-zzz.css` · `--default-transition-timing-function` (snap); `motion.ts` · `snapEasing` | shipped |
| Fast attack, multi-bounce settle | Motion | `motion.ts` · `MOTION_TOKENS.wobbly` (`peakAt`, `overshoot`) · `BUDGETS.wobbly` | shipped |
| Character squash on press, jelly on release | Motion | `motion.ts` · `squash`, `jellyCoefficients`; effect `press`; selector `pressable` | shipped |
| Diagonal energy on arrival | Art (parallelograms) | `motion.ts` · `skew`; effect `listEnter`; selector `row`; setting `skew` | shipped |
| Tile pop with flash; slice glitch | UI | `motion.ts` · `flash`, `chroma`; effect `listEnter` (last row of a batch) | shipped |
| Swell after the snap | UI | `motion.ts` · `swell`; effect `focusRing` (wobbly); selector `focusBox` | shipped |
| Slanted dotted wipe | UI | effect `pageWipe`; `core/src/dom/stylesheet.ts` · `pageView::after` | shipped |
| Halftone send burst | Art | effect `sendPulse` (wobbly); `stylesheet.ts` · `.lively-send::after` | shipped |
| Sticker shadows on cards, menus and toasts | Art | setting `stickers`; `motion.ts` · `sticker` | shipped |
| Idle breathing | Motion (idle loops) | effect `workingGlow` (wobbly breathes in scale); selector `working` | shipped |
| Chromatic split colours (cyan/magenta) as theme tokens | Art | `stylesheet.ts` hard-codes `#3fd4ff` `#ff3dbb` → planned `--lively-chroma-a/b` | planned |
| Wipe dot texture and slant as theme tokens | UI | `stylesheet.ts` hard-codes the dots and the 105° mask → planned `--lively-wipe-fill/-mask` | planned |

---

## Transistor — "Cloudbank" (candidate, first pick)

**A. Topic analysis.** Supergiant Games' *Transistor* (2014). Art direction by Jen Zee, music by Darren Korb.
- **World**:
  - Cloudbank is a city where citizens vote on the weather and the colour of the sky.
  - The Process, an intelligence of white, blocky machines, erases the city into blank geometry.
  - A singer, Red, carries the Transistor, a talking sword that holds a voice.
- **Art**:
  - painterly, with Art Nouveau composition (Mucha, Klimt, Waterhouse are her stated influences): long
    curving lines, gold linework, arched and domed towers;
  - a muted night palette under a vivid atmosphere: violet-blue dusk, warm orange-red and magenta glows
    at the horizon;
  - the sword's turquoise light;
  - the Process reads as white blocks with red-orange points, and erased areas as white cells.
- **UI**:
  - functions are written as programs (`Crash()`, `Breach()`, `Jaunt()`); menus read like a computer
    terminal inside an Art Nouveau frame;
  - **Turn()** freezes time and draws the world as a plan:
    - a bar at the top drains as actions are queued;
    - the planned path is drawn;
    - on release the queued actions run at super-speed;
    - a recovery follows while the bar refills.
  - Limiters are optional handicaps chosen at Access Points.
- **Motion**:
  - long, graceful arcs in the art against sharp, instant execution in combat: plan slowly, then act at
    once;
  - the Process breaks things into square cells;
  - the sword-light hums and brightens as it speaks.
- **Sound → motion**:
  - the score is muffled (an EQ low-pass) during Turn() and pause, which is a "freeze" cue;
  - Red's held hum (holding a button) is a sustained, breathing note;
  - the sword's flash is synced to its voice.
- **Anchors** (all `~`):
  - dusk violet `#13142a`–`#2a1c48`;
  - turquoise sword-light `#3ee6d4`;
  - gold line `#e0b25a`;
  - Red's orange-red `#e8503a`, Cloudbank magenta `#d94f8a`;
  - Process white `#f2efe6`.

**B. bb translation.**

| Concept | From | Lives in | Status |
|---|---|---|---|
| Dusk violet canvas, turquoise accent, gold accent, Red as destructive | Art | new `themes/lively-transistor.css` · `--canvas #13142a` `--primary #3ee6d4` `--timeline-accent #e0b25a` `--destructive #ff6b57` `--pr-merged #d94f8a` | planned |
| Cloudbank day (light mode) on parchment | Art | same file · `:root, .light` block (`--canvas #f3ecdf`, `--primary #08706a`) | planned |
| Painted dusk sky with brush texture | Art | theme token `--lively-art-timeline` (gradients); painted by lively on `pageView::before` | planned |
| Skyline: far towers, a turquoise rim, near towers, lit windows | Art (Cloudbank) | theme tokens `--lively-art-timeline-{1..4}-paint/-mask` (our own SVG masks); painted by lively on stacked pseudo-layers of `pageView` | planned |
| Art Nouveau cartouche around the sidebar head | Art | theme tokens `--lively-art-sidebar-paint/-mask`; *new target* `sidebar` (`[data-sidebar="content"]`, to be captured in the fixture) | planned |
| **Turn() = approval wait** | UI (Turn()) | **new effect `turnFreeze`**; trigger: the open thread's indicator becomes `waiting-for-input` (the seam already read in `adapter/bb.ts`) | planned |
| ↳ the world freezes into a plan | UI, Sound (EQ muffle) | `turnFreeze` · `filter: saturate() brightness()` on `rowList`, a cyan wireframe veil on `rowList::after` | planned |
| ↳ the Turn() bar fills, queued actions pop in | UI | `turnFreeze` · on `focusBox::before` (a `scale` fill on the spring); queued marks use `overlayMs` | planned |
| ↳ planned path dashed down the gutter, a node per row | UI | `turnFreeze` · `rowList::before` plus a diamond on each `row::after` | planned |
| ↳ approve = execute | Motion (instant execution) | `turnFreeze` exit · one `brightness` flash (the `flash` token), then the bar drains on the exit ease | planned |
| Trace of a new row | UI (planned path) | **new effect `traceLine`** (or `listEnter` with an arrival mark, see the research doc) · `row::before`, `scale` from the top | planned |
| Process wipe: the thread dissolves through square cells | World (the Process) | effect `pageWipe` with theme tokens `--lively-wipe-fill` (grid) and `--lively-wipe-mask` (stepped cells) | planned |
| Function sparks on send | UI (functions) | effect `sendPulse` with `--lively-burst-fill` (radial rays) | planned |
| Sword hum while working | Sound (hum), Motion | effect `workingGlow` with a preset override `breatheMs: 3200`, `glow: .3` and a small scale breath | planned |
| Display type for the brand and headers | Art (Art Nouveau lettering) | `--lively-font-display` (Josefin Sans or Federo, both OFL, bundled by the plugin) · headers only, needs a *new target* | planned |
| Red's colours in the chromatic split | Art | `--lively-chroma-a: #3ee6d4`, `--lively-chroma-b: #e8503a` | planned |
| User's own key art behind the timeline | (owner's art) | **user art slot**: setting `artImage` (a URL, such as a kb asset served on the tailnet, or a host path) → `--lively-user-art` on `:root`, layered under the theme's own art at ≤ 50% with a mask that keeps the reading column clear | planned |
| The game's own art, logo or font | — | never committed (public repo); only through the user art slot | — |

## Persona 5 — "Phantom" (candidate)

**A. Topic analysis.** Atlus' *Persona 5* (2016). Art director Masayoshi Sudo.
- **World**: Tokyo high-schoolers by day; by night, phantom thieves who steal corrupted hearts and send a
  calling card first.
- **Art**:
  - crimson red, black and white only, with no gradations;
  - ransom-note collage lettering;
  - slashing diagonals, jagged shapes, stars and halftone.
- **UI**:
  - every menu is its own composition;
  - the hovered item grows and gains colour;
  - selection is a skewed red slab;
  - cut-ins slam a character band across the screen.
- **Motion**: slam-in with rotation, hard cuts, overshoot on everything, constant diagonal energy.
- **Sound → motion**: acid-jazz stabs land on the cut; the menu "shing" lands on selection.
- **Anchors**: crimson `#e5191c` ~, black `#0a0a0a`, white `#ffffff`.

**B. bb translation.**

| Concept | From | Lives in | Status |
|---|---|---|---|
| Red, black and white palette; sharp corners | Art | new `themes/lively-phantom.css` · `--primary #ff2a2a` `--canvas #0b0b0b` `--radius 2px` | planned |
| Skewed red slab for the selected row | UI | theme element block on the selected sidebar row (`.bb-sidebar-selected-row`, rated M) or `--surface-selected` alone | planned |
| Slam-in with skew and multi-bounce | Motion | preset: style `wobbly`, intensity `bold`, `skew` on, speed `snappy` | planned |
| Red sticker shadows | Art | setting `stickers: always` + planned `--lively-sticker-color` (today `#000` is hard-coded in `stylesheet.ts`) | planned |
| Calling-card wipe (jagged) | UI | effect `pageWipe` with `--lively-wipe-mask` (jagged polygon) and `--lively-wipe-fill` | planned |
| Star burst on send | Art | effect `sendPulse` with `--lively-burst-mask` (star) | planned |
| Shard backdrop and halftone | Art | `--lively-art-timeline` + one masked layer (our own shards) | planned |
| Cut-in band on a finished thread | UI (cut-ins) | **new** status mark `cutIn` (off by default) | planned |

## NieR:Automata — "YoRHa" (candidate)

**A. Topic analysis.** PlatinumGames / Square Enix's *NieR:Automata* (2017). UI by Kijima, at Yoko Taro's
request for "a nice, warm beige".
- **World**: androids fighting machines for a humanity that is gone; melancholy, uncanny.
- **Art**:
  - warm beige paper with dark khaki ink and a muted red-orange accent;
  - a faint grid, edge darkening, like a convex monitor;
  - motifs from musical scores (staff lines, clefs, colons).
- **UI**:
  - square corners and bracketed corners;
  - inverted (dark-on-beige) selection with a small square marker;
  - condensed, letter-spaced labels;
  - a self-destruct function that breaks the UI itself.
- **Motion**:
  - precise and mechanical: linear slides and steps, scan lines;
  - glitch and slice on damage;
  - the developers tuned animations to look "a little moist", so they are soft, not bouncy.
- **Sound → motion**: Pod chatter and menu blips are short and digital.
- **Anchors**: beige `#cfc8ae`–`#dad4bb`, khaki ink `#4e4b42` ~, rust `#8e3b26` ~.

**B. bb translation.**

| Concept | From | Lives in | Status |
|---|---|---|---|
| Beige paper, khaki ink, rust accent; square corners | Art | new `themes/lively-yorha.css` (light-first; a night block) · `--radius 0` | planned |
| Inverted selection | UI | `--surface-selected` = ink and `--primary-foreground` = paper | planned |
| Grid and corner brackets | Art | `--lively-art-timeline` (grid) + two masked bracket layers | planned |
| Mechanical, no bounce | Motion | preset: `clean`, `subtle`, `snappy`, with a **per-preset token override** `overshoot: 0` | planned |
| Scan-bar wipe | UI | effect `pageWipe` with `--lively-wipe-fill` (horizontal bars) | planned |
| Glitch on failure | Motion (damage) | status mark `slice` on `statusRow` (failure tone) | planned |
| Bracket focus instead of glow | UI | `focusRing` variant: an outline with an offset (theme element block on `focusBox`, or a planned `--lively-focus-shape` token) | planned |

## Hollow Knight — "Hallownest" (candidate)

**A. Topic analysis.** Team Cherry's *Hollow Knight* (2017).
- **World**: a fallen insect kingdom underground. Caverns, a drowned city where it always rains (City of
  Tears), and silence.
- **Art**:
  - hand-drawn ink lines on blue-black depths;
  - pale bone-white figures and a pale-blue "soul" light;
  - gothic arches, hanging drips, vignettes.
- **UI**: sparse; ornamental frames around a few words; serif display type.
- **Motion**:
  - fades from black, slow drifting particles, weightless floats;
  - a quick flash on a hit; everything else is slow.
- **Sound → motion**: a long reverb tail with sparse piano and strings. Motion lingers and does not snap.
- **Anchors** (all `~`): depth `#0e1317`, bone `#efe4c4`, soul-blue `#b7d4f0`.

**B. bb translation.**

| Concept | From | Lives in | Status |
|---|---|---|---|
| Blue-black depths, bone and soul accents | Art | new `themes/lively-hallownest.css` | planned |
| Vignette, ceiling drips, the city's arch, rain streaks | Art, World | `--lively-art-timeline` (vignette) + masked layers (drips, arch) + `--lively-art-overlay` (rain, ≤ 4%) | planned |
| Slow, weightless motion | Motion, Sound | preset: `clean`, `subtle`, speed `relaxed`, `blur: 1` override | planned |
| Thread opens out of darkness | Motion (fade from black) | effect `pageEnter` with a per-preset `flash` override below 0 (brightness rises from dark) | planned |
| Soul motes rise on success | Motion (particles) | status mark `rise` on `statusRow` | planned |

## Balatro — "Joker" (candidate)

**A. Topic analysis.** LocalThunk's *Balatro* (2024).
- **World**: a poker roguelike in a smoky, psychedelic card room.
- **Art**:
  - a felt table under a swirling red and blue paint background;
  - chips blue and mult red, money gold, tarot purple;
  - a CRT shader with scanlines and barrel warp;
  - a pixel font.
- **UI**:
  - cards with dark drop shadows that tilt toward the cursor and sway;
  - score counters that pop, shake and tick up;
  - floating "+chips" and "×mult" tags.
- **Motion**: springy, jittery and juicy. Everything scores with a pop and a shake.
- **Sound → motion**: chip clinks and a rising pitch per scored card. Each event is a short percussive pop.
- **Anchors** (all `~`): felt `#1b2b2b`, chips `#009dff`, mult `#fe5f55`, money `#f5b143`, tarot `#8867a5`.

**B. bb translation.**

| Concept | From | Lives in | Status |
|---|---|---|---|
| Felt, chips, mult and money palette | Art | new `themes/lively-joker.css` | planned |
| Pinwheel swirl background | Art | `--lively-art-timeline` (conic gradients, darkened at the centre) | planned |
| CRT scanlines and vignette | Art | `--lively-art-overlay` (≤ 6% at a 3 px pitch, static) | planned |
| Cards tilt and carry a dark shadow | UI | preset: `wobbly`, `lively`, `stickers: always`, `jelly: matched`; `--lively-sticker-color` dark | planned |
| Score pop on a status change | UI | status mark `float` on `statusRow` (text from the tone: "+40 chips", "×0 bust") | planned |
| Pixel font | Art | not proposed for body text; m6x11's licence is unconfirmed, so use Silkscreen (OFL) for marks only | gap |

## Splatoon — "Turf" (candidate)

**A. Topic analysis.** Nintendo's *Splatoon* (2015–).
- **World**: inklings, who are squid kids, cover a city in their team's ink. Turf is territory.
- **Art**:
  - two clashing saturated team inks (pink and lime, purple and yellow);
  - splats, drips, graffiti stickers;
  - rounded, squishy shapes.
- **UI**: ink-splat panels, wobbling buttons, splatted transitions.
- **Motion**: squash and stretch everywhere, gooey overshoot, splats on impact.
- **Sound → motion**: wet "splat" impacts and bubbly pops.
- **Anchors** (all `~`): ink pink `#ff4fa3`, ink lime `#eaff3d`, night purple `#15121d`.

**B. bb translation.**

| Concept | From | Lives in | Status |
|---|---|---|---|
| Two team inks on night purple; round corners | Art | new `themes/lively-turf.css` · `--radius 16px` | planned |
| Squish everything | Motion | preset: `wobbly`, `bold`, `jelly: matched`, stickers off | planned |
| Splat on send | Motion (impact) | effect `sendPulse` with `--lively-burst-mask` (splat) | planned |
| Ink-wall wipe | UI | effect `pageWipe` with `--lively-wipe-mask` (blob edge) | planned |
| Corner splats | Art | two masked layers in the two inks, kept to corners away from the reading column | planned |

## Risograph — "Riso" (candidate)

**A. Topic analysis.** Riso printing, as used by zines and small presses.
- **World**: independent print culture: stencils, drums, paper stock.
- **Art**:
  - two or three translucent spot inks (Blue `#0078bf`, Fluorescent Pink `#ff48b0`, Teal `#00838a`);
  - misregistration between passes;
  - halftone dots and paper grain.
- **UI**: no native UI. Its graphic language is overprint, offset and dot screens.
- **Motion**: none native. Translated as a second ink pass landing slightly off, then registering.
- **Sound → motion**: the drum's rhythmic thunk is a stamp.
- **Anchors**: paper `#f5efe3`, Riso Blue `#0078bf`, Fluorescent Pink `#ff48b0` (screen approximations of
  inks that cannot be shown on screen).

**B. bb translation.**

| Concept | From | Lives in | Status |
|---|---|---|---|
| Paper and two inks; pink never as text | Art | new `themes/lively-riso.css` (light-first) | planned |
| Misregistered second ink as the shadow | Art | `stickers: always` + `--lively-sticker-color: #ff48b0` | planned |
| Misregistration on arrival | Motion | effect `listEnter` with a per-preset `chroma: 2` override in `clean`, and `--lively-chroma-a/b` set to the inks | planned |
| Grain and halftone | Art | `--lively-art-overlay` (static noise SVG) + one masked halftone layer | planned |
| Halftone wipe | UI | effect `pageWipe` with `--lively-wipe-fill` (two dot screens) | planned |

## Ukiyo-e — "Ukiyo" (candidate)

**A. Topic analysis.** Edo-period woodblock prints (Hokusai, Hiroshige). The works are public domain.
- **World**: the floating world: travel stations, seasons, waves and Fuji.
- **Art**:
  - Prussian blue ("bero") layered with indigo, on washi paper;
  - a vermilion seal;
  - carved line bands and flat colour;
  - seigaiha (wave-scale) patterns.
- **UI**: no native UI. Its graphic language is the cartouche title, the seal stamp and the carved line.
- **Motion**: none native. Translated as ink bleeding into paper, a single brush stroke, a stamped seal.
- **Sound → motion**: the press and the stamp are single deliberate beats.
- **Anchors**: washi `#f1eadb`, Prussian blue `#1f4a85` (the pigment is about `#003153`), vermilion
  `#b8382a`; the night mode borrows Kanagawa's sumi `#1f1f28`, fuji-white `#dcd7ba` and crystal blue
  `#7e9cd8`.

**B. bb translation.**

| Concept | From | Lives in | Status |
|---|---|---|---|
| Washi, Prussian blue and a vermilion accent | Art | new `themes/lively-ukiyo.css` (light-first; a Kanagawa-derived night block) | planned |
| Ink bleed on arrival | Motion | preset: `clean`, `subtle`, `relaxed`, `blur: 3` override | planned |
| Brush-stroke wipe | UI | effect `pageWipe` with `--lively-wipe-mask` (brush) | planned |
| Seigaiha sidebar, curling wave behind the composer | Art | masked layers (our own drawings) on the sidebar and on `pageView` | planned |
| Seal stamped on a finished thread | UI (seal) | status mark `stamp` on `statusRow` | planned |
