import { agentExtension, agentPlugin, scriptedRuntime } from "@kb/agent";
import { extensionContract } from "@kb/test-kit";

// The agent is a host plugin, composed by `kb ui` rather than bundled; it
// keeps the same extension contract as the families the server bundles. A
// scripted runtime stands in for Claude, which the contract never reaches.
extensionContract(agentExtension, agentPlugin({ runtime: scriptedRuntime(() => []) }));
