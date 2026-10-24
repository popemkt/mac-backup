# bb-plugin-bb-lively

A motion layer and two palette themes for bb. See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md)
for what a person gets, [core/README.md](core/README.md) for the engine, and the design in
[docs/research/2026-10-24-bb-theming-feasibility.md](../../../docs/research/2026-10-24-bb-theming-feasibility.md).

## Layout

| Path | Role |
|---|---|
| `core/` | `@popemkt/bb-lively-core`: the bb-agnostic engine (effects table, settings, motion policy, stylesheet, row watcher, pulses, selector canary) with its own tests. An npm workspace, so `bb plugin build` bundles it from `node_modules/@popemkt/bb-lively-core` (a symlink to `core/`). |
| `adapter/selectors.ts` | **Every bb selector, and nowhere else**, each with a rating, the bb version it was verified on, and where it shows. The one file to check after a bb upgrade. |
| `adapter/settings.ts` | The settings table bb is told about (`server.ts`) and reads back (`app.tsx`). |
| `adapter/bb.ts` | Mounting, sends, sidebar indicator → pulse tone, and the canary for the settings page. |
| `app.tsx` | The `motion` content script; a headless app overlay for settings and one for `experimental_useSidebarThreads` (feature-detected); an invisible composer action for `useComposer().onSubmitted` and the accent caret (`setTextEffect`); the selector-health settings section. |
| `server.ts` | `bb.settings.define`. |
| `themes/` | `lively.css` and `lively-dracula.css` (manifest `bb.themes`): tokens only, no motion. |
| `skills/bb-lively/` | Tells agents what lively does, its settings, and how to report a broken selector. |
| `tests/` | Adapter tests, and `fixtures/bb-0.46.1.html`: bb's markup captured from the web UI (structure and attributes only) that `selectors.test.ts` runs the table against. |

## How it works

- One `<style data-bb-lively>` built from the targets (`core/src/dom/stylesheet.ts`). Every
  effect's rules are scoped to a root attribute (`:root[data-lively-press]`); the content
  script writes `data-lively` (`full`/`reduced`), `data-lively-source`, `data-lively-speed`
  and one attribute per running effect onto `<html>`. A settings change rewrites attributes,
  never the sheet. Abort removes the sheet, every attribute and every running class.
- **Retiming instead of replacing.** Menus and dialogs keep bb's own tw-animate `enter`/`exit`
  keyframes; lively sets their per-element variables (`--tw-duration`, `--tw-ease`,
  `--tw-enter-scale`). Toasts and switch thumbs keep their transitions; lively changes only
  timing functions.
- **Reduced motion.** `system` follows `prefers-reduced-motion` live. Reduced keeps only the
  effects with an opacity-only form, at 120 ms, through token overrides (`--lively-rise: 0px`,
  no spring). The sheet repeats those overrides under the media query, so a stale `full` never
  animates for someone whose OS asks for less.
- **Budget.** Keyframes move only `scale`, `translate` and `opacity`; glows and rings are a
  pseudo-element whose opacity animates; `will-change` only on the one-animation enter class;
  at most 4 rows animate at once; no layout reads (the row watcher reads attributes only).
  `core/tests/stylesheet.test.ts` gates these.
- **bbim.** bbim sets `data-bbim-active` on `<html>` while its hints or a picker show. Every
  lively rule carries `:not([data-bbim-active])` and nothing new starts, so labels are placed
  on elements at rest.

## Effects held back (v1)

From the design's list, the fragile ones (rated H) are left out rather than shipped off:
the streaming/"thinking" shimmer (no hook on the thinking line), copy-button feedback,
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
