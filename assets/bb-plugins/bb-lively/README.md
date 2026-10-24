# bb-plugin-bb-lively

A motion layer (three intensities × two styles) and five palette themes for bb. See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md)
for what a person gets, [core/README.md](core/README.md) for the engine, and the design in
[docs/research/2026-10-24-bb-theming-feasibility.md](../../../docs/research/2026-10-24-bb-theming-feasibility.md).

## Layout

| Path | Role |
|---|---|
| `core/` | `@popemkt/bb-lively-core`: the bb-agnostic engine (effects table, settings, motion tokens per intensity, motion policy, stylesheet, row watcher, pulses, selector canary) with its own tests. An npm workspace, so `bb plugin build` bundles it from `node_modules/@popemkt/bb-lively-core` (a symlink to `core/`). |
| `adapter/selectors.ts` | **Every bb selector, and nowhere else**, each with a rating, the bb version it was verified on, and where it shows. The one file to check after a bb upgrade. |
| `adapter/settings.ts` | The settings table bb is told about (`server.ts`) and reads back (`app.tsx`). |
| `adapter/bb.ts` | Mounting, sends, sidebar indicator → pulse tone, and the canary for the settings page. |
| `app.tsx` | The `motion` content script; a headless app overlay for settings and one for `experimental_useSidebarThreads` (feature-detected); an invisible composer action for `useComposer().onSubmitted` and the accent caret (`setTextEffect`); the selector-health settings section. |
| `server.ts` | `bb.settings.define`. |
| `themes/` | `lively.css`, `lively-dracula.css`, their `-bold` variants and `lively-zzz.css` (manifest `bb.themes`): tokens only, no motion. A bold file is its base palette copied plus a Bold block at the end (one theme is active at a time, so it cannot import the base): keep each pair in step. |
| `skills/bb-lively/` | Tells agents what lively does, its settings, and how to report a broken selector. |
| `tests/` | Adapter tests, and `fixtures/bb-0.46.1.html`: bb's markup captured from the web UI (structure and attributes only) that `selectors.test.ts` runs the table against. |

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
