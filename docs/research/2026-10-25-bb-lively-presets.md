# bb-lively themed presets: what bb lets a plugin do, and the model chosen

Date: 2026-10-25. bb 0.46.1, `@get-bb/plugin-sdk` 0.6.49. Plugin:
`assets/bb-plugins/bb-lively`. Earlier work:
[bb theming feasibility](2026-10-24-bb-theming-feasibility.md),
[ZZZ wobble](2026-10-24-bb-lively-zzz-wobble.md).

The owner asked for a grouped setting ("like ZZZ") that changes many settings
at once while every setting stays individually tweakable, then widened it: a
preset is one art direction that unifies bb's palette theme with lively's
motion and an art layer (backdrop, texture, illustrations, fonts, signature
effects), with an optional user-supplied image that is never committed.

## What bb allows (checked in the SDK types, bb's bundles and live)

| Question | Answer | Evidence |
|---|---|---|
| Can a plugin change bb's active theme? | **Yes.** `bb.sdk.theme.set(themeId)` on the server, `useSdk().theme.set` in the frontend; the same call as `bb theme set`. The UI repaints live. | `ThemeArea` in the SDK; verified on shared-server: picking ZZZ switched the theme to `plugin:bb-lively:lively-zzz` within a second. |
| Can it react to a settings change? | **Yes**, server-side: `settings.onChange(next, prev)` fires once per settings write (UI or CLI). | SDK `PluginSettingsHandle`; verified live. |
| Can a setting be left unset, a boolean tri-state, a description dynamic? | **No.** Descriptors are registered once; the UI cannot unset a stored value; a boolean is a switch. A stored value whose type no longer matches the descriptor falls back to the default (`coerceStoredPluginSettingValue`). | bb server `start-server.js`. Gap node `01M5RXXJV7Q5EWQF8EVK8VFX85`. |
| Background images, `@font-face`, pseudo-element layers? | **Yes**, in lively's injected `<style>` and in theme CSS alike. bb sends no Content-Security-Policy, and theme CSS goes verbatim into `<style id="bb-app-theme">` (256 KB cap). | Response headers of bb's web UI; bb's app bundle. |
| Serve a local file to the window? | **Yes**: `bb.http.route("GET", "/art", …)` at `/api/v1/plugins/bb-lively/http/art`; `auth: "local"` admits bb's own window (a CSS `url()` from bb's origin loads it). | Verified live: 200, `image/svg+xml`. |
| Import code from outside the plugin folder? | No (bb 0.46.1's server build rejects it); node builtins are fine. | Brief; `adapter/art.ts` uses `node:fs`. |

Limits that stay:

- **No font files.** The repository is public, so presets carry font *stacks*
  only (`fonts.sans`, `fonts.mono` override bb's `--font-sans`/`--font-mono`);
  a family shows only if installed. A user-supplied font would go through the
  same route as the art image; not built.
- **A palette is a manifest entry.** bb learns themes from `bb.themes` in
  `package.json`, so a preset's palette is a row there plus its CSS file; a
  test checks every preset's palette is registered.
- **Settings UI.** From preset has to be an explicit option, switches become
  From preset / On / Off selects, and effective values show in lively's own
  Preset settings section, not beside each setting (the gap above).
- **Art surfaces.** The thread (`[data-thread-window]`), the sidebar
  (`[data-sidebar="sidebar"]`) and the composer's dock band
  (`[data-scroll-footer] > *`). Each was checked live: positioning and
  isolating them moves none of their descendants.

## The model

- **A preset is data**: one row in `core/src/domain/presets.ts` with id,
  label, description, a link to its art-direction section, a partial map of
  setting values (effect switches included), a palette id, an art block
  (backdrop and sidebar layers, the image slot) and font
  tokens. Seeds: custom (none), calm, lively, zzz.
- **Override semantics**: every presettable field is `"preset"` or an explicit
  value. `resolve(choices, presets)` returns the effective settings and each
  field's source: explicit, else the preset's, else the base default. Every
  consumer (the policy, root attributes, the art, the palette switch, the
  settings section) reads only that. Choosing ZZZ moves everything still on
  From preset; explicit tweaks survive any preset switch.
- **Palette**: a setting (From preset / Keep my bb theme). The server switches
  bb's theme when a settings write changes the effective palette, remembers
  the theme the person had, and puts it back on a preset without a palette
  unless they changed theme since. It never switches on load, so a theme
  picked in Appearance afterwards stays.
- **Art** is lively's: CSS gradients only, painted by lively's sheet under
  `:root[data-lively-art="on"][data-lively-preset="<id>"]` on a `::before`
  behind each surface's content. The person's image (the `artImage` setting:
  an https URL or a file on the bb machine) goes on the preset's image
  surface, washed toward the canvas and masked like the preset's art; every
  preset looks finished without it.
- **Signature effects**: an effect in `effects.ts` may name `presets: [...]`;
  it then runs only under those presets.

## The dock (owner feedback, same day)

The owner saw ZZZ live and liked the backdrop and the motion. One thing broke the
scene: bb's solid `[data-overflow-fade]` gradient just above the composer (where
the scroll-to-latest button sits), a little black band cutting the art off.
Topic → concept: the scene runs behind the controls.

- bb's band behind the composer (`[data-scroll-footer] > *`) stays opaque, so
  history never shows through it, and repeats the backdrop's art: backdrop
  layers and masks are anchored to the bottom-right corner in fixed pixels (a
  test enforces it), which the thread window and the band share, and the
  person's image is fixed to the window. They meet without a seam.
- bb's fade is hidden whenever a backdrop (or the person's image) is showing.
  Nothing replaces it: the band's top edge is where history slides under.
- Nothing else in the dock changes. Two intermediate versions on the branch
  (a clear band, then translucent floating panels with sticker shadows and a
  blurred fade) went further than asked and were reverted; the yellow-green
  edge the owner saw on the background-command bar was those panels' sticker
  shadow.

Screenshots: `.kb/assets/overnight/2026-10-25/lively-presets/` (fade-before,
fade-after, zzz-thread*, settings-preset-section).

## Adding a themed preset (e.g. Transistor)

1. A row in `core/src/domain/presets.ts` (values, `palette`, `art`, `fonts`,
   `artDirection: "ART-DIRECTION.md#transistor"`).
2. Its palette: `themes/<palette>.css` and an entry in `package.json`
   `bb.themes`.
3. Its art: CSS layers in the row; any picture the owner supplies goes in the
   Art image setting, outside git.
4. Its signature motion, if any: an effect in `core/src/domain/effects.ts`
   with `presets: ["transistor"]`, and its rules in `core/src/dom/stylesheet.ts`.
