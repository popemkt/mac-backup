---
name: bb-lively
description: bb-lively (plugin id `bb-lively`), the bb plugin that adds motion to bb at three intensities (button press, new timeline rows rising in, menu and dialog springs, send burst, sidebar thread status rings, composer focus glow, toast spring, switch/checkbox motion, thread transitions, a glow on the working line) and the optional Lively and Lively Dracula palette themes with Bold variants. Use when asked about bb animations or micro-interactions, to change lively's motion mode, intensity, speed or effects, why an effect does nothing, or to report a bb selector lively relies on that broke after a bb update.
---

# bb-lively

lively runs in bb's window as a content script; agents cannot see its motion but can explain
and configure it. It works on any theme. Nothing moves while bbim's hints are showing
(`data-bbim-active` on `<html>`).

## Settings (Settings → Plugins → Lively)

| Setting | Values | Default |
|---|---|---|
| `motion` | `system` (follows the OS reduce-motion preference), `full`, `reduced` (short fades only, no movement), `off` | `system` |
| `intensity` | `subtle` (v1's quiet motion), `lively`, `bold` (more overshoot, travel, blur-in, glow, send particles; every effect scales together) | `bold` |
| `speed` | `snappy` (0.8×), `normal`, `relaxed` (1.25×) | `normal` |
| `press`, `hoverLift`, `listEnter`, `focusRing`, `sendPulse`, `statusPulse`, `toastSpring`, `overlayEnter`, `toggles`, `pageEnter`, `workingGlow` | on/off | on |
| `typingGlow` (accent caret in the composer) | on/off | off |
| `calmHost` (under reduced motion, also stop bb's own menu/dialog animations) | on/off | off |

Under `reduced`, `press`, `hoverLift`, `toastSpring`, `toggles` and `workingGlow` switch off;
the rest keep only their fade, whatever the intensity. Set values with `bb plugin settings` (see the bb CLI skill) or in the UI.

## Themes

`plugin:bb-lively:lively`, `plugin:bb-lively:lively-dracula` and their Bold variants
`plugin:bb-lively:lively-bold`, `plugin:bb-lively:lively-dracula-bold` (`bb theme set <id>`). They
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
