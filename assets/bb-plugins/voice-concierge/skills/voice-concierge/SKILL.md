---
name: voice-concierge
description: The bb voice concierge plugin. Use when asked about talking to bb by voice, the Voice concierge page, its sign-in, which machine it runs on, or its transcript, or when you are the concierge's own Codex agent.
---

# Voice concierge

The **Voice concierge** page in bb's navigation starts a realtime voice call (Talk / Hang up / Mute, or type
into the call). A voice model answers aloud and hands bb questions to its own Codex agent, which uses the
`bb` CLI. The conversation stays in the plugin's transcript and the concierge's own Codex thread.

```sh
bb voice-concierge status        # backend, machine, Codex login, ready or what is missing (exit 1 when not ready)
bb voice-concierge login         # device-code sign-in: prints a URL and a code for the person to enter
bb voice-concierge logout
bb voice-concierge transcript 50 # the last 50 lines of the conversation
```

Settings (`bb plugin config voice-concierge set <key> <value>`): `machine` (name or id; empty = the bb server's
machine, else any connected machine where Codex is signed in), `codexHome` (`dedicated`, the plugin's own
login, or `user`, that machine's `~/.codex`), `version` (`v3` GPT-Live, or `v1`), `voice`, `instructions`.

Starting a call needs a microphone in a window (bb desktop app, or a browser on https or localhost); an agent
cannot start one from the CLI. A call uses the person's ChatGPT plan.

If you are the concierge's Codex agent: follow your developer instructions. Read by default; write into
another thread only when the person asks and has confirmed aloud.
