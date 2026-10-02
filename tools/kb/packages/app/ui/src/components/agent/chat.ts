/**
 * The sidebar's side of the agent channel (`@kb/agent` → `protocol.ts`): one
 * conversation at a time, drawn from the transcript `@kb/agent` reduces, and
 * the person's answer to an approval-required call.
 *
 * Approving or declining is a call the tab makes itself, through the
 * browser's one invoke path, with `approved` set to the person's answer;
 * the invoke core decides it, and its receipt is what the agent is told.
 * There is no second way for the sidebar to approve anything.
 *
 * Like the UI's other stores it is one per page. It reaches the channel and
 * the invoke path only through the ports its plugin attaches it to, which
 * the shell binds (`src/agent.ts`).
 */
import { create } from "zustand";
import {
  AgentEventSchema,
  newTranscript,
  withDecision,
  withDisconnect,
  withEvent,
  withSent,
  type AgentRequest,
  type ToolEntry,
  type Transcript,
} from "@kb/agent";
import { failed, type ActionInvocation, type ActionReceipt } from "@kb/contracts";

/** Where the chat reaches the agent and the graph. */
export interface AgentPorts {
  /** Hear the agent channel; returns the unlisten. */
  readonly listen: (sink: {
    readonly data: (data: unknown) => void;
    readonly error: (err: { readonly code: string; readonly message: string }) => void;
  }) => () => void;
  /** Say one request on the agent channel. */
  readonly send: (request: AgentRequest) => void;
  /** Call `listener` whenever the socket opens or closes; returns the unsubscribe. */
  readonly connection: (listener: (open: boolean) => void) => () => void;
  /** Make a call through the browser's one invoke path, and answer the server's receipt. */
  readonly invoke: (invocation: ActionInvocation) => Promise<ActionReceipt>;
  /** A fresh conversation id. */
  readonly newConversation: () => string;
}

interface ChatState {
  readonly transcript: Transcript;
  /** Why the agent cannot be reached right now, or null when it can. */
  readonly unreachable: string | null;
}

const NO_AGENT = "This kb ui hosts no agent. Start it without --no-agent to chat here.";
const OFFLINE = "Not connected to kb. Reconnecting…";

export const useChat = create<ChatState>(() => ({
  transcript: newTranscript("detached"),
  unreachable: null,
}));

let ports: AgentPorts | null = null;

function update(change: (transcript: Transcript) => Transcript): void {
  useChat.setState((state) => ({ transcript: change(state.transcript) }));
}

function conversation(): string {
  return useChat.getState().transcript.conversation;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The person sent `text`. */
export function sendToAgent(text: string): void {
  if (ports === null) return;
  update((transcript) => withSent(transcript, text));
  ports.send({ type: "send", conversation: conversation(), text });
}

/** Stop the running turn. */
export function stopAgent(): void {
  ports?.send({ type: "cancel", conversation: conversation() });
}

/** The person approved or declined the call `call`: their tab makes it, with that answer. */
export function decideCall(call: string, approved: boolean): void {
  const bound = ports;
  const entry = useChat
    .getState()
    .transcript.entries.find((held): held is ToolEntry => held.kind === "tool" && held.id === call);
  if (bound === null || entry?.state !== "awaiting") return;
  update((transcript) => withDecision(transcript, call, approved ? "approved" : "declined"));
  const invocation: ActionInvocation = { id: entry.action, input: entry.input, approved };
  const at = conversation();
  void bound
    .invoke(invocation)
    .catch((error: unknown) => failed(entry.action, "internal", messageOf(error)))
    .then((receipt) => bound.send({ type: "receipt", conversation: at, call, receipt }));
}

/** Start a new conversation; the agent does not remember the last one. */
export function restartChat(): void {
  if (ports === null) return;
  const { transcript } = useChat.getState();
  if (transcript.running) ports.send({ type: "cancel", conversation: transcript.conversation });
  useChat.setState({ transcript: newTranscript(ports.newConversation()) });
}

function receive(data: unknown): void {
  const event = AgentEventSchema.safeParse(data);
  if (event.success) update((transcript) => withEvent(transcript, event.data));
}

/** Hear the channel and the socket through `next`; returns the detach. */
export function attachChat(next: AgentPorts): () => void {
  ports = next;
  useChat.setState({ transcript: newTranscript(next.newConversation()), unreachable: null });
  const unlisten = next.listen({
    data: receive,
    error: (err) => {
      if (err.code === "unknown_channel") useChat.setState({ unreachable: NO_AGENT });
      update((transcript) => ({ ...transcript, running: false }));
    },
  });
  const unwatch = next.connection((open) => {
    if (open) {
      useChat.setState((state) => ({
        unreachable: state.unreachable === OFFLINE ? null : state.unreachable,
      }));
      return;
    }
    update(withDisconnect);
    useChat.setState({ unreachable: OFFLINE });
  });
  return () => {
    unlisten();
    unwatch();
    if (ports === next) ports = null;
  };
}
