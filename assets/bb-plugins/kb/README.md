# bb-plugin-kb

The person's [kb](https://github.com/popemkt/kb) beside a bb thread, and agent tools that act in that kb tab.
See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md).

## How it works

kb names a tab by its *tab session*, and a call made in a session acts on what that tab shows (kb's
DESIGN.md → Action registry → A call made in a tab session, and → Surfaces → Embedding the page):

1. The panel shows the kb page in a frame. kb lets it only when `kb ui --embed-origin <bb's origin>` names bb.
   bb unmounts a panel tab on every thread switch, so the frame does not live in the tab: an app overlay
   (`frames.tsx`), mounted once per window, keeps one frame per recently shown thread (three at most, the
   least recently shown goes first) and draws each over its thread's tab while the tab is mounted, hidden and
   inert otherwise. A frame is never moved in the DOM, which would reload it. Coming back to a thread finds
   its kb tab as it was left: route, scroll, selection.
2. The framed page posts `{type: "kb.session", session}` to bb's origin. The window takes it only from that
   thread's frame and kb's origin, and reports `{threadId, session}` to the backend over RPC, every 30 s while
   the frame lives, shown or hidden, and `null` when the frame goes.
3. The agent tools call kb's `POST /api/action` with that `session` in the envelope. A report not repeated for
   90 s lapses, so with no panel open the same tools make calls in no session: every input must be passed.

The tools reach kb as a local program: through kb ui's owner-only Unix socket when one is set, else through
the page URL. Nothing but the session crosses the frame.

## Linked items

The plugin keeps which kb things each thread wrote or linked: canvases now, more kinds later
([docs/research/2026-10-25-kb-topology.md](../../../docs/research/2026-10-25-kb-topology.md) says why the link
lives here and not in kb). kb records the caller's `via` label on every write and reads its log back with
`graph.changes` (kb DESIGN.md → Action registry → The caller's via). The plugin labels a thread's writes
`bb:<thread>`: `kb_call` states it on the envelope, and every provider gets `KB_VIA=bb:<thread>`, so the
thread's own kb CLI and kb MCP label theirs. A background loop reads kb's log of `bb:` writes every 10 s (and
on each list) and records a link for every canvas one touched, in the plugin's database, with the thread's bb
project and machine; it keeps the newest 5000 links. Each list asks kb once for the canvases it has now, so
renames and deletions show whoever made them. The **kb canvases** panel lists them: Thread | Project | All,
drawn by the same row as the Canvases panel (`../linked-items/`).

`via` is advisory: a caller states it, kb records it unchecked, so any caller could claim `bb:<thread>`. The
panel shows a link a write made as *claimed by* the thread (a dashed chip, "claimed by this thread"), and a
link made with **Link open canvas** as plain. If kb compacts its log past what the loop had read, the panel
says the links may be incomplete.

## Layout

| File | Role |
|---|---|
| `lib/kb.ts` | Pure: the thread → session registry with its lapse, the frame message, tool answer text. Tested. |
| `server.ts` | Settings, the `config` and `reportSession` RPC, the kb transport, `kb_call`, `kb_screen`, `kb_manifest`. |
| `lib/frames.ts` | Pure: which threads keep a kb frame, and which goes past the limit. Tested. |
| `frames.tsx` | The window's kb frames (an app overlay): config, preconnect, positioning, session reports. |
| `app.tsx` | The `kb` thread panel tab (the place its thread's frame is drawn) and the header button that opens it. |
| `lib/links.ts` | Pure: the `via` a thread's writes carry, reading `graph.changes`, which changes link what, an item as a row. Tested. |
| `lib/link-book.ts` | The links database over any SQL: the cursor, reading the log in pages, links, scopes, pruning. Tested on `node:sqlite` with a fake kb. |
| `links.ts` | Linked items wired to bb: KB_VIA for every provider, the loop, the `links`, `linkOpen`, `openItem` RPC. |
| `linked-panel.tsx` | The `kb canvases` thread panel tab, the Canvases panel's twin. |
| `skills/kb/` | Tells agents how to use the tools. |

## Settings

| Key | Default | Meaning |
|---|---|---|
| `url` | the server's `KB_URL` | The kb page the panel frames. |
| `socket` | the server's `KB_SOCKET` | kb ui's Unix socket the tools call through; else the page URL. |
| `autoOpen` | `true` | Open the panel beside each thread the first time a window shows it. |

On shared-server, `hosts/shared-server/default.nix` sets `KB_URL` and `KB_SOCKET` in bb's environment and
names bb's origin in kb's `--embed-origin`, so the plugin needs no configuration there.

## Develop

```sh
npm install --include=dev
npm run typecheck && npm test
bb plugin build
bb plugin install .        # or: bb plugin reload kb
```
