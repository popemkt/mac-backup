# bb-plugin-bb-lively

A motion layer (three intensities × two styles), five palette themes, and themed presets
that set motion, palette and an art layer as one art direction, for bb. See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md)
for what a person gets, [core/README.md](core/README.md) for the engine, and the design in
[docs/research/2026-10-24-bb-theming-feasibility.md](../../../docs/research/2026-10-24-bb-theming-feasibility.md).

## Layout

| Path | Role |
|---|---|
| `core/` | `@popemkt/bb-lively-core`: the bb-agnostic engine (effects table, settings, presets and the resolver, motion tokens per intensity, motion policy, stylesheet and the presets' art, row watcher, pulses, selector canary) with its own tests. An npm workspace, so `bb plugin build` bundles it from `node_modules/@popemkt/bb-lively-core` (a symlink to `core/`). |
| `adapter/selectors.ts` | **Every bb selector, and nowhere else**, each with a rating, the bb version it was verified on, and where it shows. The one file to check after a bb upgrade. |
| `adapter/settings.ts` | The settings table bb is told about (`server.ts`) and reads back (`app.tsx`), and `effectiveSettings`, the one path from bb's values to effective ones. |
| `adapter/palette.ts` | When a settings write changes the preset's palette: which bb theme to switch to, and the person's own theme to put back. |
| `adapter/art.ts` | Serves the person's art image when it is a file on the bb machine. |
| `adapter/bb.ts` | Mounting, sends, sidebar indicator → pulse tone, and the canary for the settings page. |
| `app.tsx` | The `motion` content script; a headless app overlay for settings and one for `experimental_useSidebarThreads` (feature-detected); an invisible composer action for `useComposer().onSubmitted` and the accent caret (`setTextEffect`); the Preset settings section (every effective value and its source, a one-click palette switch) and the selector-health one. |
| `server.ts` | `bb.settings.define`, the palette switch on `settings.onChange`, and the art image route. |
| `themes/` | `lively.css`, `lively-dracula.css`, their `-bold` variants, `lively-zzz.css`, `lively-cloudbank.css`, `lively-yorha.css` and `lively-control.css` (manifest `bb.themes`): tokens only, no motion. A bold file is its base palette copied plus a Bold block at the end (one theme is active at a time, so it cannot import the base): keep each pair in step. |
| `ART-DIRECTION.md` | **Canonical** per-theme art direction: each theme's source analysis, its translation into UI concepts, and where each concept lives in code (shipped or planned). |
| `skills/bb-lively/` | Tells agents what lively does, its settings, and how to report a broken selector. |
| `tests/` | Adapter tests, and `fixtures/bb-0.46.1.html` and `fixtures/bb-0.46.1-request.html` (a thread waiting on a question): bb's markup captured from the web UI (structure and attributes only) that `selectors.test.ts` runs the table against. |

## How it works

- One `<style data-bb-lively>` built from the targets (`core/src/dom/stylesheet.ts`). Every
  effect's rules are scoped to a root attribute (`:root[data-lively-press]`); the content
  script writes `data-lively` (`full`/`reduced`), `data-lively-source`, `data-lively-intensity`,
  `data-lively-speed` and one attribute per running effect onto `<html>`. A settings change rewrites attributes,
  never the sheet. Abort removes the sheet, every attribute and every running class.
- **One set of motion tokens per intensity** (`core/src/domain/motion.ts`): durations,
  overshoot, rise, lift, blur, stagger, scales, burst and glow. `subtle` is v1's numbers;
  `lively` and `bold` raise every token together. The sheet emits each set as
  `--lively-*` custom properties under `:root[data-lively-intensity=...]`; effect rules use
  only those, never a number of their own (the stylesheet test enforces it). Presses stay
  at most 100 ms and anything that runs once at most 400 ms. Tokens are keyed by
  (style, intensity). `wobbly` (the ZZZ style, docs/research/2026-10-24-bb-lively-zzz-wobble.md)
  is a second row of tokens with an earlier first peak (`peakAt`) and the style tokens
  `squash`, `skew`, `tilt`, `sticker`, `swell`, `flash` and `chroma`, all at rest in `clean`.
  Budgets are per style (`BUDGETS`): clean keeps its caps (presses 100 ms, the rest 400 ms);
  wobbly caps the time to land (`landsAt`) at 120 ms and the total at 560 ms.
- **Two styles, one set of effects.** Each effect's wobbly variant is a second rule scoped to
  `:root[data-lively="full"][data-lively-style="wobbly"]`, which outweighs the clean rule and
  never runs under reduced motion. `data-lively-skew="on"`, `data-lively-stickers="on"` and
  `data-lively-jelly="matched"` carry the style's settings. The skew-in is the only
  `transform` keyframe and runs only with `animation-composition: add`, onto the row's own
  transform, never on toasts (the stylesheet test enforces both). The page wipe slants with a
  mask and moves by `translate` only; it sets `position: relative` on the thread window, which
  moves none of its children (checked live: no absolutely positioned descendant used an
  outer containing block).
- **One easing family.** Every entrance uses a spring generated as CSS `linear()` from a
  damped oscillator whose peak is the intensity's overshoot; overshoot 0 is the plain
  ease-out, and exits use its mirrored ease-in.
- **Retiming instead of replacing.** Menus and dialogs keep bb's own tw-animate `enter`/`exit`
  keyframes; lively sets their per-element variables (`--tw-duration`, `--tw-ease`,
  `--tw-enter-scale`, `--tw-enter-blur`). Toasts and switch thumbs keep their transitions; lively changes only
  timing functions.
- **Reduced motion.** `system` follows `prefers-reduced-motion` live. Reduced keeps only the
  effects with an opacity-only form, at 120 ms, at every intensity: bold collapses to the same
  fades, through token overrides (no rise, blur, burst, overshoot or breathing). The sheet repeats those overrides under the media query, so a stale `full` never
  animates for someone whose OS asks for less.
- **Budget.** Keyframes and transitions move only transform (`scale`, `translate`, `rotate`),
  `opacity` and `filter`; glows, rings and the send particles are pseudo-elements; the only
  loops are the composer's breathing glow and the working line, both stopped by reduced motion;
  one-shot animations never fill forwards; `will-change` only on the one-animation enter class;
  at most 4 rows animate at once; no layout reads (the row watcher reads attributes only).
  `core/tests/stylesheet.test.ts` gates these.
- **bbim.** bbim sets `data-bbim-active` on `<html>` while its hints or a picker show. Every
  lively rule carries `:not([data-bbim-active])` and nothing new starts, so labels are placed
  on elements at rest.

## Presets

A preset is one row in `core/src/domain/presets.ts`: an id, a label, a description, a link
to its section of `ART-DIRECTION.md`, a partial map of setting values (any setting, effect
switches included), a palette (one of the themes below), an art block and font tokens.
Seeds: **Custom** (none, the default), **Calm** (clean, subtle, no stickers or wipe),
**Lively** (clean at lively, the Lively palette) and **ZZZ** (wobbly at
bold, skew, stickers with wobbly, matched jelly, the page wipe, the Lively ZZZ palette, a
halftone-and-slash backdrop that runs to the bottom edge, hazard stripes under the sidebar). Full art
directions: **Cloudbank** (after Transistor: clean at lively, a dusk skyline, a cyan cell
wipe, and the `turnFreeze` effect) and **YoRHa** (after NieR:Automata: snappy, no
overshoot or blur through its own `tokens`, a technical grid, a scan-bar wipe, and the
`glitch` effect) and **Control** (after Remedy's Control: no overshoot or tilt, coffered
concrete and the Board, a redaction wipe, the `shiftWarp`, `prismEdge` and `hissResonance`
effects drawn on an HTML-in-Canvas layer when the browser has one, a send the Hiss takes as
dust, and bb's own controls dressed as the Bureau's forms and signage, at rest); each is
mapped from source to code in `ART-DIRECTION.md`.

**The send.** Each preset sends in its own form (`core/src/domain/send.ts`), through one
sequence (`core/src/dom/send.ts`): the words you send leave the composer as a ghost and the
message lands in the thread along the same path. Calm, Lively and Custom glide; ZZZ slaps;
Cloudbank runs as a Process function; YoRHa scans; Control turns the words into the Hiss's
dust drifting up, on WebGL 2 particles, and condenses the message out of it. The send button
answers at once: it gathers itself as Enter goes down and lets go on the preset's spring as
the words leave. Reduced motion keeps a fade.

**Message motion** (`sendPulse`) is the switch for all of it: the send, the message landing,
the first reply arriving and the send button's answer. It is independent of **Motion** (which,
set to off, stops everything) and defaults to on; a preset can set its own default
(`values.effects.sendPulse`). `bb plugin config bb-lively set sendPulse off` turns messages
back to bb's own while the rest of lively's motion stays.

**Override semantics.** Every presettable setting is a select whose first option, and
default, is **From preset**; switches are From preset / On / Off. The effective value is
the explicit one if set, else the preset's, else the base default (core
`resolve(choices, presets)`, which also reports each value's source). Choosing ZZZ moves
everything still on From preset; anything set by hand survives a preset switch. Why
selects: bb 0.46.1's settings cannot be unset from the UI, a boolean is a two-state
switch, and a descriptor's description is fixed at registration, so "unset" had to be a
value of its own and the effective values ("Style: Wobbly, from ZZZ") live in lively's
**Preset** settings section. The cost: effect switches are dropdowns, and a switch
stored before presets falls back to From preset, which equals its old default (bb resets
a stored value whose type changed). See the gap in `adapter/settings.ts`.

**Palette.** A plugin can switch bb's theme (`bb.sdk.theme.set`), so the server does,
once, when a settings write changes the effective palette, and never on load: a theme
picked in Appearance afterwards stays. The theme the person had is remembered and put
back when they pick a preset without a palette, unless they changed theme since. The
**Palette** setting's Keep my bb theme turns this off; the Preset section offers a
one-click switch either way.

**Art** is lively's own, painted under `:root[data-lively-art="on"][data-lively-preset]`
by `core/src/dom/art.ts`, so look and motion switch together: CSS layers on a `::before`
behind the open thread and the sidebar, a preset's **skin** (`PresetArt.skin`: paint for
bb's own controls, role by role, such as Control's Bureau forms), font stacks over bb's
`--font-sans`/`--font-mono`,
and the person's **Art image** (an https URL, or a file on the bb machine served at
`/api/v1/plugins/bb-lively/http/art`), washed toward the canvas on the preset's image
surface. The repository is public: no game art and no font files are committed; every
preset looks finished without the image. Art is paint, not motion: it stays under reduced
motion and with motion Off; only the **Art** switch turns it off.

**The dock.** With a backdrop, bb's opaque band behind the composer repeats the art, so it
runs to the bottom edge: backdrop layers and masks are anchored to the bottom-right corner
in fixed pixels (the tests enforce it) and the image is fixed to the window, so the two
meet without a seam. The band sits inside the thread's scroller, so a classic scrollbar
pulls its right edge in from the thread's; lively measures that gap and the band's art
reaches past it to the thread's corner (`core/src/dom/reach.ts`), or every slanted stroke
would step sideways at the dock. bb's solid fade just above the composer, which would cut
the art off, is hidden. The composer keeps bb's own surface, minus its hard offset
shadows, which would cut a dark sliver into the art.

**A preset's own motion and paint.** `tokens` lays a preset's motion character over every
(style, intensity) at the full level (YoRHa: no overshoot, no blur, no tilt, no lift
shadow), never under reduced motion; the tests hold it to the style's budget. `paint`
recolors and reshapes the shared effects: the page wipe's panel (`--lively-wipe-fill`,
`--lively-wipe-mask`) and the chromatic split's colors (`--lively-chroma-a/-b`). Art
`colors` are set once per preset as `--lively-c-<name>`, each reading the palette's own
`--lively-art-<name>` token with a fallback, so the art follows the theme's light and dark
modes and still works on any other theme. `lettering` is the words lively itself prints
under a preset and their face (tracked capitals): a caption down the sidebar's gutter (art),
the page wipe's label (`paint.wipe.label`), and Turn()'s own label. Cloudbank prints its
functions as calls: `Crash() Breach() Jaunt() Load() Spark()`, `Jaunt()`, `Turn()`.

**Turn()** (`turnFreeze`, Cloudbank) needs no script: bb renders a pending approval,
question, plan review or plugin request as a banner in the composer's dock
(`pendingRequest` in `adapter/selectors.ts`, the canary watches it), inside the thread
window and outside the timeline, so `[data-thread-window]:has(<request>)` freezes the
timeline's rows (a filter), raises a grid veil behind them, and lights the request. The
**glitch** (YoRHa) rides the status pulse: a sidebar row whose thread fails tears sideways
in hard steps, even with the status rings off.

**The HTML-in-Canvas layer** (Control; `core/src/dom/drawable.ts`, `core/src/dom/refraction.ts`).
An effect with a `canvas` trigger (`navigate`, `send`, `waiting`) has two halves. When the
browser has HTML-in-Canvas (Chrome's `CanvasDrawElement`, detected by method name across
both API generations: `texElementImage2D` before 155, `texElementSubImage2D` and
`content="drawable"` from 155, which Chromium 154 mixes) and WebGL 2, and motion is at the
full level, lively sets `data-lively-canvas` on the root and the effect draws on one fixed
canvas: `pointer-events: none`, `aria-hidden`, an `inert` stage, `display: none` at rest,
and its WebGL context made at the first scene, not before (if it fails then, the root
attribute goes and the CSS halves take over). An effect's `canvas` names the scene it plays
(`SCENE_MODES` in `refraction.ts`; a test holds every trigger to a scene and a CSS half).
The Hiss resonates for 4.5 s once per request, never in a loop.
Each scene uploads a sanitized clone (no ids, `data-*`, frames or media) of what it draws
and runs one fragment shader for its length. Otherwise the CSS half runs, scoped
`:not([data-lively-canvas])`. A thread switch snapshots the outgoing thread on the
Navigation API's `navigate` event, before the router renders the next one. bb's desktop app
gets the switch from the launcher in `modules/stacks/bb/launcher.nix`
(`my.stacks.bb.desktopSwitches`); a browser needs the flag set.

**Adding a preset** (the Transistor one, say): a row in `presets.ts`; its palette as
`themes/<id>.css` plus a `bb.themes` entry in `package.json` (a test checks every preset's
palette is registered); its art as CSS layers in the row (anchored right bottom, in
pixels); a signature effect, if any, in `effects.ts` with `presets: ["<id>"]` and its rules
in `stylesheet.ts`; and its section in `ART-DIRECTION.md` (topic analysis → UI/UX concept
→ where it lives in source). Design notes:
[docs/research/2026-10-25-bb-lively-presets.md](../../../docs/research/2026-10-25-bb-lively-presets.md).

## Effects held back

Thread transitions and the working glow, held back in v1, now ship: bb mounts
`[data-thread-window]` per split pane and keeps it mounted across a thread switch, so a
switch (a path change, seen through the Navigation API and `popstate`) replays the entrance
with a class; the "Working..." line is bb's named
`.animate-shine`. From the design's list, the fragile ones (rated H) are still left out
rather than shipped off: copy-button feedback,
mention-chip pop-in, the undo-countdown toast bar, pin-to-top (needs FLIP, i.e. layout
reads) and a denied-send shake (no failed-send event). Sidebar row arrival is also left
out: bb already runs its own list motion there.

## Develop

```sh
npm ci
npm run verify   # typecheck + oxlint + tests (core and adapter) + bb plugin build
```

After a bb upgrade: open the plugin's settings page, visit a thread, open a menu and a
dialog, and read **Selector health**; recapture the fixture if bb's markup moved.
