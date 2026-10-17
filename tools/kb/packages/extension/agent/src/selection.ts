import { Effect } from "effect";
import { z } from "zod";
import { SecretError, WireNodeSchema, type SecretSource, type UiHostService } from "@kb/contracts";
import {
  canonicalJson,
  decodeNodeConfig,
  extensionNodeId,
  parseSecretRef,
  secretRefLabel,
  typeRefsOf,
  type NodeId,
} from "@kb/model";
import { providerDigest, type ProviderBinding } from "@kb/sandbox";
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
 *
 * A provider that binds anything (a key, the endpoint it is sent to, an
 * executable it starts) runs only once a person has trusted that binding
 * on this machine, by its digest (`providerDigest`), in the one trust code
 * is trusted in: a provider node is data, and a root someone else wrote can
 * carry one. Its adapter then resolves that one key and no other.
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

const TrustedSchema = z.object({ trusted: z.array(z.string()) });

/** What a provider binds, or null when it binds nothing: the adapter as it runs with no settings. */
function bindingOf(config: ProviderConfig): ProviderBinding | null {
  const { adapter, endpoint, credential, executable } = config;
  if (endpoint === null && credential === null && executable === null) return null;
  return { adapter, endpoint, credential, executable };
}

/** A binding as the person checks it: the key, where it goes, and what starts. */
function bindingText({ endpoint, credential, executable }: ProviderBinding): string {
  const ref = credential === null ? null : parseSecretRef(credential);
  const key = ref === null ? (credential ?? "no key") : secretRefLabel(ref);
  const sends = `sends ${key} to ${endpoint ?? "its adapter's own endpoint"}`;
  return executable === null ? sends : `${sends}, and runs ${executable}`;
}

/** Fails the turn unless a person trusted `binding` on this machine. */
const requireTrusted = Effect.fn("kb.agent.requireTrusted")(function* (
  host: UiHostService,
  binding: ProviderBinding,
  name: string,
): Effect.fn.Return<void, AgentRuntimeError> {
  const digest = yield* providerDigest(binding);
  const receipt = yield* host.invoke({ id: "sandbox.trusted", input: { digests: [digest] } });
  const read = receipt.status === "succeeded" ? TrustedSchema.safeParse(receipt.output) : null;
  const trusted = read?.success === true && read.data.trusted.includes(digest);
  return yield* trusted
    ? Effect.void
    : Effect.fail(
        new AgentRuntimeError({
          message:
            `${name} ${bindingText(binding)}: not trusted on this machine (${digest}). ` +
            "Trust it with sandbox.trust once you have checked them.",
        }),
      );
});

/** `secrets`, resolving only the key `credential` names. */
function boundTo(credential: string | null, secrets: SecretSource): SecretSource {
  const bound = credential === null ? null : parseSecretRef(credential);
  return {
    resolve: (ref) =>
      bound !== null && canonicalJson(ref) === canonicalJson(bound)
        ? secrets.resolve(ref)
        : Effect.fail(
            new SecretError({
              message: `${secretRefLabel(ref)}: not the key this provider is trusted to send`,
            }),
          ),
  };
}

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
  const binding = bindingOf(config);
  if (binding !== null) yield* requireTrusted(host, binding, label ?? "The provider");
  let runtime = backends.runtimes.get(key);
  if (runtime === undefined) {
    runtime = adapter.runtime(config, boundTo(config.credential, backends.secrets));
    backends.runtimes.set(key, runtime);
  }
  return { key, label: label ?? runtime.name, runtime, warnings };
});
