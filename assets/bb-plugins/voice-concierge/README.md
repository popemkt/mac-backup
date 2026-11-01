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
`sphere.ts` draws an analytic sphere with one full-screen WebGL2 draw per frame; `core/sphere-styles.ts` holds the
art styles, each one GLSL `body` function inside a shared frame (breath, voice swell, rim, halo, grain). Setting
`sphereStyle`, or the switcher under the sphere.

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
| `core/hosts.ts` | Which machine runs the backend, from bb's host list. Pure. |
| `core/persona.ts` | The concierge's rules and prompts, shared by every backend. Pure. |
| `core/codex-events.ts`, `core/transcript.ts`, `core/jsonrpc.ts` | Notification mapping, the bounded transcript, the app-server JSON-RPC peer. |
| `contract.ts` | Server ↔ host RPC contract and signals. |
| `host.ts` | Host entry: `codex app-server`, probe, device-code sign-in, start/stop/text. |
| `server.ts` | Settings, backend choice, the concierge's thread, RPC for the page, the call log, `bb voice-concierge`. |
| `app.tsx` | The page, the call manager (survives navigation), the live overlay pill. |
| `skills/voice-concierge/` | Tells agents about `bb voice-concierge`. |
| `tests/` | `npm test`: core, the JSON-RPC peer, the Codex backend against a fake host, the thread relay, styles. |

## Develop
```sh
npm install --include=dev
npm run typecheck && npm test
bb-plugins-sync --path "$PWD"     # try it in the running bb; the next sync or rebuild restores the declared set
```
