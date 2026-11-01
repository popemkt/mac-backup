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
   `codexHome`). It resumes or starts the concierge's Codex thread, with the rules from `core/persona.ts` as
   developer instructions. Then it calls `thread/realtime/start` with `transport: webrtc`, `version: v3`
   (GPT-Live, `gpt-live-1-codex`). Codex creates the call with its own ChatGPT login and returns the answer SDP.
   WebSocket realtime would need an API key; WebRTC does not.
4. Audio flows between the window and OpenAI. Codex keeps a sideband connection to the call: the voice model
   hands questions to the concierge thread, which runs `bb …` and whose answer is spoken back.
5. Transcript and activity notifications come back as host signals, are stored (final lines only, in
   `bb.storage`), and are published on the `live` realtime channel for the page and the overlay pill.

bb's account-pool routing is stripped from the app-server's environment: the pool hub has no realtime route.

## Adding a backend
Implement `VoiceBackend` (`core/backend.ts`) and add it to `backends` and to the `backend` setting's options in
`server.ts`. The page, CLI, transcript and persona do not change. A key-based OpenAI Realtime backend would answer
the same WebRTC offer from the server via `/v1/realtime/calls`; a local STT/TTS backend would add a `ClientOffer`
kind for push-to-talk audio.

## Layout
| File | Role |
|---|---|
| `core/backend.ts` | The voice-backend seam. |
| `core/codex.ts` | The Codex backend: machine choice, sign-in, the concierge thread per machine, live calls. |
| `core/hosts.ts` | Which machine runs the backend, from bb's host list. Pure. |
| `core/persona.ts` | The concierge's rules and prompts, shared by every backend. Pure. |
| `core/codex-events.ts`, `core/transcript.ts`, `core/jsonrpc.ts` | Notification mapping, the bounded transcript, the app-server JSON-RPC peer. |
| `contract.ts` | Server ↔ host RPC contract and signals. |
| `host.ts` | Host entry: `codex app-server`, probe, device-code sign-in, start/stop/text. |
| `server.ts` | Settings, backend choice, RPC for the page, the transcript, `bb voice-concierge`. |
| `app.tsx` | The page, the call manager (survives navigation), the live overlay pill. |
| `skills/voice-concierge/` | Tells agents about `bb voice-concierge`. |
| `tests/` | `npm test`: core, the JSON-RPC peer, and the Codex backend against a fake host. |

## Develop
```sh
npm install --include=dev
npm run typecheck && npm test
bb-plugins-sync --path "$PWD"     # try it in the running bb; the next sync or rebuild restores the declared set
```
