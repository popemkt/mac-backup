Talk to bb out loud, hands-free: a realtime voice concierge that sees your threads and answers aloud, in a
conversation of its own.

## What you get
- **Voice concierge** in the navigation. **Talk** starts a call from the bb desktop app or a browser: the
  microphone and speaker stay in that window, and audio goes straight to OpenAI's realtime model over WebRTC.
  **Hang up** ends it. **Mute** keeps the call up without listening. A text box lets you type into the call
  instead of speaking.
- Ask "what's running and what needs me?", "what did the league ping thread conclude?", "start a thread that…",
  "tell the night shift to stop". The voice model hands each question to its own Codex agent, which runs the bb
  CLI. The answer is spoken back in a sentence or two, and the live caption and the agent's current command show
  on the page.
- While a call is up, a small pill on every other bb page shows what the concierge is doing, with Mute and Hang up
  (at the top on a phone, bottom right on a desktop). On a touch screen a small mic tab on the right edge starts a
  call from any page; it hides while you type.
- The conversation is the concierge's own bb thread, pinned as "Voice concierge" in your Personal project and shown
  below the sphere on the page. Type there, or anywhere bb shows it, to continue the same conversation by text. It
  never appears in your work threads.
- A sphere above the controls shows the call: a soft, physical ball that breathes while silent. Its surface really
  moves: it ripples with your voice, swells rounder with the concierge's, and rolls slowly while the concierge is
  checking bb. During a call it docks into a compact bar (still alive, with the state, the caption, Mute and Hang
  up) so more of the conversation shows, and grows back when you hang up, tap it, or rest the mouse on it; the
  auto-minimize setting turns that off. Held sideways, a phone shows the sphere and the conversation side by side.
- Pick a visual with the swatches under the sphere and use the sliders button to tune its material.
  See [The sphere](README.md#the-sphere) for the visual styles and tuning behavior.
- The concierge writes into another thread only when you explicitly ask. It first says which thread and what it
  will send, and waits for your yes. It never reads secrets aloud.
- `bb voice-concierge status | login | logout | transcript | thread | ask` from a terminal or an agent.

## What you need
A ChatGPT plan with Codex voice (Plus, Pro, Business, Edu or Enterprise), signed in once from the page
(**Sign in with ChatGPT** shows a device code). The concierge runs Codex on a bb machine resolved from bb: the bb
server's own machine first, else any connected machine where Codex is installed and signed in, or the one you
name in the plugin settings. It works the same with one machine or several. Calls use your plan's usage.

## What it does not do (yet)
- No wake word: you press Talk. A phone is not tested yet.
- The "ask before writing" rule is an instruction to the agent, not an enforced check: bb does not mark which
  agent sent a CLI message, so no hook can tell the concierge's `bb thread tell` from your own.
- Codex's realtime API is experimental; a Codex update can break calls until the plugin follows.
