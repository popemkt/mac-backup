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
   running `bb voice-concierge ask --call <call> '<request>'`, which sends it to the call's bb thread
   (`core/call-target.ts`; see [Talking to any thread](#talking-to-any-thread)) and waits for that thread's reply,
   which is spoken back. A tool, not a shell command: Codex's exec tool hands back after ~10 s, and the agent then
   has nothing to say.
5. Captions and activity come back as host signals, are logged (final lines only, in `bb.storage`), and are
   published on the `live` realtime channel for the page and the overlay pill.

## The concierge's thread
One ordinary bb thread, created by the plugin on first use in bb's Personal project (a personal workspace on the
concierge's machine), pinned, titled "Voice concierge", with plugin metadata `role: concierge`. Its first message is
`THREAD_BRIEF` (the rules, and that `[voice]` messages are spoken). The page shows it below the sphere with bb's
`ThreadChat`, so typing there, or anywhere bb shows the thread, continues the same conversation the voice uses.
Archive it to start over: the next call creates a new one. Settings `threadProvider` and `threadModel` choose its
agent (default: the Personal project's).

## Talking to any thread
Every call talks to one bb thread, its *target* (`core/call-target.ts`):
- **Talk** in a thread's header (an `experimental_threadAction` with `placement: "header"`; on a phone it folds into
  the thread menu) starts a call with that thread. Its requests go to that thread as `[voice] <request>` plus a
  note (`voiceMessage`: the reply is spoken, so keep it short; change nothing until a request ends with
  "(confirmed)"), and that thread's agent's final reply is spoken.
- The Voice concierge page, the sidebar footer button and the touch mic tab start a call with the concierge's own
  thread when no thread is on screen; the shortcut and the footer button talk to the thread on screen if there is one.
- **Pinned, not following focus.** A call stays with its thread while the person opens other threads. Following
  focus would send the next spoken request (possibly a confirmed change) to whatever thread was clicked last, and
  the voice model would lose the thread its context is about. Instead the header of the listening thread reads
  **Listening · Hang up**, the floating pill on every page names the thread (tap it to go there), and every other
  thread's header offers **Move call here** (the pill does too). The concierge's page shows which thread a call
  is with, and **Move here** brings it back to the concierge.
- A busy thread is not interrupted: the request is queued behind its turn and the call says so. A reply that takes
  longer than the relay's limit (140 s) is announced as still working; the answer lands in the thread.
- The server keeps each live call's target in memory, from the call's start until hang-up or the call closing; a
  server restart drops them all, so a call that outlives the server reaches no thread. The relay looks the target up
  by the call's id (the backing Codex thread, which Codex passes with every tool call) and sends to that recorded
  thread only, the concierge's included (a new concierge conversation does not move a live call): an id not on
  record is refused, and a recorded thread that is gone fails, never falling back to another thread. A request still
  waiting for a busy thread when the call hangs up or moves is withdrawn, never sent; a call that closes while it is
  still connecting is never registered, and the page does not go live with it.

Only the person starts a call (a click, tap or shortcut in a window), and the microphone is on only during a call.
Agents cannot start one: the CLI and agent tools have no way to open a window's microphone.

## The sphere
`sphere.ts` draws the selected visual in WebGL2: a halo followed by a deformed icosphere or,
for Chrome Orbit, concentric metal bands. Voice levels and call phase drive the motion;
light, rim and gloss follow the surface. `core/sphere-styles.ts` holds the GLSL materials:
candy jelly, moonstone, aurora and frosted glass, plus Chrome Orbit, AI Blob and Gradient Blob.
The three new visuals are original implementations inspired by public descriptions, rather
than copies of paid React Bits source, and do not promise parity with those demos.
A filmic tone curve finishes every style. Rendering uses 4x MSAA, at most 720 px a side,
pauses while hidden or off screen, and draws one still frame with reduced motion.
Pick a visual with `sphereStyle` or the swatches under the sphere.
Chrome Orbit owns pointer and tap interactions for alignment; AI Blob responds to held
presses and drags with a directional squish, and Gradient Blob morphs toward the pointer.
Releasing a press lets the motion rebound; repeated taps add to the existing movement.
Entrance, pointer and press motion use damped springs, with a static reduced-motion state.
Use the explicit Talk and dock controls with these interactive visuals. The four material
spheres retain their call tap. Interaction strength adjusts gesture response; AI pulse
strength and Gradient breathing adjust their respective effects independently.

The sliders button applies controls live and saves them per style after the last change
(RPC `setTune`). Reset restores the selected style's defaults. Every style retains
Vividness, Motion, Glow and Hue; the new styles also expose their own numeric appearance
controls. `core/visuals.ts` is the canonical registry of identities, ranges and defaults,
shared by settings validation and the tuning panel. Settings use `<style><Knob>` names
such as `jellyVividness` and `chromeOrbitRings`. The `style` RPC and style channel carry
all styles' tuning.

The page has two layouts. Stacked (below 880 px wide, so phones and narrow panels): the sphere on top, the
conversation, and a call bar at the bottom within thumb reach (Talk; in a call Mute and Hang up), whose right end stays
clear of the round floating button bb and plugins keep in the bottom-right corner. Side by side (880 px and up, or a
phone held sideways): sphere and controls on the left, conversation on the right. During a call the conversation
shows without its composer (ThreadChat's `timeline` variant). Stacked, the sphere's one canvas floats over the page
and glides between its places by transform, so its backing store is not reallocated while it moves.

With `orbAutoMinimize` (on by default) the page docks the sphere into the call bar during a call, at once when
the conversation already has content and otherwise after a few seconds (`core/orb.ts`), and makes it large again when
the call ends; the dock toggle (or a tap on a material sphere) sets the size by hand until the call's phase changes, and a resting mouse
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
| `core/concierge-thread.ts` | The concierge's own bb thread: create it, ask it; `relay`, which sends a request to any thread and waits for its reply. |
| `core/call-target.ts` | Which thread each call talks to: resolve, record, move, and route each relayed request. |
| `core/relay-tool.ts` | The `ask_concierge` dynamic tool and its answer. |
| `core/sphere-styles.ts`, `sphere.ts` | The sphere's art styles (GLSL) and its WebGL renderer. |
| `core/visuals.ts` | Visual identities and control metadata. |
| `core/look.ts` | Tuning settings, validation and saving. |
| `core/orb.ts` | When the page docks the sphere small. |
| `core/copy.ts` | The page's labels, hints, error wording and suggested questions. |
| `core/hosts.ts` | Which machine runs the backend, from bb's host list. Pure. |
| `core/persona.ts` | The concierge's rules and prompts, shared by every backend. Pure. |
| `core/codex-events.ts`, `core/transcript.ts`, `core/jsonrpc.ts` | Notification mapping, the bounded transcript, the app-server JSON-RPC peer. |
| `contract.ts` | Server ↔ host RPC contract and signals. |
| `host.ts` | Host entry: `codex app-server`, probe, device-code sign-in, start/stop/text. |
| `server.ts` | Settings, backend choice, the concierge's thread, RPC for the page, the call log, `bb voice-concierge`. |
| `app.tsx` | The page, the call manager (survives navigation), the overlay (call pill, touch mic tab), the thread header's Talk. |
| `skills/voice-concierge/` | Tells agents about `bb voice-concierge`. |
| `tests/` | `npm test`: core, the JSON-RPC peer, the Codex backend against a fake host, the thread relay, call targets, styles. |

## Develop
```sh
npm install --include=dev
npm run typecheck && npm test
bb-plugins-sync --path "$PWD"     # try it in the running bb; the next sync or rebuild restores the declared set
```
