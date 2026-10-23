# @popemkt/bbim-core

Vim-style keyboard navigation for any web app, with no framework and no host
assumptions: link hints over every visible clickable thing, `j`/`k`/`d`/`u`/
`gg`/`G` scrolling, `gi` to the main input, a `?` help overlay, and a postMessage
bridge for iframes it cannot reach into. The bb plugin next door
(`../adapter`) is one host; this package knows nothing about bb.

## Layers

| Layer | Path | Depends on | What it is |
|---|---|---|---|
| Domain | `src/domain/` | `effect` only (iso preset, no DOM types); the bridge protocol and target rules import nothing | key notation and the one key matcher, label generation, target classification and ordering, modes, settings schema, the bridge protocol decoders |
| DOM | `src/dom/` | domain + the DOM (browser preset) | `createBbim`, hint collection, frames, overlay, activation, scrolling, focus guards, the single Effect runtime adapter (`runtime.ts`) |
| Bridge | `src/bridge/` | protocol + DOM collection, no `effect` | `installBbimBridge` for the inside of a frame; `bridge/bbim-bridge.js` is its standalone build (~11 KB; the build fails if it bundles any `effect` module or passes 20 KB) |

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
(what `gi` labels, default `TEXT_INPUT_SELECTOR`), `preferInput` (the inputs
`gi` means by default when none was used last, e.g. a composer), `signal`,
`bridgeTimeoutMs` (default 1000: how long bridge frames have to answer; the
page's own labels do not wait for them).

To make bbim stand aside (a game, a recording), add a guard that answers
`blocked`; there is no separate disable switch.

### Hooks

| Hook | Use |
|---|---|
| `guards: FocusGuard[]` | `(focused) => "free" \| "typing" \| "blocked" \| undefined`. Editable focus is built in as `typing`. `typing` turns bare keys off (chords still work); `blocked` turns bbim off. Helpers: `withinGuard(selector)` (focus inside, e.g. a terminal), `presenceGuard(doc, selector, state)` (e.g. an open modal). Both see through open shadow roots; inside a closed one, focus is seen on its host, so match the host. Guards run only for keys a binding takes, in order, stopping once the answer is settled: list `presenceGuard`s (which search the document) last. |
| `openUrl(url, { newTab })` | open new-tab URLs your way (new-tab hints, bridge `open` requests); `false` falls back to a cmd/ctrl-click on the link, or `window.open` for a bridge request |
| `help()` | extra help-overlay sections, e.g. the host's own chords |

### Settings

`SettingsInput` is untrusted (`unknown` per field) and decoded field by field;
a bad field falls back to its default and is reported, the rest still apply.

| Field | Default | Rule |
|---|---|---|
| `bareKeys` | `true` | single keys without ctrl/alt/meta are active only while focus is `free` |
| `hintAlphabet` | `sadfjklewcmpgh` | ≥ 2 distinct letters, strongest first: the first ones become single-key labels |
| `fadedTargets` | `show` | `show` labels controls drawn only on hover (opacity ≈ 0, e.g. a tab's close button) after every visible one, dimmed with a dashed ring; `hide` leaves them out |
| `scrollStep` | `70` | integer px, 10–2000 |
| `sequenceTimeoutMs` | `1000` | integer ms, 200–5000; how long `gg` waits |
| `keys.<action>` | see below | vim notation; empty unbinds; may not start with `<Esc>` |

Actions and default keys: `hints` `f`, `hintsNewTab` `F`, `scrollDown` `j`,
`scrollUp` `k`, `halfPageDown` `d`, `halfPageUp` `u`, `scrollTop` `gg`,
`scrollBottom` `G`, `pickScroll` `gs`, `focusInput` `gi`, `help` `?`.

`pickScroll` is the scroll-surface picker: every visible surface that
scrolls vertically (at least 40 px each way, open shadow roots and
same-origin frames included) gets an outline and a label in its top-left
corner. The picked one flashes and becomes what `j`/`k`/`d`/`u`/`gg`/`G`
scroll, until a click lands outside it or another is picked. With one
surface it is picked at once, without labels.

`focusInput` (`gi`) is the input picker: with one visible text input it
focuses it at once; with several (search boxes, setting fields, composers,
inputs in same-origin frames) it labels the inputs only, uncovered and not
hidden, and focuses the one picked. The input `gi` means by default (the
last one used while it still shows, else a `preferInput` match nearest the
last click or focus, else the biggest there) gets the first, shortest label,
and Enter picks it, so `gi` then Enter is the old jump.

Notation: characters are themselves (`G` is shift+g); `<...>` names a special
key or chord: `<Esc>`, `<Space>`, `<CR>`, `<Tab>`, `<F5>`, `<lt>`, `<A-f>`
(alt), `<C-d>` (ctrl), `<M-k>` (meta/cmd), `<S-Tab>`. On macOS, alt chords
match by physical key, so `<A-f>` fires although the event's `key` is `ƒ`.

### Hint mode

Every labeled choice is one mechanism, a *pick session* (`dom/bbim.ts`): a
picker names which targets get labels and what picking one does, and the
session owns the rest (labels, narrowing, the overlay, same-origin frames,
the bridge, re-labeling when the page moved). Link hints, the scroll-surface
picker and the input picker are its pickers. A picker may name a default
target: it gets the first label and Enter picks it.

Labels are prefix-free words over the alphabet, shortest nearest the focus
region's top-left. Typing narrows (case-insensitive); a unique match fires;
Backspace undoes a letter; Esc, a click (in a frame too), focus moving into
a frame, a resize or a hidden tab leaves. Shift on the last letter, or
`hintsNewTab`, opens links in a new tab. Every key is swallowed while hints
show, so nothing leaks into the page; held keys and IME composition never
type a label. Links follow, buttons click, text fields focus with the caret
at the end, selects open their picker. A target must be rendered (not
`display: none`, `visibility: hidden` or `content-visibility: hidden`) and
hit-testable; opacity does not exclude it. A control at opacity ≈ 0 (its own
or an ancestor's: `opacity-0 group-hover:opacity-100`) is *faded*: labeled
after every visible target, so it never takes a short label, and drawn
dimmed with a dashed ring. Labels are a snapshot: nothing
watches the page while they show, and picking a target that has since left
the page, moved or been covered labels it afresh. Bridge frames' labels join
the page's as each frame answers, until the first letter is typed; with no
target on the page, hints wait for the frames.

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
      preferInput: ".editor textarea", // what gi + Enter focuses before anything was typed into
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
Frames without the bridge simply get no hints.

The bridge fails closed:

- `data-parent-origins` (space-separated) is required. Without it, or with
  only `*`, the bridge does not install. It answers only `window.parent`, and
  only from a listed origin.
- An opaque `"null"` origin, which a sandboxed parent has and anyone could
  be, may only be listed to allow `collect`: it can never turn on key
  forwarding or activate anything.
- Key forwarding is renewed by the parent every second while hint mode is up,
  and the frame drops it after 3 s without a renewal, so a parent that dies
  mid-session cannot leave the frame swallowing keys. When it drops it, or
  someone clicks inside the frame, it tells the parent (`leave`), which ends
  hints too; so does a renewal that comes later than 3 s.
- Held keys and IME composition are swallowed but never forwarded.
- One bridge per window: a second install is refused (and warned about).
  `window.bbimBridge.uninstall()` removes it and forgets its targets.

On the parent side, bbim reads each frame's messages only from that frame's
own window and at most 256 of each kind it reads (target replies, keys) per
hint session, counted before decoding; asks only the frame that has
focus to forward keys, and lets those keys pick only that frame's targets;
and opens a URL for a frame only as the one answer to an activation it sent.

Inherent limit: a frame reports its own target boxes, and the parent can only
clip them to the frame's box, so a bridge frame can place labels anywhere
inside itself. Embed bridge frames from origins you trust; the frame's list of
parent origins is the other half of that agreement.

The in-frame side is plain DOM plus the protocol decoders, with no Effect at
all, so a frame pays about 11 KB for it.

### Protocol `bbim-bridge/1`

Every message is a plain object with `bbim: "bbim-bridge/1"`. Both sides
decode with the decoders in `src/domain/protocol.ts` (exact keys, bounded
strings and arrays, finite numbers; the message types are derived from the
same specs) and drop anything else.

Parent → frame (the bridge only accepts messages whose `source` is its own
`window.parent`, from a listed origin; `activate` and `mode` never from `"null"`):

| `type` | Fields | Frame does |
|---|---|---|
| `collect` | `requestId` (≤ 64 chars) | replies `targets` |
| `activate` | `requestId`, `targetId` (int ≥ 0), `newTab` | activates that target from the last `collect`; a new-tab link becomes an `open` request carrying this `requestId` |
| `mode` | `active` | while active, forwards every keydown as `key` and swallows it; sent only to the focused frame, renewed every `MODE_HEARTBEAT_MS` (1 s), dropped by the frame after `MODE_TTL_MS` (3 s) of silence |

Frame → parent (the parent only accepts messages whose `source` is the
frame's own `contentWindow`, at most `FRAME_MESSAGE_BUDGET` (256) per frame per
session for each listener: target replies and keys are counted apart):

| `type` | Fields | Parent does |
|---|---|---|
| `targets` | `requestId`, `targets: {id, kind, left, top, width, height, faded?}[]` (≤ 2000, frame-viewport px; `faded: true` for a hover-only control) | places them inside the frame's box and labels them as they arrive (until a letter is typed); frames that miss `bridgeTimeoutMs` are skipped |
| `key` | `key`, `code` (≤ 64 chars), `ctrlKey`, `altKey`, `metaKey`, `shiftKey`, `repeat`, `isComposing` | from the focused frame only: feeds the key to the hint session, where it can pick, narrow or take back only that frame's labels; held and IME keys are ignored |
| `leave` | `reason`: `pointer` (a click in the frame) or `lapsed` (forwarding timed out) | ends hint mode |
| `open` | `requestId`, `url` (≤ 8192 chars) | only as the answer to its `activate` with `newTab` (same `requestId`, within 1 s): opens it in a new tab, http(s) only |

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
