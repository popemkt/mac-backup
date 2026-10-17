import { Effect } from "effect";
import { z } from "zod";
import { WireNodeSchema, type SecretSource, type UiHostService } from "@kb/contracts";
import { decodeNodeConfig, extensionNodeId, typeRefsOf, type NodeId } from "@kb/model";
import { agentExtension } from "./extension.ts";
import {
  AGENT_ADAPTERS,
  AGENT_IDS,
  DEFAULT_PROVIDER,
  PROVIDER_SLOTS,
  SELECTION_SLOTS,
  type ProviderConfig,
} from "./provider.ts";
import { AgentRuntimeError, type AgentAdapter, type AgentRuntime } from "./runtime.ts";

/**
 * Which provider runs a turn, read when the turn starts (`DESIGN.md` → Agent
 * packages → providers): the agent's own node names one in
 * `sys.f.agent.provider`, a setting written like any field, and the
 * provider's node says which adapter runs it and with what. Nothing
 * re-applies when either changes; the next turn reads them again. With
 * nothing selected, the default adapter runs as it does with no settings,
 * so a store nobody configured behaves as kb always has.
 */

/** The provider chosen for a turn: the runtime to run it on, and how to name it. */
export interface Chosen {
  /** Who minted a resume handle: the provider node and its settings as written, or the default. */
  readonly key: string;
  readonly label: string;
  readonly runtime: AgentRuntime;
  /** Settings that did not read, each read as its default instead. */
  readonly warnings: readonly string[];
}

const NodeReadSchema = z.object({
  node: WireNodeSchema.pick({ id: true, text: true, props: true }),
});

/** A node as `node.get` answers it, or undefined when the store holds none by that id. */
const readNode = Effect.fn("kb.agent.readNode")(function* (host: UiHostService, id: NodeId) {
  const receipt = yield* host.invoke({ id: "node.get", input: { id, depth: 0 } });
  if (receipt.status === "failed") {
    if (receipt.code === "not_found") return undefined;
    return yield* new AgentRuntimeError({ message: `reading ${id} failed: ${receipt.message}` });
  }
  const read = NodeReadSchema.safeParse(receipt.output);
  return read.success ? read.data.node : undefined;
});

const ADAPTER_LABELS: ReadonlyMap<string, string> = new Map(
  AGENT_ADAPTERS.map(({ id, label }) => [id, label]),
);

export const chooseProvider = Effect.fn("kb.agent.chooseProvider")(function* (
  host: UiHostService,
  backends: {
    readonly adapters: ReadonlyMap<string, AgentAdapter>;
    readonly secrets: SecretSource;
    readonly runtimes: Map<string, AgentRuntime>;
  },
): Effect.fn.Return<Chosen, AgentRuntimeError> {
  const warnings: string[] = [];
  const agent = yield* readNode(host, extensionNodeId(agentExtension.name));
  const selected = decodeNodeConfig(SELECTION_SLOTS, agent?.props, (warning) =>
    warnings.push(`The agent's provider setting did not read: ${warning}`),
  )("provider");
  let config: ProviderConfig = DEFAULT_PROVIDER;
  let key = "default";
  let label: string | undefined;
  if (selected !== null) {
    const provider = yield* readNode(host, selected);
    if (provider === undefined) {
      return yield* new AgentRuntimeError({
        message: `The selected provider ${selected} is not in this kb; choose another, or clear the selection.`,
      });
    }
    // Only a provider is read as one: tagging a node as a provider is the
    // owner's to approve, so a node nobody made one never configures a turn.
    if (!typeRefsOf(provider).includes(AGENT_IDS.providerTag)) {
      return yield* new AgentRuntimeError({
        message: `The selected node ${selected} is not an #agent-provider; tag it as one, or choose another.`,
      });
    }
    const read = decodeNodeConfig(PROVIDER_SLOTS, provider.props, (warning) =>
      warnings.push(`${provider.text || selected}: ${warning}`),
    );
    config = {
      adapter: read("adapter"),
      endpoint: read("endpoint"),
      credential: read("credential"),
      executable: read("executable"),
      model: read("model"),
    };
    key = `${selected}\u0000${JSON.stringify(config)}`;
    label = provider.text === "" ? selected : provider.text;
  }
  const adapter = backends.adapters.get(config.adapter);
  if (adapter === undefined) {
    return yield* new AgentRuntimeError({
      message: `This kb ui has no ${ADAPTER_LABELS.get(config.adapter) ?? config.adapter} adapter.`,
    });
  }
  let runtime = backends.runtimes.get(key);
  if (runtime === undefined) {
    runtime = adapter.runtime(config, backends.secrets);
    backends.runtimes.set(key, runtime);
  }
  return { key, label: label ?? runtime.name, runtime, warnings };
});
