// The words the page shows: what the concierge is doing, and errors said the way a person would want to hear them.

export type Look = "idle" | "connecting" | "listening" | "thinking" | "speaking";

export interface LabelInputs {
  look: Look;
  phase: "idle" | "connecting" | "live" | "ending";
  muted: boolean;
  /** Voice is set up and a call can start. */
  ready: boolean;
  /** The status check has not answered yet. */
  checking: boolean;
  /** Voice needs a ChatGPT sign-in first. */
  needsLogin?: boolean;
}

/** The one-line state under (or beside) the sphere. */
export function stateLabel(s: LabelInputs): string {
  if (s.phase === "ending") return "Ending…";
  if (s.phase === "connecting") return "Connecting…";
  if (s.phase === "live") {
    if (s.look === "thinking") return "Looking that up…";
    if (s.look === "speaking") return "Speaking";
    return s.muted ? "Muted" : "Listening";
  }
  if (s.checking) return "Getting ready…";
  return s.ready ? "Ready when you are" : s.needsLogin ? "Sign in to talk" : "Not ready yet";
}

/** The second line in the docked call bar when nobody is speaking. */
export function barHint(s: LabelInputs): string {
  if (s.phase === "connecting") return "Setting up the call";
  if (s.phase === "ending") return "Hanging up";
  if (s.muted) return "You're muted";
  if (s.look === "thinking") return "One moment";
  return "Go ahead";
}

/** The hint under the label while idle: how to start. */
export function idleHint(touch: boolean, mac: boolean): string {
  return touch ? "Tap Talk to start" : `Click Talk, or press ${mac ? "⌘⇧M" : "Ctrl+Shift+M"} anywhere in bb`;
}

const ERRORS: [RegExp, string][] = [
  [
    /NotAllowedError|Permission denied|permission/i,
    "The microphone is blocked. Turn it on for bb in your browser's site settings (the icon left of the address), then try again.",
  ],
  [/NotFoundError|Requested device not found|no microphone/i, "No microphone was found. Connect one, then try again."],
  [/NotReadableError|Could not start audio source/i, "The microphone is busy in another app. Close it there, then try again."],
  [/cannot use the microphone|https or localhost/i, "Voice needs a secure page: open bb over https, or on localhost."],
  [/voice connection failed|ICE|DTLS/i, "The voice connection dropped. Check the network, then try again."],
  [/signed out|sign in|not logged in|unauthori[sz]ed|401/i, "Sign in with ChatGPT to talk."],
  [/did not answer the voice call in time|timed? ?out/i, "The voice service took too long to answer. Try again in a moment."],
  [/No machine|no connected machine|offline/i, "The machine that runs voice is offline. Check it's connected to bb."],
  [/rate limit|429|quota|usage limit/i, "The ChatGPT plan's voice limit is reached for now. Try again later."],
];

/** An error as the page says it; an unknown one gets a plain sentence and keeps its own text as details. */
export function friendlyError(raw: string): { text: string; details: string | null } {
  for (const [pattern, text] of ERRORS) if (pattern.test(raw)) return { text, details: null };
  return { text: "Something went wrong with the call. Try again.", details: raw };
}

/** Questions the empty conversation offers, sent as typed messages. */
export const SUGGESTIONS = ["What needs my attention?", "What's running right now?", "Summarize what I worked on today"] as const;
