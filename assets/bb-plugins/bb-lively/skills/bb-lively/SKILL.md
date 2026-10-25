---
name: bb-lively
description: bb-lively (plugin id `bb-lively`), the bb plugin that adds themed presets (Calm, Lively, ZZZ; one setting for motion, bb's palette and an art layer) and motion to bb at three intensities and two styles, clean and a Zenless Zone Zero-style wobbly (button press, new timeline rows rising in, menu and dialog springs, send burst, sidebar thread status rings, composer focus glow, toast spring, switch/checkbox motion, thread transitions, an optional page wipe, a glow on the working line) and the optional Lively, Lively Dracula and Lively ZZZ palette themes. Use when asked about bb animations, micro-interactions or the wobbly/ZZZ style, to pick or add a preset, to change lively's motion mode, intensity, style, speed, effects, palette or art image, why an effect does nothing, or to report a bb selector lively relies on that broke after a bb update.
---

# bb-lively

lively runs in bb's window as a content script; agents cannot see its motion but can explain
and configure it. It works on any theme. Nothing moves while bbim's hints are showing
(`data-bbim-active` on `<html>`).

## Settings (Settings → Plugins → Lively)

`preset` picks an art direction; every other setting below defaults to `preset` (follow
it) and can be set to a value of its own, which then survives any preset switch. Effective
value = the explicit one, else the preset's, else the base default. The settings page's
**Preset** section lists each effective value and its source.

| Setting | Values | Base default (no preset) |
|---|---|---|
| `preset` | `custom` (none), `calm` (clean, subtle, no stickers/wipe), `lively` (clean at lively, Lively palette), `zzz` (wobbly at bold, skew, stickers, matched jelly, page wipe, Lively ZZZ palette, halftone backdrop) | `custom` |
| `motion` | `preset`, `system` (follows the OS reduce-motion preference), `full`, `reduced` (short fades only, no movement), `off` | `system` |
| `intensity` | `preset`, `subtle`, `lively`, `bold` (more overshoot, travel, blur-in, glow, send particles; every effect scales together) | `bold` |
| `style` | `preset`, `clean` (one soft overshoot), `wobbly` (after Zenless Zone Zero: a snap in, two or three bounces, squash, jelly, skew, tilt, flash, chromatic split) | `clean` |
| `skew` | `preset`, `on`, `off`: wobbly only, arriving rows skew in | on |
| `stickers` | `preset`, `wobbly` (hard offset shadows with the wobbly style), `always`, `off` | `wobbly` |
| `jelly` | `preset`, `shared`, `matched` (each intensity's own spring) | `shared` |
| `speed` | `preset`, `snappy` (0.8×), `normal`, `relaxed` (1.25×) | `normal` |
| `palette` | `preset` (picking a preset with a palette switches bb's theme to it; one without puts the person's theme back), `keep` (never touch bb's theme) | none |
| `art` | `preset`, `on`, `off`: the preset's backdrop, fonts and the art image | on |
| `artImage` | an https URL, or a path (absolute or `~/`) to a png/jpg/webp/gif/avif/svg on the bb machine; never commit one | empty |
| `press`, `hoverLift`, `listEnter`, `focusRing`, `sendPulse`, `statusPulse`, `toastSpring`, `overlayEnter`, `toggles`, `pageEnter`, `workingGlow` | `preset`, `on`, `off` | on |
| `pageWipe` (a slanted, dotted accent panel sweeps across a thread on switch) | `preset`, `on`, `off` | off |
| `typingGlow` (accent caret in the composer) | `preset`, `on`, `off` | off |
| `calmHost` (under reduced motion, also stop bb's own menu/dialog animations) | `preset`, `on`, `off` | off |

Set values with `bb plugin config bb-lively set <key> <value>` (`unset <key>` returns it to
From preset), or in the UI.

Under `reduced`, `press`, `hoverLift`, `toastSpring`, `toggles`, `pageWipe` and `workingGlow`
switch off; the rest keep only their fade, whatever the intensity or style (wobbly's own rules
run at the full level only). Sticker shadows stay: they are paint, not motion. Set values with `bb plugin settings` (see the bb CLI skill) or in the UI.

## Adding a preset

1. A row in `core/src/domain/presets.ts`: `id`, `label`, `description`, `artDirection`
   (its `ART-DIRECTION.md` section), `values` (any settings, `effects` included),
   `palette`, `art` (backdrop/sidebar CSS layers anchored `right bottom` in pixels, the
   image slot; a backdrop also repeats on bb's band behind the composer), `fonts` (stacks only).
2. Its palette: `themes/<palette>.css` and a `bb.themes` entry in `package.json`.
3. A signature effect, if any: a row in `core/src/domain/effects.ts` with
   `presets: ["<id>"]`, its rules in `core/src/dom/stylesheet.ts`.
4. No copyrighted art or font files: art is CSS; pictures come from the person's
   `artImage`. `npm run verify` checks the table, the palette registration and the art.

## Themes

`plugin:bb-lively:lively`, `plugin:bb-lively:lively-dracula` and their Bold variants
`plugin:bb-lively:lively-bold`, `plugin:bb-lively:lively-dracula-bold`, and
`plugin:bb-lively:lively-zzz` (near-black, lime and yellow, hard offset shadows) (`bb theme set <id>`). They
are palettes only (colors, radius, elevation, transition timing); the motion layer does not
depend on them.

## When an effect does nothing

1. `motion` is `off`, or `system` while the OS asks for reduced motion (then only the
   fade-safe effects run).
2. The effect's switch is off.
3. bb's markup moved. The plugin's settings page has **Selector health**: every bb selector
   lively uses that has not matched in this window, with where it shows. Visit that screen
   first (a thread, an open menu, a toast), then report the ones still listed, with the bb
   version (`bb --version`). All selectors live in `adapter/selectors.ts` of the plugin.

## Limits

- New rows animate only at the end of the thread, when you were not scrolling (or just
  sent), at most 4 at once. Rows that scroll back into view never animate.
- No exit animations for removed rows (bb unmounts them at once), no shake on a failed
  send (no event).
