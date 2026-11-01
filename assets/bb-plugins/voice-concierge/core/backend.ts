// The voice-backend seam. Everything outside core/<backend>.ts (server RPC, CLI, UI, transcript store) speaks only
// this contract, so a second backend (OpenAI Realtime API with a key, local STT/TTS, …) is one new implementation
// plus one entry in `backends` in server.ts. Codex (codex.ts) is the first.
import type { VoiceEvent } from "../contract.ts";

export type { VoiceEvent };

/**
 * How the client's audio reaches the backend. WebRTC (the client holds the microphone and speaker and the backend
 * answers its SDP offer) is the only kind today; a push-to-talk backend would add e.g. `{ kind: "chunks" }`.
 */
export type ClientOffer = { kind: "webrtc"; sdp: string };
export type ClientAnswer = { kind: "webrtc"; sdp: string };

export interface BackendStatus {
  ready: boolean;
  /** The backend can be made ready by signing in (`login`). */
  needsLogin: boolean;
  /** Where the backend runs, for display ("shared-server"), or null when nowhere fits. */
  where: string | null;
  /** The signed-in account, for display. */
  account: string | null;
  /** One line for people: "ready", or what is missing. */
  message: string;
  /** Backend-specific facts for `bb voice-concierge status`. */
  details: Record<string, string | null>;
}

export interface LoginChallenge {
  url: string;
  code: string;
}

export interface StartOptions {
  offer: ClientOffer;
  /** A voice name the backend lists, or null for its default. */
  voice: string | null;
  /** The person's extra instructions (plugin setting), appended to the persona. */
  extra: string;
  /** Relay to the concierge's own bb thread instead of working directly (core/concierge-thread.ts). */
  relay: boolean;
}

export interface VoiceSession {
  /** Stable per conversation: the same id across calls continues the same conversation. */
  conversationId: string;
  answer: ClientAnswer;
}

export interface VoiceBackend {
  readonly id: string;
  readonly label: string;
  status(): Promise<BackendStatus>;
  /** Present when the backend signs in interactively (device code). */
  login?(): Promise<LoginChallenge>;
  logout?(): Promise<void>;
  start(options: StartOptions): Promise<VoiceSession>;
  /** Typed input into the live conversation (for quiet places, and for tests). */
  sendText(conversationId: string, text: string): Promise<void>;
  stop(conversationId: string): Promise<void>;
  /** Events from every session of this backend; returns the unsubscribe. */
  onEvent(listener: (conversationId: string | null, event: VoiceEvent) => void): () => void;
}
