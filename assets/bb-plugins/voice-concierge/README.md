# bb-plugin-voice-concierge

A realtime voice concierge for bb. See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md) for what a person gets, and
[docs/research/2026-11-01-bb-voice-concierge.md](../../../docs/research/2026-11-01-bb-voice-concierge.md) for
why it is shaped this way.

## How a call works
1. The page (`app.tsx`) opens the microphone, creates an `RTCPeerConnection` with an `oai-events` data channel,
   and sends its SDP offer to the server (`start` RPC).
2. The server asks the voice backend for an answer (`core/backend.ts`). The Codex backend (`core/codex.ts`)
   resolves the machine from bb (`core/hosts.ts`) and calls the host entry there.
3. The host entry (`host.ts`) runs `codex app-server` with its own `CODEX_HOME` (or `~/.codex`; setting
   `codexHome`). It starts a fresh, ephemeral backing Codex thread for the call, with relay instructions from
   `core/persona.ts` and one dynamic tool, `ask_concierge` (`core/relay-tool.ts`). Then it calls `thread/realtime/start` with `transport: webrtc`, `version: v3`
   (GPT-Live, `gpt-live-1-codex`). Codex creates the call with its own ChatGPT login and returns the answer SDP.
   WebSocket realtime would need an API key; WebRTC does not.
4. Audio flows between the window and OpenAI. Codex keeps a sideband connection to the call: the voice model
   hands each question to the backing agent, which calls `ask_concierge`. The host answers that tool call by
   running `bb voice-concierge ask '<request>'`, which sends it to the concierge's own bb thread
   (`core/concierge-thread.ts`) and waits for that thread's reply, which is spoken back. A tool, not a shell
   command: Codex's exec tool hands back after ~10 s, and the agent then has nothing to say.
5. Captions and activity come back as host signals, are logged (final lines only, in `bb.storage`), and are
   published on the `live` realtime channel for the page and the overlay pill.

## The concierge's thread
One ordinary bb thread, created by the plugin on first use in bb's Personal project (a personal workspace on the
concierge's machine), pinned, titled "Voice concierge", with plugin metadata `role: concierge`. Its first message is
`THREAD_BRIEF` (the rules, and that `[voice]` messages are spoken). The page shows it below the sphere with bb's
`ThreadChat`, so typing there, or anywhere bb shows the thread, continues the same conversation the voice uses.
Archive it to start over: the next call creates a new one. Settings `threadProvider` and `threadModel` choose its
agent (default: the Personal project's).

## The sphere
`sphere.ts` draws a real, deforming ball in two WebGL2 draws per frame: a full-screen triangle for the halo, then an
icosphere (20k triangles) whose vertex shader displaces the surface with noise driven by the smoothed voice level and
the call's phase (finer ripples for the owner's voice, broad swells for the concierge's, a slow roll while thinking)
and derives normals from the displacement, so light, rim and gloss follow the shape. `core/sphere-styles.ts` holds the
art styles, each one GLSL `body` function inside the shared frame. 4x MSAA, at most 720 px a side; paused while
hidden or off screen; one still frame with reduced motion. Setting `sphereStyle`, or the swatches under the sphere.

The page has two layouts. Stacked (below 880 px wide, so phones and narrow panels): the sphere on top, the
conversation, and a call bar at the bottom within thumb reach (Talk; in a call Mute and Hang up), whose right end stays
clear of the round floating button bb and plugins keep in the bottom-right corner. Side by side (880 px and up, or a
phone held sideways): sphere and controls on the left, conversation on the right. During a call the conversation
shows without its composer (ThreadChat's `timeline` variant). Stacked, the sphere's one canvas floats over the page
and glides between its places by transform, so its backing store is not reallocated while it moves.

With `orbAutoMinimize` (on by default) the page docks the sphere into the call bar during a call, at once when
the conversation already has content and otherwise after a few seconds (`core/orb.ts`), and makes it large again when
the call ends; a tap on it or the toggle sets the size by hand until the call's phase changes, and a resting mouse
opens it up. The page's words (state labels, the idle hint, errors as a person would say them, the empty
conversation's suggestions) live in `core/copy.ts`.

bb's account-pool routing is stripped from the app-server's environment: the pool hub has no realtime route.

## Adding a backend
Implement `VoiceBackend` (`core/backend.ts`) and add it to `backends` and to the `backend` setting's options in
`server.ts`. The page, CLI, thread and persona do not change. A key-based OpenAI Realtime backend would answer
the same WebRTC offer from the server via `/v1/realtime/calls`; a local STT/TTS backend would add a `ClientOffer`
kind for push-to-talk audio.

## Layout
| File | Role |
|---|---|
| `core/backend.ts` | The voice-backend seam. |
| `core/codex.ts` | The Codex backend: machine choice, sign-in, the backing Codex thread, live calls. |
| `core/concierge-thread.ts` | The concierge's own bb thread: create it, ask it and wait for the reply. |
| `core/relay-tool.ts` | The `ask_concierge` dynamic tool and its answer. |
| `core/sphere-styles.ts`, `sphere.ts` | The sphere's art styles (GLSL) and its WebGL renderer. |
| `core/orb.ts` | When the page docks the sphere small. |
| `core/copy.ts` | The page's labels, hints, error wording and suggested questions. |
| `core/hosts.ts` | Which machine runs the backend, from bb's host list. Pure. |
| `core/persona.ts` | The concierge's rules and prompts, shared by every backend. Pure. |
| `core/codex-events.ts`, `core/transcript.ts`, `core/jsonrpc.ts` | Notification mapping, the bounded transcript, the app-server JSON-RPC peer. |
| `contract.ts` | Server ↔ host RPC contract and signals. |
| `host.ts` | Host entry: `codex app-server`, probe, device-code sign-in, start/stop/text. |
| `server.ts` | Settings, backend choice, the concierge's thread, RPC for the page, the call log, `bb voice-concierge`. |
| `app.tsx` | The page, the call manager (survives navigation), the overlay (call pill, touch mic tab). |
| `skills/voice-concierge/` | Tells agents about `bb voice-concierge`. |
| `tests/` | `npm test`: core, the JSON-RPC peer, the Codex backend against a fake host, the thread relay, styles. |

## Develop
```sh
npm install --include=dev
npm run typecheck && npm test
bb-plugins-sync --path "$PWD"     # try it in the running bb; the next sync or rebuild restores the declared set
```
