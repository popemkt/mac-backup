---
name: voice-concierge
description: The bb voice concierge plugin. Use when asked about talking to bb by voice, the Voice concierge page, its sign-in, which machine it runs on, its thread or call log, or when you are the concierge's own agent.
---

# Voice concierge

A realtime voice call (Talk / Hang up / Mute) talks to one bb thread. **Talk** in a thread's header talks to that
thread: each request is relayed to it and its agent's reply is spoken. The **Voice concierge** page (and Talk from
anywhere without a thread on screen) talks to the concierge's own bb thread (pinned, "Voice concierge", in the
Personal project), which oversees bb with the `bb` CLI. A call stays with its thread while the person moves around;
**Move call here** in another thread's header moves it. The thread is the conversation and can be continued by
typing.

```sh
bb voice-concierge status        # backend, machine, Codex login, ready or what is missing (exit 1 when not ready)
bb voice-concierge login         # device-code sign-in: prints a URL and a code for the person to enter
bb voice-concierge logout
bb voice-concierge transcript 50 # the last 50 lines said in calls
bb voice-concierge thread        # the concierge's own bb thread id
bb voice-concierge ask '<text>'  # ask that thread and print its reply
bb voice-concierge ask --call <id> -- '<text>'  # what a call does for each question: ask the call's own thread
```

Settings (`bb plugin config voice-concierge set <key> <value>`): `machine` (name or id; empty = the bb server's
machine, else any connected machine where Codex is signed in), `codexHome` (`dedicated`, the plugin's own
login, or `user`, that machine's `~/.codex`), `version` (`v3` GPT-Live, or `v1`), `voice`, `sphereStyle`,
`orbAutoMinimize` (dock the sphere small during a call), the sphere's knobs `<style><Knob>` for each style
(`jelly`, `moonstone`, `aurora`, `frosted`, `chromeOrbit`, `aiBlob`, `gradientBlob`), e.g. `jellyGlow`.
See `core/visuals.ts` for the common and style-specific knobs, ranges and defaults. Also: `threadMode` (`reuse` or `new` per call),
`threadProvider`, `threadModel` (the concierge thread's agent), `instructions`.

Starting a call needs a microphone in a window (bb desktop app, or a browser on https or localhost); an agent
cannot start one from the CLI. A call uses the person's ChatGPT plan.

If you are the concierge's agent (its bb thread): follow your first message. Read by default; write into another
thread only when the person asks and, for a `[voice]` request, the message ends with "(confirmed)".

If a message in your own thread starts with `[voice]`, the person is talking to you on a voice call: follow the note
under it (your reply is spoken, so one or two plain sentences; change nothing until a request ends with
"(confirmed)").

For visual tuning behavior and implementation provenance, see [The sphere](../../README.md#the-sphere).
