import { z } from "zod";
import { ActionReceiptSchema, type SurfaceWire } from "@kb/contracts";

/**
 * The agent's channel: what the sidebar and the bridge say to each other,
 * as `data` of the `/ws` plugin channel `agent.chat` (`@kb/contracts` →
 * `channel.ts`). A conversation is named by the sidebar, belongs to the
 * connection that started it, and lives in the bridge's memory until that
 * connection closes. Nothing here reaches the store.
 */

/** The plugin's name and its channel's id; the kernel joins them into the channel the UI opens. */
export const AGENT_PLUGIN = "agent";
export const AGENT_CHANNEL_ID = "chat";
export const AGENT_CHANNEL = `${AGENT_PLUGIN}.${AGENT_CHANNEL_ID}`;

/**
 * The agent's wire: a tool call reaches a person before it runs wherever the
 * call needs approval, so it carries approval, and the agent lists every
 * action that is not denied to it (`listedOn`). Every call on it is the
 * agent's, the one the person approves included.
 */
export const AGENT_WIRE: SurfaceWire = { carriesApproval: true, actor: "agent" };

const conversation = z.string().min(1);

/** Sidebar → bridge. */
export const AgentRequestSchema = z.discriminatedUnion("type", [
  /** Start a turn of `conversation` with the person's `text`; the bridge attaches the tab's screen. */
  z.object({ type: z.literal("send"), conversation, text: z.string().min(1) }),
  /** Stop the running turn, a tool call waiting for the person included. */
  z.object({ type: z.literal("cancel"), conversation }),
  /**
   * The person's answer to the approval-required call `call`: the receipt of
   * the call as the tab made it through its own invoke path, approved or
   * not. The invoke core decided it, not the sidebar.
   */
  z.object({
    type: z.literal("receipt"),
    conversation,
    call: z.string().min(1),
    receipt: ActionReceiptSchema,
  }),
]);
export type AgentRequest = z.infer<typeof AgentRequestSchema>;

/** Bridge → sidebar. */
export const AgentEventSchema = z.discriminatedUnion("type", [
  /** More of the agent's reply. */
  z.object({ type: z.literal("text"), conversation, delta: z.string() }),
  /**
   * The agent called an action. With `approval`, the call waits for the
   * person: the sidebar asks, makes the call, and answers with its receipt.
   */
  z.object({
    type: z.literal("tool-call"),
    conversation,
    call: z.string(),
    action: z.string(),
    title: z.string(),
    input: z.unknown(),
    approval: z.boolean(),
  }),
  /** What the call answered. */
  z.object({
    type: z.literal("tool-result"),
    conversation,
    call: z.string(),
    receipt: ActionReceiptSchema,
  }),
  /** The turn is over: it finished, was cancelled, or failed and says why. */
  z.object({
    type: z.literal("turn-end"),
    conversation,
    outcome: z.enum(["done", "cancelled", "failed"]),
    message: z.string().optional(),
  }),
  /** A request the bridge did not take, and why. */
  z.object({ type: z.literal("refused"), conversation: z.string().optional(), reason: z.string() }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;
