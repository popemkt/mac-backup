Drive bb from the keyboard, the way Vimium drives a browser.

## What you get

- **Link hints.** Press `alt+f` (anywhere, even while typing) or `f` (when nothing has focus).
  Every visible thing you can click, follow or type into gets a short label in home-row
  letters, the shortest ones in the pane you are working in. Type a label to activate it:
  links follow, buttons click, text fields take focus, selects open. Typing narrows the
  labels as you go, Backspace undoes a letter, Esc leaves. `alt+shift+f`, `F`, or Shift on
  the last letter opens a link in a new tab.
- **Scrolling.** `j` / `k` scroll a line, `d` / `u` half a page, `gg` / `G` to the top and
  bottom, in the pane under your last click or focus.
- **`gi`** jumps to the composer of the pane you are in.
- **`?`** shows every key, including the ones you rebound, and any setting that did not take.

Single keys only work while no text field, terminal, browser tab or dialog has focus, so
they never eat what you type; turn them off entirely in the plugin's settings and keep
just the chords. Digits are never taken: bb uses them to answer agent questions.

## Settings

Every key is rebindable in vim notation (`f`, `gg`, `<A-f>`, `<C-d>`), and so are the hint
letters, the scroll step and how long `gg` waits for its second key. The `alt+f` chords
themselves are bb commands: rebind them in Settings → Keyboard.

## Pages in frames

Hints reach into same-origin frames. A cross-origin page joins in by loading the
`bbim-bridge.js` script that ships with the plugin (see the plugin's skill).
