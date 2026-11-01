# A realtime voice concierge for bb

Date: 2026-11-01. Research and design. Sections 1–8 were written before anything
was installed or enabled, before any realtime session, and without messaging any
other thread. **§9 (same day) records what building phase 1 and trying option (c)
established**, including two corrections to §2.

**The owner's ask.** "I want bb to have a plugin that does the same as GPT
realtime in Codex, so I can talk to it in realtime — more hands-off, when I
don't want to look at the screen. We can take advantage of our Codex
subscription. I still want the threads like now, but an agent/thread that
oversees bb and looks into other threads if needed. When talking, the agent
should be aware of / able to reach most things so it can answer me back. But
those exchanges must not end up in the specific threads where I'm doing work —
just a thread for conversation."

Each claim carries a tag:

- **[measured]**: observed on shared-server or read from the work Mac today
  (Codex CLI 0.166.0, bb 0.48.1).
- **[doc]**: vendor documentation or shipped source/schema, read today.
- **[secondary]**: third-party write-up or press.
- **[unverified]**: not confirmed; treat as a hypothesis to test.
- **[estimate]**: arithmetic on the numbers cited next to it.

## 1. Short answer

1. **Codex has a realtime voice mode, and our own client can drive it on the
   subscription.** The Codex app-server (the JSON-RPC API that the Codex
   desktop app and bb's Codex provider both talk to) has an experimental
   `thread/realtime/*` API: start a voice session bound to a Codex thread over
   **WebRTC** (the client sends its SDP offer) or WebSocket, stream transcripts,
   and let the realtime model **delegate** work to that thread's Codex agent and
   speak the result back [measured]. With a ChatGPT login, the CLI routes it to
   ChatGPT's `backend-api/realtime/calls`, not to the paid API [measured]. That
   is architecture (a) almost as written, and it is already built.
2. **Build a small bb plugin that owns its own `codex app-server` and a single
   "concierge" Codex thread, and puts the WebRTC leg in the bb UI.** The browser
   or desktop app talks audio straight to OpenAI; the plugin only negotiates the
   session and answers tool calls with curated, read-only bb state through the
   SDK. Conversation lives in that concierge thread and the plugin's panel, never
   in work threads.
3. **Writes to other threads are blocked by a hook, not by trust.** bb's
   `message.dispatch` hook sees every message's sender and origin plugin. The
   plugin rejects anything it originated unless the owner confirmed that exact
   message aloud first.
4. **Cheapest fallback without a realtime model (b) is nearly free today:** a
   pinned "Concierge" bb thread plus bb's existing composer microphone, and a
   small "speak the reply" action. It is laggy and not hands-free.
5. **The zero-build option (c) also works today:** the ChatGPT desktop app's
   GPT-Live voice (already used on the work Mac) plus bb's built-in **MCP server**
   plugin (`bb--mcp`, off by default). It gives the voice everything, including
   writes, with no bb-side guard, and keeps the conversation in ChatGPT, not bb.

**Recommendation:** prototype (a) as the plugin in §6, reads only, in about 2–3
days. Meanwhile, try (c) for an afternoon to calibrate what "good" feels like.

## 2. What "GPT realtime in Codex" is today

### 2.1 Three voice surfaces

| Surface | What it is | Auth | Source |
|---|---|---|---|
| **ChatGPT desktop app (merged Codex app), "Start voice chat"** | Full-duplex voice "powered by GPT-Live" inside a Codex task. It can start tasks, check others, send follow-ups, and "speak to another task and then return". Only one voice chat is active at a time. Screen context (appshots) is macOS-only. iOS works after pairing the phone with a desktop host. | Plus, Pro, Business, Edu, Enterprise | [doc] [ChatGPT Voice](https://learn.chatgpt.com/docs/features/voice) |
| **Codex CLI `/voice`** | Voice conversation in the TUI. F8 toggles it and `/voice` picks settings; F9 mutes (moved in Oct 2026). Push-to-talk dictation has existed since v0.105. | ChatGPT plan; API-key-only setups reportedly fall back to text | [secondary] changelog snippets via search; [Daniel Vaughan, Aug 2026](https://codex.danielvaughan.com/2026/08/04/voice-driven-development-codex-cli-gpt-live-full-duplex-push-to-talk-realtime-v3/), [Mar 2026](https://codex.danielvaughan.com/2026/03/31/codex-cli-realtime-sessions-voice-transcription) |
| **App-server `thread/realtime/*`** | The API under both surfaces above; any app-server client can call it. Experimental. | Whatever the app-server is logged in with | [measured] schema generated from 0.166.0 |

### 2.2 The app-server realtime API (measured on 0.166.0)

`codex app-server generate-json-schema --experimental` lists these client
requests: `thread/realtime/start`, `appendAudio`, `appendText`, `appendSpeech`,
`stop`, and `listVoices`. Server notifications are `thread/realtime/started`,
`sdp`, `itemAdded`, `item/started`, `item/transcript/delta`, `item/completed`,
`transcript/delta`, `transcript/done`, `outputAudio/delta`, `error`, and
`closed`. The stable (non-experimental) schema omits the client requests, so a
client must set `capabilities.experimentalApi: true` at `initialize`; bb's Codex
provider already does [measured].

`ThreadRealtimeStartParams` (required: `threadId`, `outputModality`):

- `transport`: `{type:"webrtc", sdp}` ("SDP offer generated by a WebRTC
  RTCPeerConnection after configuring audio and the realtime events data
  channel"), `{type:"websocket"}`, or `{type:"existingCall", callId}`. The SDP
  answer comes back in `thread/realtime/sdp`.
- `outputModality`: `text` | `audio`. `voice`: 35 named voices (`marin`,
  `cedar`, …). `version`: `v1` | `v2` | `v3`. `model`: per-session override.
- `realtimeStartInstructions` / `realtimeEndInstructions`: "Developer
  instructions given to the backing Codex model when this realtime session
  starts/ends".
- `includeStartupContext`, `initialItems` (v3 only, ≤128 items / ≈8k tokens),
  `delegationAckFiller`, `backendReasoningStatus`, `clientManagedHandoffs`,
  `codexResponsesAsItems`: these control how the realtime model **delegates to
  the backing Codex thread** and how Codex's answers return to be spoken.

`ThreadStartParams` takes `dynamicTools`, and the server sends `item/tool/call`
requests to the client [measured]. A client can therefore hand the backing
thread tools it implements in-process, with no MCP server.

Model and endpoint strings in the 0.166.0 binary: `gpt-realtime-1.5`,
`gpt-live-1-codex`, `/backend-api` + `realtime/calls` (ChatGPT backend),
`/v1/realtime` (API), and config keys `experimental_realtime_ws_base_url`,
`experimental_realtime_webrtc_call_base_url`, `experimental_realtime_ws_model`,
`experimental_realtime_ws_backend_prompt`, `experimental_realtime_ws_startup_context`,
and `experimental_realtime_start_instructions` [measured]. Which model is the
default for a ChatGPT login is [unverified]. The likely answer is `gpt-live-1-codex`
for v3 and `gpt-realtime-1.5` for older versions.

The schema includes the WebRTC transport, the experimental flag, and the
delegation knobs. The [official app-server doc](https://learn.chatgpt.com/docs/app-server.md)
does not document realtime yet [doc]. It is churning: the 0.165/0.166 changelog
has realtime handoff and sideband fixes ([changelog](https://learn.chatgpt.com/docs/changelog)) [doc].

### 2.3 Can a subscription login legitimately drive it from our own client?

**Yes, through the app-server; no, by calling the backend directly.**

- The app-server doc presents it as "the interface Codex uses to power rich
  clients" and recommends it for "deep integration inside your own product". It
  states that "App-server authentication has never been permitted for commercial
  or hosted services" and that the command "isn't supported for production
  workloads" [doc]. A personal plugin on the owner's own machines, logged in as
  the owner, is the non-commercial, non-hosted use it allows. bb's Codex provider
  already runs the same way for every Codex thread here.
- Codex itself authenticates the realtime call (it builds the ChatGPT headers).
  Our client only hands over an SDP offer and receives an SDP answer. We never
  touch the token.
- **Not allowed:** lifting the ChatGPT token from `~/.codex/auth.json` and
  calling `chatgpt.com/backend-api/realtime/calls` from our own code. That
  bypasses the client the login was issued to.
- **Usage:** desktop voice "and tasks share your plan's usage limits", and
  credit-billed workspaces pay 1.25 credits per minute for desktop voice [secondary,
  search snippet of the help center; not opened]. Whether app-server realtime
  draws from the same budget is [unverified], but it probably does.
- **Risk:** the API is experimental and may break on any Codex bump. Pin the
  Codex version the plugin was tested against, and fail soft.

### 2.4 What is on the machines

| | shared-server | work Mac (`popemkt-work`) |
|---|---|---|
| Codex CLI | 0.166.0, ChatGPT login [measured] | `version.json` last saw 0.163.0. The app ships its own CLI at `/Applications/ChatGPT.app/Contents/Resources/codex-cli/` [measured] |
| Desktop app | none | `ChatGPT.app` 26.1021.31345 (bundle `com.openai.codex`, the merged Codex app) and a stale `Codex.app` 26.707 [measured] |
| Feature flags | `in_app_voice` stable/on; `realtime_conversation` "removed" (graduated) [measured] | n/a |
| Voice in use | none | Yes. `realtime-voice-continuity.json` holds voice transcripts from Codex tasks; 13 trusted project dirs `Documents/Codex/2026-09-{15,20}/realtime-voice-chat*`; `[desktop] realtimeVoiceScreenContextEnabled = true`; and a `config.toml.before-voice-fix-20260915-…bak` [measured] |
| Realtime routing | default (ChatGPT backend) | `experimental_realtime_ws_base_url = "http://127.0.0.1:10100/v1"`, "Auto-injected by opencodex", a local proxy. Its effect on realtime is [unverified]. |

The Mac transcripts show two things that matter for the design. First, a Codex
voice chat's exchanges are stored on the Codex task it ran in, which is exactly
the leak the owner wants to avoid when that task is a work task. Second, the user
turns are duplicated (each utterance appears twice), so echo and duplicate
transcript handling needs a test.

### 2.5 Alternatives

- **OpenAI Realtime API with an API key.** `gpt-realtime-2.1` costs $32 / $64 per
  1M audio tokens in/out ($0.40 cached input); `gpt-realtime-2.1-mini` costs
  $10 / $20 ([announcement, 2026-07-06](https://community.openai.com/t/new-realtime-models-on-the-api-gpt-realtime-2-1-and-gpt-realtime-2-1-mini/1385896);
  [gpt-realtime-2 model page](https://developers.openai.com/api/docs/models/gpt-realtime-2))
  [doc]. At the commonly quoted ~600 input / ~1,200 output audio tokens per
  minute [unverified rates], a minute with both sides talking costs about
  $0.02 in + $0.08 out ≈ **$0.10/min** on 2.1, or ≈ $0.03/min on mini. With
  silence and cached context, a realistic conversation runs about
  **$0.05–0.15/min** [estimate]. This path is metered, needs a key, and the
  tool loop is ours.
- **Local STT/TTS.** `bb voice transcribe` uses whichever voice service is
  selected in `bb settings ai-services` (bb cloud, or any plugin that registers
  `transcribe`) [doc]. On the Mac, FluidVoice already ships Parakeet dictation.
  OmniVoice Studio has Parakeet STT plus an OpenAI-compatible
  `/v1/audio/speech` and MCP ([local-voice-tools.md](../local-voice-tools.md)).
  Free and private, but turn-based: no barge-in or full duplex unless we build
  VAD and interruption ourselves.

## 3. The bb side

### 3.1 What the Plugin SDK gives us (bb 0.48.1, [doc] bb-plugin-authoring references)

- **UI.** A frontend bundle (`definePluginApp`) can add a navigation page or
  rail entry, a sidebar-footer action, a thread panel tab (`experimental_tab`),
  thread header actions, and an always-on `experimental_appOverlay`. A floating
  "talk" orb fits the overlay; a transcript fits a panel tab or navigation page.
- **Audio in the UI.** bb's own composer records the microphone, and
  `experimental_VoiceInputTextarea` exposes that (transcript only, never
  submitted). Nothing in the SDK wraps WebRTC or `getUserMedia` for plugins.
  A plugin bundle calling `getUserMedia` / `RTCPeerConnection` directly is
  plausible because bb's own frontend has microphone access, but this is
  [unverified] on desktop, web over the tailnet (needs a secure origin), and
  mobile.
- **Server.** `bb.rpc` (typed frontend↔server calls), `bb.realtime.publish`
  (ephemeral signals to the UI), `bb.http` routes plus `experimental_websocket`
  (token auth for external clients), `bb.background.service`, `bb.storage`,
  `bb.settings` (secrets stay server-side), and host entries via
  `bb.hosts.experimental_client` for host-local state, "as the Codex plugin
  does".
- **Agents.** `bb.agents.registerTool` adds native tools to bb threads, and
  `contributeInstructions` adds per-thread instruction blocks.
- **The guard.** `bb.experimental_hooks.on("message.dispatch")` runs for every
  message into every thread. It receives `initiator`, `senderThreadId`,
  `origin`/`originPluginId`, and the text, and returns `proceed`, `reject`, or
  `wait`.
- **Reading everything.** `bb.sdk.threads.list / get / search / timeline / output
  / conversationOutline / childSummary / listRunning`, plus `interactions.list`
  (who is waiting on the owner), `environments`, `projects`, and
  `system.attention / usageLimits`. CLI equivalents: `bb thread list --json`,
  `show`, `log`, `output`, `search`, `bb lanes now` (running turns and requests
  waiting for a person), and `bb workflows status <run>` [measured `--help`].
- **Built-in MCP server** (`bb--mcp`, disabled here). Its tools are `search`,
  `read` (a sandboxed JS snippet that may call only inspecting `bb` commands),
  and `run` (any `bb` command). Local endpoint
  `http://127.0.0.1:<port>/api/v1/plugins/bb--mcp/http/mcp`; remote through bb
  connect and a bb account. Access is all or nothing [doc, the plugin's SKILL.md].
- **Related built-ins.** `side-chat` ("reply to messages in hidden side-chat
  forks rendered in a thread panel") already shows that bb is fine with hidden
  conversation forks. bb's Codex provider receives `thread/realtime/*` events
  but classifies them as "unknown", so bb has no realtime support yet [measured].

### 3.2 How bb runs Codex, and why the plugin needs its own app-server

bb's Codex provider spawns `codex app-server` per session over stdio, with
`experimentalApi: true`. When the account pool is in use, it sets
`openai_base_url` to the pool hub [measured, `provider-codex/dist/host.js`].
A plugin cannot reach into that process to call `thread/realtime/start` on a bb
thread's Codex session. The plugin therefore owns a second `codex app-server` on
the same host and login, and creates one Codex thread of its own: the
concierge. Spawn it without the pool's base-URL override; whether the account
pool proxies `realtime/calls` is [unverified].

Making the concierge a first-class bb thread needs bb core to support realtime
in the Codex provider (pass through `thread/realtime/*` and expose the SDP
exchange to plugins). That is a later upstream ask, not a blocker.

### 3.3 Where the audio lives

Put WebRTC **in the client** (the bb desktop app, a browser tab, the phone),
which is what the transport was designed for. The client creates the
`RTCPeerConnection` with the microphone track and a data channel, then sends the
SDP offer to the plugin over RPC. The plugin's host process passes it to
`thread/realtime/start {transport:{type:"webrtc", sdp}}` and returns the answer
from `thread/realtime/sdp`. Audio then flows client ↔ OpenAI directly, never
through the bb server. That gives the lowest latency, echo cancellation and
barge-in from the browser, and no audio load on shared-server.

The alternative, a host process doing audio over WebSocket (`appendAudio` and
`outputAudio/delta`), only makes sense for a headless speakerphone device.

### 3.4 How the voice reaches things

The realtime model talks; the **backing Codex thread** does the work. Its
`dynamicTools` (answered by the plugin through `item/tool/call`) are a small,
read-only, redacted set built on `bb.sdk`:

| Tool | Returns |
|---|---|
| `bb_overview` | running turns, threads waiting on the owner (`lanes now`), threads finished since last asked, failed turns |
| `thread_brief(id \| title query)` | title, status, last user ask, last agent output (trimmed), PR state |
| `search_threads(query)` | top hits with ids |
| `workflow_status(run?)` | compact workflow and trial status |
| `kb_board` | the owner's kb board nodes (the "morning board" node set is [unverified]; locate it in the owner's kb) |
| `ask_concierge(question)` *(phase 2)* | sends the question to the **bb concierge thread** (a normal Claude or Codex bb thread), waits, and returns its answer |
| `relay(thread, text)` *(phase 2)* | stages a message and returns a confirmation id; it is sent only after spoken confirmation (§5) |

Defining the tools once in the plugin also lets a text concierge thread get the
same tools through `bb.agents.registerTool`: one contract, two front ends.

## 4. Architectures

### (a) Codex realtime voice front end and a concierge thread, as a bb plugin

```
 phone / desktop / browser                     shared-server (bb host)
 ┌──────────────────────────┐   RPC: SDP     ┌──────────────────────────────┐
 │ voice-concierge panel    │ ─────────────▶ │ plugin server + host entry    │
 │  RTCPeerConnection       │ ◀── answer ─── │  codex app-server (stdio)     │
 │  mic ▸ ◂ speaker         │                │   thread "concierge"          │
 └──────────┬───────────────┘                │   dynamicTools → bb.sdk reads │
            │ WebRTC audio (direct)          │  message.dispatch guard       │
            ▼                                └──────────────┬───────────────┘
      OpenAI realtime (ChatGPT plan) ◀── delegation/handoff ─┘
```

- **Latency.** Small talk and acknowledgements are realtime-native, sub-second
  [secondary, unverified for this path]. A tool read through the backing Codex
  model takes a model turn plus about 100–500 ms of SDK calls: a few seconds,
  covered by `delegationAckFiller` ("let me check"). Deep questions handed to a
  bb thread (phase 2) take 10–60 s: the voice says so and pings when done.
- **Cost.** Subscription usage, assumed shared with Codex tasks [unverified for
  app-server]; no API key.
- **Reach.** Everything bb's SDK can read, filtered by the plugin. With phase 2,
  anything a full agent can investigate.
- **Isolation.** The conversation lives in the concierge Codex thread (rollout
  on the host) plus the plugin's stored transcript and panel. Work threads only
  change through `relay`, behind the guard in §5.
- **Privacy.** Audio goes client ↔ OpenAI as with Codex voice today. Tools
  redact secret-looking values before the model sees them. `bb.settings` secrets
  and `secrets` plugin files are never readable.
- **Hands-free.** PTT and toggle first. Barge-in comes free from the full-duplex
  model. A wake word ("hey bb") would need an always-on local keyword spotter in
  the client: a phase-3 item, and it drains battery on a phone.
- **Phone.** It works if the bb mobile app or mobile browser allows the
  microphone and WebRTC in a plugin page [unverified]. Otherwise use a
  standalone page served by `bb.http` with token auth over the tailnet.
- **Risk.** It sits on an experimental API. The fix is to pin the Codex version
  and fall back to (b).

### (b) Push-to-talk STT → concierge thread (text) → TTS

- PTT through bb's existing microphone (`experimental_VoiceInputTextarea` or the
  composer) → `bb voice transcribe` (bb cloud or local Parakeet) → message to a
  pinned **Concierge** bb thread (Claude Code or Codex on subscription) with the
  read tools from §3.4 → its reply is spoken by TTS (browser `speechSynthesis`
  for free, or OmniVoice / OpenAI TTS for a better voice).
- **Latency.** STT 1–3 s + agent turn 5–30 s + TTS 1–2 s [estimate]. Turn-based,
  no barge-in.
- **Cost.** About zero extra: subscription turns plus free or local STT/TTS.
- **Isolation.** Same guard. The conversation is a real bb thread, which fully
  meets "just a thread for conversation".
- **Phone.** bb mobile already has the composer microphone [unverified]; TTS
  needs a speak action.
- Phase 0 of (b) needs **no code**: pin a Concierge thread, give it a skill
  describing the read commands and the no-write rule, and use the microphone.
  What is missing is the spoken reply and hands-free use.

### (c) The ChatGPT desktop app's own voice and bb's MCP server

- Enable `bb--mcp` and add it to Codex on the Mac (local address if Codex runs
  where bb is; otherwise the remote address through bb connect and a bb
  account). Then start a voice chat in a dedicated "bb concierge" Codex task.
- **Latency.** Best of the three (GPT-Live, full duplex, screen context on macOS)
  [doc].
- **Cost.** Subscription; one voice chat at a time [doc].
- **Reach.** `bb--mcp` `run` can do **anything** bb can, including starting
  agents and messaging threads, and there is no per-tool grant [doc]. Codex's
  per-tool `approval_mode` (seen in the Mac config) could gate `run`
  [unverified with voice]. Nothing bb-side distinguishes "the owner confirmed"
  from "the model decided".
- **Isolation.** The conversation sits in a ChatGPT/Codex task, outside bb. That
  meets "not in work threads" but is not a bb thread, and the owner must keep
  voice out of work tasks by habit.
- **Phone.** iOS after pairing with a desktop host [doc].
- **Unknowns.** Whether the local MCP endpoint accepts tailnet clients (it
  refuses web pages) is [unverified], as is how the Mac's opencodex realtime
  override interacts.

### Comparison

| | (a) plugin + Codex realtime | (b) PTT → thread → TTS | (c) ChatGPT voice + bb MCP |
|---|---|---|---|
| Feels like | Codex voice, inside bb | walkie-talkie | Codex voice, outside bb |
| Voice latency | <1 s chat, s for tools | 7–35 s per turn | <1 s chat, s for tools |
| Cost | subscription | ≈ free | subscription |
| Reach | curated bb reads (+ deep hand-off) | curated reads + full agent | all of bb, writes included |
| Write guard | hard (dispatch hook + confirm id) | hard (same hook) | soft (approval prompts) |
| Conversation lives in | concierge Codex thread + bb panel | a bb thread | a ChatGPT/Codex task |
| Build | ~2–3 days | 0 → ~0.5 day | ~1 hour of config |
| Fragility | experimental Codex API | low | medium (two products) |

## 5. Keeping the conversation out of work threads

1. **A home of its own.** The concierge is its own Codex thread (and, for (b) or
   phase 2, its own bb thread in the personal project, section "Concierge").
   Nothing it does creates messages elsewhere by default. All tools are reads.
2. **One write path.** `relay(thread, text)` stores a pending message with an id
   and returns "Say 'send it' to post: «text» to «thread title»". Only a later
   owner utterance confirming that id sends it, through `bb.sdk.threads.send`
   with `origin` set to the plugin.
3. **A hard backstop.** The plugin's `message.dispatch` hook rejects any message
   whose `originPluginId` is the concierge plugin, or whose `senderThreadId` is
   the concierge bb thread, unless it matches a confirmed relay id. A prompt
   injection inside a work thread's output therefore cannot make the concierge
   post anywhere.
4. **Speak back first.** Before sending, the voice repeats the target thread's
   title and a one-line paraphrase.
5. **Secrets never spoken.** Tool outputs pass through a redactor (key/token
   patterns, `.env`-style lines, `bb.settings` secret fields never read). The
   realtime instructions say "never read identifiers, keys, or long hashes
   aloud; say 'a key' instead".
6. **Short by default.** Spoken answers stay at one or two sentences, with "want
   details?" to continue; the full text goes to the panel.

## 6. Recommendation and the smallest prototype

Build (a) as `assets/bb-plugins/voice-concierge`, in phases. Phase 1 is the
prototype.

**Phase 1: talk to bb, read-only (about 600–900 lines, 2–3 days).**

- Host entry on shared-server: spawn `codex app-server` (stdio, experimental API,
  ChatGPT login, no pool base-URL), then `thread/start` the concierge (or
  `thread/resume` it), with `ephemeral: false`, a read-only sandbox, no
  approvals, `developerInstructions` (the concierge persona and the §5 rules),
  and `dynamicTools` = `bb_overview`, `thread_brief`, `search_threads`,
  `workflow_status`.
- Server RPC: `start({sdpOffer, voice?})` → `thread/realtime/start {transport:
  {type:"webrtc", sdp}, outputModality:"audio", version:"v3"}` → await
  `thread/realtime/sdp` → return the answer SDP. Also `stop()` and `status()`.
  Transcript deltas go out via `bb.realtime.publish` and are stored in
  `bb.storage`. Tool calls are answered from `bb.sdk`, redacted and bounded.
- Frontend: a sidebar-footer "Talk" action and a navigation page with a big
  toggle button, the live transcript, and the last tool used. It runs
  `getUserMedia` and `RTCPeerConnection` and plays the remote audio track.
- A `bb voice-concierge status` CLI command and a `skills/` doc.
- Exit test: on the bb desktop app, ask "what's running and what needs me?" and
  "what did the sandbox thread conclude?" and get correct spoken answers. No
  message appears in any other thread.

**Phase 2: deep questions and confirmed relays (about 1–2 days).** Add a bb
"Concierge" thread for `ask_concierge`, plus `relay` and the dispatch guard.
Speak a notification when a hand-off finishes.

**Phase 3: hands-free and phone.** Test the mobile app or tailnet browser;
consider a wake-word spotter; add a fallback to (b) when the realtime API breaks.

**This week, for free:** try (c) for an afternoon (enable `bb--mcp` locally and
voice-chat a dedicated Codex task) to set expectations, then disable it again.
Phase 0 of (b) is also free and could start now.

## 7. What is needed from the owner

1. **Permission to start realtime sessions** for the prototype. They draw on
   the ChatGPT plan's usage. No API key is needed for (a). A key is only needed
   to compare against the paid Realtime API.
2. **Which login runs the concierge:** the shared-server Codex login (the
   current ChatGPT account) or a dedicated account in the pool.
3. **Which device and client first:** the bb desktop app on the Mac, a browser,
   or the phone. Microphone permission will be needed on that client.
4. **Whether (c) may be tried:** enabling `bb--mcp` grants "all or nothing"
   access. Local address only, and switched off after the test.
5. **The concierge's model for deep work** (phase 2): Claude or Codex.
6. **Where the "morning board" lives** in kb (node or tag), for `kb_board`.

## 8. Open questions

- The default realtime model and version for a ChatGPT login via app-server, and
  whether v3 delegation works outside the desktop app.
- Whether app-server realtime usage counts against the same plan limits as
  desktop voice.
- Whether a bb plugin page may use the microphone and WebRTC on desktop, web,
  and mobile.
- Whether bb's account pool can proxy `realtime/calls`. Until known, bypass it.
- The duplicated user turns in the Mac's voice transcripts: an echo or a
  persistence artifact?
- Whether bb should support realtime in its Codex provider upstream, so the
  concierge becomes a native bb thread.

## 9. Update: building phase 1, and option (c) tried

The owner chose (a) with changes: Codex required for now, behind a small
voice-backend seam; it must work with one machine or several; desktop app and
browser first; and no special hand-off machinery, because the concierge uses
bb's normal CLI under its instructions. The plugin is
[`assets/bb-plugins/voice-concierge`](../../assets/bb-plugins/voice-concierge/README.md).

### 9.1 What the Codex source settled

- **The transport decides the auth, not the plan** [doc, `codex-rs/core/src/realtime_conversation.rs`].
  `transport: websocket` requires an API key ("realtime conversation requires
  API key auth"; also [measured] on 0.166.0). `transport: webrtc` creates the
  call through Codex's model client with the session's own login (ChatGPT), and
  needs `version` v1 or v3 and a conversational session. The client never
  handles a token. This corrects §2.3, which did not distinguish the two.
- **Models:** `v3` is `gpt-live-1-codex` (GPT-Live, "Frameless Bidi") and
  `v1` is `gpt-realtime-1.5`. WebRTC without a `version` defaults to v1 and
  ignores `voice`. `prompt` is the voice model's instructions; the backing
  thread's `developerInstructions` hold the agent's rules. Text output needs v2,
  which WebRTC refuses.
- **Sideband:** with WebRTC, audio flows client ↔ OpenAI and Codex attaches a
  sideband WebSocket to the call (`call_id`) to run hand-offs. This is why the
  plugin needs no audio path through bb.
- **bb's account pool cannot carry it.** bb runs Codex threads through the
  pool hub (`model_provider = "bb-account-pool"`), and the hub has no
  `realtime/calls` route [measured]. A custom model provider was also what broke
  voice on the work Mac until it was removed (the `before-voice-fix` backup).
  The plugin therefore runs its own `codex app-server`, without the pool's
  environment, and with **its own `CODEX_HOME`** by default, signed in once by
  device code from the plugin page. A side finding: shared-server's own
  `~/.codex` login is dead ("refresh token was already used"), because the
  pool took over that account's tokens [measured].

### 9.2 Option (c): bb's MCP server, tried

`bb plugin enable bb--mcp` [done on shared-server]. `bb mcp status` gives
`Local: http://127.0.0.1:38886/api/v1/plugins/bb--mcp/http/mcp`. Port 38886 is
the bb server's own port, bound to loopback, so the MCP server reaches nothing
the `bb` CLI on that machine could not already reach. Remote access is
unavailable until bb is signed in to a bb account with bb connect on.

Measured with a raw MCP client on shared-server:

- **Tools:** `search`, `read` (read-only snippet), `run` (any command).
- **`read`** returned the thread count, the running threads, and a thread's
  output in **0.7 s**. It refuses every write (`bb thread tell` …) and also
  every **plugin command** (`bb lanes now`, `bb workflows …`): those need `run`.
- **`run`** can do anything bb can, writes included. There is no per-command
  grant, and nothing bb-side requires spoken confirmation.

**Connecting ChatGPT desktop voice to it (work Mac).** Steps 1–3 are not tried:
they need the owner's Mac.

1. Forward the port, keeping it loopback-only on both ends:
   `ssh -N -L 38886:127.0.0.1:38886 shared-server` (any free local port works;
   use it in step 2).
2. Add to `~/.codex/config.toml` on the Mac:

   ```toml
   [mcp_servers.bb]
   url = "http://127.0.0.1:38886/api/v1/plugins/bb--mcp/http/mcp"

   [mcp_servers.bb.tools.search]
   approval_mode = "approve"
   [mcp_servers.bb.tools.read]
   approval_mode = "approve"
   [mcp_servers.bb.tools.run]
   approval_mode = "prompt"
   ```

   Valid values are `auto | prompt | writes | approve` [doc, `AppToolApproval`].
   Whether a `prompt` approval can be answered by voice is [unverified].
3. In the ChatGPT app, start a new Codex task in a scratch folder (for example
   `~/Documents/Codex/bb-concierge`), choose **Start new voice chat**, and ask
   "use the bb tools: what's running and what needs me?". Keep voice out of work
   tasks: a voice chat's exchanges are stored on the task it runs in.

**Switching it off:** remove the `[mcp_servers.bb…]` blocks, stop the tunnel,
and run `bb plugin disable bb--mcp` on shared-server (`bb mcp status` then
fails).

**What it can and can't do.** It can read any thread, project, environment,
diff or setting quickly, and with `run` act on anything, from the best voice UX
there is (GPT-Live with screen context). It can't stay inside bb: the
conversation lives in a ChatGPT task. It can't read plugin views such as lanes
without `run`, it allows only one voice chat at a time, it works only where the
ChatGPT app runs (Mac, Windows, iOS by pairing), and it has no enforced write
guard. It is a good fallback and a reference for the UX bar, not the bb-native
concierge.

## Sources

- Codex CLI 0.166.0: `codex features list`, `codex app-server
  generate-json-schema [--experimental]`, and strings in the shipped binary
  (shared-server, 2026-11-01).
- bb 0.48.1: `bb-plugin-authoring` references; `provider-codex/dist/host.js`;
  `mcp/skills/mcp/SKILL.md`; `side-chat/package.json`; `bb thread --help`;
  `bb lanes --help`.
- Work Mac via `bb_file_gateway` (read-only): `/Applications/{ChatGPT,Codex}.app/Contents/Info.plist`,
  `~/.codex/{config.toml,version.json,realtime-voice-continuity.json}`.
- [Codex App Server](https://learn.chatgpt.com/docs/app-server.md) (formerly
  developers.openai.com/codex/app-server)
- [ChatGPT Voice (Codex docs)](https://learn.chatgpt.com/docs/features/voice)
- [ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog)
- [Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)
  (search result, not opened)
- [GPT-Realtime-2 model](https://developers.openai.com/api/docs/models/gpt-realtime-2),
  [gpt-realtime-2.1 announcement](https://community.openai.com/t/new-realtime-models-on-the-api-gpt-realtime-2-1-and-gpt-realtime-2-1-mini/1385896),
  [API pricing](https://developers.openai.com/docs/pricing)
- [secondary] Daniel Vaughan's Codex notes:
  [realtime sessions](https://codex.danielvaughan.com/2026/03/31/codex-cli-realtime-sessions-voice-transcription),
  [push-to-talk to GPT-Live](https://codex.danielvaughan.com/2026/08/04/voice-driven-development-codex-cli-gpt-live-full-duplex-push-to-talk-realtime-v3/);
  [AI Catchup on ChatGPT Voice + Codex](https://aicatchup.com/news/openai-chatgpt-voice-codex-desktop-mobile)
- [local-voice-tools.md](../local-voice-tools.md)
