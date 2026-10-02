/**
 * The agent sidebar (`components/agent`), bound to this page: the live
 * socket's `agent.chat` channel, the socket's state, and the browser's one
 * invoke path, through which the person's approve or decline is made.
 */
import { ulid } from "ulid";
import { AGENT_CHANNEL } from "@kb/agent";
import { getLiveClient } from "@/api/live";
import { agentUiPlugin } from "@/components/agent/plugin";
import { invokeSettled } from "@/session/runtime";
import { useUiStore } from "@/stores/ui.store";

export const agentPlugin = agentUiPlugin({
  listen: (sink) => getLiveClient().listen(AGENT_CHANNEL, sink),
  send: (request) => getLiveClient().sendChannel(AGENT_CHANNEL, request),
  connection: (listener) =>
    useUiStore.subscribe((next, previous) => {
      if (next.wsStatus === previous.wsStatus) return;
      if (next.wsStatus === "open") listener(true);
      else if (previous.wsStatus === "open") listener(false);
    }),
  // A local write answers at once and is pushed after; the agent is told
  // what the server made of the call, never the optimistic first answer.
  invoke: async (invocation) => (await invokeSettled(invocation)).settled,
  newConversation: () => ulid(),
});
