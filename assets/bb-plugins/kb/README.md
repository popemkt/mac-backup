# bb-plugin-kb

The person's [kb](https://github.com/popemkt/kb) beside a bb thread, and agent tools that act in that kb tab.
See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md).

## How it works

kb names a tab by its *tab session*, and a call made in a session acts on what that tab shows (kb's
DESIGN.md → Action registry → A call made in a tab session, and → Surfaces → Embedding the page):

1. The panel frames the kb page. kb lets it only when `kb ui --embed-origin <bb's origin>` names bb.
2. The framed page posts `{type: "kb.session", session}` to bb's origin. The panel takes it only from its own
   frame and kb's origin, and reports `{threadId, session}` to the backend over RPC, every 30 s while mounted.
3. The agent tools call kb's `POST /api/action` with that `session` in the envelope. A report not repeated for
   90 s lapses, so with no panel open the same tools make calls in no session: every input must be passed.

The tools reach kb as a local program: through kb ui's owner-only Unix socket when one is set, else through
the page URL. Nothing but the session crosses the frame.

## Layout

| File | Role |
|---|---|
| `lib/kb.ts` | Pure: the thread → session registry with its lapse, the frame message, tool answer text. Tested. |
| `server.ts` | Settings, the `config` and `reportSession` RPC, the kb transport, `kb_call`, `kb_screen`, `kb_manifest`. |
| `app.tsx` | The `kb` thread panel tab (the frame) and the header button that opens it, or opens it by itself. |
| `skills/kb/` | Tells agents how to use the tools. |

## Settings

| Key | Default | Meaning |
|---|---|---|
| `url` | the server's `KB_URL` | The kb page the panel frames. |
| `socket` | the server's `KB_SOCKET` | kb ui's Unix socket the tools call through; else the page URL. |
| `autoOpen` | `false` | Open the panel beside each thread the first time a window shows it. |

On shared-server, `hosts/shared-server/default.nix` sets `KB_URL` and `KB_SOCKET` in bb's environment and
names bb's origin in kb's `--embed-origin`, so the plugin needs no configuration there.

## Develop

```sh
npm install --include=dev
npm run typecheck && npm test
bb plugin build
bb plugin install .        # or: bb plugin reload kb
```
