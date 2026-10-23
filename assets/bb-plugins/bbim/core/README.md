# @popemkt/bbim-core

Vim-style keyboard navigation for any web app, with no framework and no host
assumptions: link hints over every visible clickable thing, `j`/`k`/`d`/`u`/
`gg`/`G` scrolling, `gi` to the main input, a `?` help overlay, and a postMessage
bridge for iframes it cannot reach into. The bb plugin next door
(`../adapter`) is one host; this package knows nothing about bb.

## Layers

| Layer | Path | Depends on | What it is |
|---|---|---|---|
| Domain | `src/domain/` | `effect` only (iso preset, no DOM types) | key notation and the one key matcher, label generation, target classification and ordering, modes, settings schema, the bridge protocol schemas |
| DOM | `src/dom/` | domain + the DOM (browser preset) | `createBbim`, hint collection, frames, overlay, activation, scrolling, focus guards, the single Effect runtime adapter (`runtime.ts`) |
| Bridge | `src/bridge/` | domain + DOM collection | `installBbimBridge` for the inside of a frame; `bridge/bbim-bridge.js` is its standalone build |

One mechanism per concept: chords, bare keys, multi-key sequences (`gg`) and
hint typing all run through the same trie matcher (`domain/matcher.ts`), so
narrowing, Backspace and timeouts behave the same everywhere.

## Use

```ts
import { createBbim } from "@popemkt/bbim-core";

const controller = new AbortController();
const bbim = createBbim({ signal: controller.signal });
// later: controller.abort()  (or bbim.dispose())
```

`createBbim(options)` installs one capture-phase `keydown` listener on the
window and returns a `Bbim`:

| Member | Does |
|---|---|
| `run(action)` | run an action as if its key was pressed (wire your own shortcuts to it) |
| `setSettings(input)` | replace settings, keys included; returns what was invalid and fell back |
| `mode()` | `"normal" \| "hint" \| "help"` |
| `dispose()` | remove everything; aborting `signal` does the same |

Options: `window`, `settings`, `hooks`, `theme` (CSS custom properties; point
them at your own tokens with `var(...)` and they follow theme switches),
`selectors` (hint candidates, default `DEFAULT_SELECTORS`), `inputSelector`
(what `gi` may focus, default `TEXT_INPUT_SELECTOR`; it picks the last one
used, else the biggest in the pane around the last click or focus, else the
biggest on screen), `signal`,
`bridgeTimeoutMs` (default 150).

To make bbim stand aside (a game, a recording), add a guard that answers
`blocked`; there is no separate disable switch.

### Hooks

| Hook | Use |
|---|---|
| `guards: FocusGuard[]` | `(focused) => "free" \| "typing" \| "blocked" \| undefined`. Editable focus is built in as `typing`. `typing` turns bare keys off (chords still work); `blocked` turns bbim off. Helpers: `withinGuard(selector)` (focus inside, e.g. a terminal), `presenceGuard(doc, selector, state)` (e.g. an open modal). Both see through open shadow roots; inside a closed one, focus is seen on its host, so match the host. |
| `openUrl(url, { newTab })` | open new-tab URLs your way (new-tab hints, bridge `open` requests); `false` falls back to a cmd/ctrl-click on the link, or `window.open` for a bridge request |
| `help()` | extra help-overlay sections, e.g. the host's own chords |

### Settings

`SettingsInput` is untrusted (`unknown` per field) and decoded field by field;
a bad field falls back to its default and is reported, the rest still apply.

| Field | Default | Rule |
|---|---|---|
| `bareKeys` | `true` | single keys without ctrl/alt/meta are active only while focus is `free` |
| `hintAlphabet` | `sadfjklewcmpgh` | ≥ 2 distinct letters, strongest first: the first ones become single-key labels |
| `scrollStep` | `70` | integer px, 10–2000 |
| `sequenceTimeoutMs` | `1000` | integer ms, 200–5000; how long `gg` waits |
| `keys.<action>` | see below | vim notation; empty unbinds; may not start with `<Esc>` |

Actions and default keys: `hints` `f`, `hintsNewTab` `F`, `scrollDown` `j`,
`scrollUp` `k`, `halfPageDown` `d`, `halfPageUp` `u`, `scrollTop` `gg`,
`scrollBottom` `G`, `focusInput` `gi`, `help` `?`.

Notation: characters are themselves (`G` is shift+g); `<...>` names a special
key or chord: `<Esc>`, `<Space>`, `<CR>`, `<Tab>`, `<F5>`, `<lt>`, `<A-f>`
(alt), `<C-d>` (ctrl), `<M-k>` (meta/cmd), `<S-Tab>`. On macOS, alt chords
match by physical key, so `<A-f>` fires although the event's `key` is `ƒ`.

### Hint mode

Labels are prefix-free words over the alphabet, shortest nearest the focus
region's top-left. Typing narrows (case-insensitive); a unique match fires;
Backspace undoes a letter; Esc, a click (in a frame too), focus moving into
a frame, a resize or a hidden tab leaves. Shift on the last letter, or
`hintsNewTab`, opens links in a new tab. Every key is swallowed while hints
show, so nothing leaks into the page; held keys and IME composition never
type a label. Links follow, buttons click, text fields focus with the caret
at the end, selects open their picker. Labels are a snapshot: nothing
watches the page while they show, and picking a target that has since left
the page labels it afresh.

Letters read their case from Shift alone, so Caps Lock does not turn `f`
into `F`. A sequence of plain keys (`gg`, `gi`) is dropped when focus moves
or typing starts, and after `sequenceTimeoutMs`.

### Theme

The overlay lives in a shadow root (`[data-bbim-overlay]`, `pointer-events:
none`), styled by these custom properties, each overridable through
`theme`: `--bbim-hint-bg`, `--bbim-hint-fg`, `--bbim-hint-typed`,
`--bbim-hint-ring`, `--bbim-hint-shadow`, `--bbim-accent`, `--bbim-font`,
`--bbim-panel-bg`, `--bbim-panel-fg`, `--bbim-panel-muted`,
`--bbim-panel-border`, `--bbim-key-bg`. Values may be `var(--your-token, …)`.

## Embedding in a React app

```tsx
import { useEffect } from "react";
import { createBbim, presenceGuard, withinGuard, type Bbim } from "@popemkt/bbim-core";

export function useVimKeys(options: { bareKeys: boolean; onOpen: (url: string) => void }) {
  useEffect(() => {
    const controller = new AbortController();
    const bbim: Bbim = createBbim({
      signal: controller.signal,
      settings: { bareKeys: options.bareKeys, keys: { focusInput: "gi", hints: "f" } },
      theme: { "--bbim-accent": "var(--brand, #f5b301)" },
      hooks: {
        guards: [
          withinGuard(".monaco-editor"), // the editor owns its keys
          presenceGuard(document, "[role=dialog][aria-modal=true]", "blocked"),
        ],
        openUrl: (url, { newTab }) => {
          if (newTab) return false; // window.open
          options.onOpen(url); // your router
          return true;
        },
      },
      inputSelector: "#search, .editor textarea", // what gi may focus
    });
    return () => controller.abort();
  }, [options.bareKeys, options.onOpen]);
}
```

For settings changes without remounting, keep the `Bbim` in a ref and call
`setSettings`.

## Iframes: the hint bridge

Same-origin iframes are walked directly (up to 8 deep). A cross-origin frame,
or one sandboxed without `allow-same-origin`, cannot be read, so bbim asks it
over `postMessage`. A frame takes part by loading the bridge:

```html
<script src="bbim-bridge.js" data-parent-origins="https://app.example"></script>
```

(`bridge/bbim-bridge.js` is a self-contained classic script; or call
`installBbimBridge({ parentOrigins })` from `@popemkt/bbim-core/bridge`.)
`data-parent-origins` is a space-separated allowlist; without it the bridge
answers any parent. `window.bbimBridge.uninstall()` removes it. Frames
without the bridge simply get no hints.

### Protocol `bbim-bridge/1`

Every message is a plain object with `bbim: "bbim-bridge/1"`. Both sides
decode with the schemas in `src/domain/protocol.ts` and drop anything else.

Parent → frame (the bridge only accepts messages whose `source` is its own
`window.parent`, from an allowed origin):

| `type` | Fields | Frame does |
|---|---|---|
| `collect` | `requestId` (≤ 64 chars) | replies `targets` |
| `activate` | `requestId`, `targetId` (int ≥ 0), `newTab` | activates that target from the last `collect`; a new-tab link becomes an `open` request |
| `mode` | `active` | while active, forwards every keydown as `key` and swallows it |

Frame → parent (the parent only accepts messages whose `source` is the
frame's own `contentWindow`):

| `type` | Fields | Parent does |
|---|---|---|
| `targets` | `requestId`, `targets: {id, kind, left, top, width, height}[]` (≤ 2000, frame-viewport px) | places them inside the frame's box; frames that miss `bridgeTimeoutMs` are skipped |
| `key` | `key`, `code` (≤ 64 chars), `ctrlKey`, `altKey`, `metaKey`, `shiftKey` | feeds the key to the hint session |
| `open` | `url` (≤ 8192 chars) | opens it in a new tab, http(s) only |

`kind` is `link`, `button`, `text`, `select`, `toggle` or `weak`. Replies go
to the requester's origin (`"*"` only when that origin is opaque, as with a
sandboxed parent).

## Develop

```sh
npm run typecheck      # domain on the iso preset, src on the browser preset, tests
npm test               # node --test: happy-dom pages + fast-check properties
npm run lint           # oxlint, type-aware
npm run build:bridge   # rebuild bridge/bbim-bridge.js (a test fails when it is stale)
```

Effect runs in one place, `src/dom/runtime.ts`: each bbim instance and hint
session is a `Scope`, and every listener, timer and DOM node is an
`acquireRelease` in it, so dispose is closing a scope. The key path itself is
plain synchronous code.
