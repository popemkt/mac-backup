import { Effect } from "effect";
import { ChatCircleDotsIcon } from "@phosphor-icons/react";
import { agentExtension } from "@kb/agent";
import { definePlugin, type Plugin } from "@kb/plugin";
import { attachChat, type AgentPorts } from "@/components/agent/chat";
import { AgentDock } from "@/components/agent/surfaces";
import { BrowserHostService, DockPoint } from "@/sdk";

/**
 * The agent sidebar: a dock that chats with the agent the `kb ui` server
 * hosts (`@kb/agent`). Optional and off by default, like the lab: it is in
 * `OPTIONAL_UI_PLUGINS`, so its dock and its toggle exist only while the
 * preference has it on. The shell hands it its ports (`src/agent.ts`), so
 * this folder reaches neither the socket nor the invoke path itself.
 */
export function agentUiPlugin(ports: AgentPorts): Plugin {
  return definePlugin({
    name: agentExtension.name,
    inject: [BrowserHostService],
    apply: (ctx) =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => attachChat(ports)),
          (detach) => Effect.sync(detach),
        );
        yield* ctx.contribute(DockPoint, {
          id: "chat",
          value: { order: 0, label: "Agent", icon: ChatCircleDotsIcon, Component: AgentDock },
        });
      }),
  });
}
