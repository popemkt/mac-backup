# bb-plugin-bbim

Vim-style keyboard navigation for bb: link hints, scrolling, `gi`, help. See
[PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md) for what a person gets, and
[core/README.md](core/README.md) for the engine.

## Layout

| Path | Role |
|---|---|
| `core/` | `@popemkt/bbim-core`: the framework-agnostic engine (domain, DOM, iframe bridge) with its own tests. No bb imports. An npm workspace, so `bb plugin build` bundles it from `node_modules/@popemkt/bbim-core` (a symlink to `core/`). |
| `adapter/settings.ts` | The settings table bb is told about (`server.ts`) and reads back (`app.tsx`): the core's schemas plus bb's no-leading-digit rule. |
| `adapter/bb.ts` | What bbim knows about bb: focus guards (`[data-app-terminal]`, `[data-app-browser]`, bb's modal selector, open menus), the composer for `gi`, bb's URL opener, theme tokens, the help section for bb's chords. |
| `app.tsx` | The content script that mounts the engine, the `alt+f` / `alt+shift+f` / help commands, and a headless app overlay that feeds settings and `useBbNavigate` to it. |
| `server.ts` | `bb.settings.define`. |
| `skills/bbim/` | Tells agents what bbim does and how a page in a frame joins in. |
| `tests/` | Adapter tests. |

## Why the keys work the way they do

- bb dispatches its keybindings on `window` keydown in the bubble phase and gates plugin
  commands only on `modalOpen`, so `alt+f` fires while the composer has focus; bb matches alt
  chords by `event.code` and calls `preventDefault`, so macOS does not type `ƒ`. `alt+f` and
  `alt+shift+f` were unbound in bb 0.46.1 (bb binds only alt+m/p/t).
- The commands' `isAvailable` is false in a terminal or browser tab (`alt+f` stays readline's
  forward-word) and while a dialog is open.
- Bare keys run from the engine's capture-phase listener only when focus is `free`: no editable,
  no terminal, no browser tab, no dialog, no open menu. Hint and help modes swallow every key,
  so Esc never reaches bb's `app.back`. Digits are never bound (bb answers agent questions with
  them).

## Develop

```sh
npm install --include=dev
npm run verify             # typecheck, lint, tests, bridge freshness, bb plugin build
bb plugin install .        # or: bb plugin dev
```

Installed by `modules/common/home-manager/bb-plugins.nix` (`npm ci --omit=optional`, then
`bb plugin install`), listed in the bb stack's `my.pkgs.bbPlugins`. Dev tools (TypeScript 7,
`@effect/tsgo`, oxlint, esbuild, happy-dom, fast-check) are the core's dev dependencies; the
executor installs them too, and none needs an install script to build the plugin.

Size: `dist/app.js` is ~320 KB minified, about 230 KB of it Effect (runtime ~90 KB, Schema
~140 KB, kept for settings); bbim's own code is ~35 KB. The standalone bridge has no Effect
and is ~11 KB.
