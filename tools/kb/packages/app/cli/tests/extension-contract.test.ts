import { Effect } from "effect";
import { agentExtension, agentPlugin, scriptedRuntime } from "@kb/agent";
import { NO_SWITCHES, UiHost, failed, type NodeLookup } from "@kb/contracts";
import { definePlugin, makeKernel } from "@kb/plugin";
import { composeHosted, type HostedExtensions } from "@kb/server";
import { extensionContract, type SwitchingHost } from "@kb/test-kit";

const AGENT = {
  declaration: agentExtension,
  entry: agentPlugin({ runtime: scriptedRuntime(() => []) }),
};

/**
 * The `kb ui` server's composition as the agent's host: one kernel, holding
 * a `UiHost` that answers nothing (the contract never calls through it), and
 * composing the agent as the store it is pointed at switches it.
 */
function uiServerHost(): SwitchingHost {
  const kernel = makeKernel();
  let store: NodeLookup = NO_SWITCHES;
  let hosted: HostedExtensions | null = null;
  const held = definePlugin({
    name: "ui-host",
    namespace: "",
    apply: (plugin) =>
      plugin.provide(UiHost, {
        root: "",
        invoke: (invocation) =>
          Effect.succeed(failed(invocation.id, "unknown_action", "this host answers nothing")),
      }),
  });
  return {
    compose: (nodeOf) =>
      Effect.gen(function* () {
        store = nodeOf;
        hosted ??= yield* composeHosted(
          kernel,
          [AGENT],
          (id) => store(id),
          () => [held],
        );
        const rows = yield* hosted.rows;
        return { row: rows.find(({ name }) => name === agentExtension.name), kernel };
      }),
  };
}

// The agent is composed by `kb ui` rather than bundled; it keeps the same
// extension contract as the families the server bundles, the server's
// composition its host. A scripted runtime stands in for Claude, which the
// contract never reaches.
extensionContract(AGENT.declaration, AGENT.entry, uiServerHost());
