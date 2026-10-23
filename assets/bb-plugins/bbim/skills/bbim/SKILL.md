---
name: bbim
description: bbim, the bb plugin for vim-style keyboard navigation of bb itself — link hints (alt+f / f), j/k/d/u/gg/G scrolling, gi to the composer, ? for help. Use when asked how to drive bb from the keyboard, to change or explain bbim's keys and settings, why a bbim key does nothing somewhere, or how to make a page shown in a frame inside bb hintable (the bbim-bridge script and its postMessage protocol).
---

# bbim

bbim gives bb Vimium-style keys. It runs in bb's window, not in an agent's tools: agents cannot
press its keys, but can explain and configure them.

## Commands (bb Settings → Keyboard)

| Command id | Default | Does |
|---|---|---|
| `plugin:bbim/hints` | `alt+f` | hint mode: type a label to click, follow or focus |
| `plugin:bbim/hints-new-tab` | `alt+shift+f` | hint mode; links open in a new tab |
| `plugin:bbim/help` | none | the help overlay |

The chords work while typing in the composer. They are unavailable in a terminal (so `alt+f`
stays readline's forward-word), in a browser tab, and while a dialog is open.

## Bare keys

Active only when nothing editable, no terminal, no browser tab, no dialog and no open menu has
focus, and the `bareKeys` setting is on (default).

| Key | Action |
|---|---|
| `f` / `F` | hints / hints with links in a new tab |
| `j` / `k` | scroll a line down / up (holding repeats) |
| `d` / `u` | half a page down / up |
| `gg` / `G` | top / bottom |
| `gi` | focus the composer of the current pane |
| `?` | help: every key as bound now, plus settings that did not take |

In hint mode: typing narrows (case-insensitive), a unique label fires, Shift on the last letter
opens a link in a new tab, Backspace undoes a letter, Esc / a click / a resize leaves. Every key
is swallowed while hints show, so Esc never reaches bb's back navigation.

## Settings (plugin settings page)

| Id | Default | Notes |
|---|---|---|
| `bareKeys` | `true` | off leaves only the chords |
| `hintAlphabet` | `sadfjklewcmpgh` | ≥ 2 distinct letters, strongest first; the first become single-key labels |
| `key-hints`, `key-hintsNewTab`, `key-scrollDown`, `key-scrollUp`, `key-halfPageDown`, `key-halfPageUp`, `key-scrollTop`, `key-scrollBottom`, `key-focusInput`, `key-help` | `f F j k d u gg G gi ?` | vim notation (`gg`, `<A-f>`, `<C-d>`, `<Space>`); empty unbinds; may not start with `<Esc>` or a digit (bb uses digits to answer agent questions) |
| `scrollStep` | `70` | px, 10–2000 |
| `sequenceTimeoutMs` | `1000` | ms, 200–5000; how long `gg` waits for its second key |

An invalid value falls back to its default and is listed in the help overlay. Key settings only
change bare keys; the chords are rebound in bb's Keyboard settings.

## Pages in frames: the hint bridge

Same-origin iframes get hints directly. A cross-origin frame (or one sandboxed without
`allow-same-origin`) is hintable only if the page inside loads the bridge:

```html
<script src="bbim-bridge.js" data-parent-origins="https://parent.example"></script>
```

The file is `core/bridge/bbim-bridge.js` in the plugin folder
(`~/.dotfiles/assets/bb-plugins/bbim/`), a self-contained classic script; ES-module code can
call `installBbimBridge({ parentOrigins })` from `@popemkt/bbim-core/bridge` instead.
`data-parent-origins` (space-separated) is required: without it the bridge stays off. List
bb's own origin. An opaque `"null"` parent may only ask for targets, never forward keys or
click.

Protocol `bbim-bridge/1`: `postMessage` objects with `bbim: "bbim-bridge/1"`, both sides
decoded by exact checks, anything else dropped. Parent → frame: `collect {requestId}`,
`activate {requestId, targetId, newTab}`, `mode {active}` (only to the focused frame,
renewed every 1 s; the frame stops forwarding after 3 s without renewal). Frame → parent:
`targets {requestId, targets[{id, kind, left, top, width, height}]}` (frame-viewport px,
≤ 2000), `key {key, code, ctrlKey, altKey, metaKey, shiftKey, repeat, isComposing}` (from the
focused frame only; picks, narrows or takes back only that frame's labels; held and IME keys
ignored), `leave {reason: pointer | lapsed}` (a click in the frame or lapsed forwarding ends
hints), `open {requestId, url}` (only as the answer to that activation, http(s) only). At
most 256 target replies and 256 keys per frame per hint session are read, counted before
decoding. The page's labels show at once; each frame's join as it answers, until a letter is
typed, and frames that do not answer within 1 s are skipped. A frame reports its own target boxes, so embed
bridge frames only from origins you trust. Full tables: `core/README.md`.

## Constraints

- No hints inside bb's browser tabs yet (kb gap `01M5KBVSMZ39HBDVBG4CA5TEH0`): bbim stands aside
  there.
- Hints cover what is on screen and not covered by something else; scroll to reach the rest.
- Digit keys are never bbim's.
