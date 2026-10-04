/**
 * `@kb/agent-ui`: the agent family's browser half (DESIGN.md → Extension
 * families): the agent's chat dock, which talks to the agent a `kb ui`
 * server hosts. The page loads it, as a chunk of its own, only while the
 * server reports that it hosts the agent, and binds it to the page's ports
 * (`agentUiPlugin(ports)`): this package reaches neither the socket nor the
 * invoke path itself.
 *
 * The dock and its chat binding are named too, for `@kb/ui`'s component test,
 * which drives them over stand-in ports against the real shell.
 */
export { agentUiPlugin } from "./plugin";
export { attachChat, useChat, type AgentPorts } from "./chat";
export { AgentDock } from "./surfaces";
