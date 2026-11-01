---
name: voice-concierge
description: The bb voice concierge plugin. Use when asked about talking to bb by voice, the Voice concierge page, its sign-in, which machine it runs on, its thread or call log, or when you are the concierge's own agent.
---

# Voice concierge

The **Voice concierge** page in bb's navigation starts a realtime voice call (Talk / Hang up / Mute). A voice
model answers aloud and relays each bb question to the concierge's own bb thread (pinned, "Voice concierge", in
the Personal project), which uses the `bb` CLI; its reply is spoken back. That thread is the conversation: it is
shown below the sphere on the page and can be continued by typing.

```sh
bb voice-concierge status        # backend, machine, Codex login, ready or what is missing (exit 1 when not ready)
bb voice-concierge login         # device-code sign-in: prints a URL and a code for the person to enter
bb voice-concierge logout
bb voice-concierge transcript 50 # the last 50 lines said in calls
bb voice-concierge thread        # the concierge's own bb thread id
bb voice-concierge ask '<text>'  # ask that thread and print its reply (what a call does for each question)
```

Settings (`bb plugin config voice-concierge set <key> <value>`): `machine` (name or id; empty = the bb server's
machine, else any connected machine where Codex is signed in), `codexHome` (`dedicated`, the plugin's own
login, or `user`, that machine's `~/.codex`), `version` (`v3` GPT-Live, or `v1`), `voice`, `sphereStyle`,
`orbAutoMinimize` (dock the sphere small during a call), `threadMode` (`reuse` or `new` per call),
`threadProvider`, `threadModel` (the concierge thread's agent), `instructions`.

Starting a call needs a microphone in a window (bb desktop app, or a browser on https or localhost); an agent
cannot start one from the CLI. A call uses the person's ChatGPT plan.

If you are the concierge's agent (its bb thread): follow your first message. Read by default; write into another
thread only when the person asks and, for a `[voice]` request, the message ends with "(confirmed)".
