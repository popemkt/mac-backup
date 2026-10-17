import { Schema } from "effect";
import {
  SYSTEM_IDS,
  extensionNodeId,
  firstRef,
  firstStr,
  oneOf,
  seededField,
  seededTag,
  writeRef,
  writeStr,
  type ConfigSlots,
  type KbNode,
  type NodeId,
} from "@kb/model";

/**
 * Which model the sidebar agent talks to, as nodes (`DESIGN.md` → Agent
 * packages → providers): an `#agent-provider` node per endpoint a person
 * configured, and the selection, one setting on the agent's own node. Ids
 * are frozen data. Adapters are code; a provider names one by its option.
 */
export const AGENT_IDS = {
  /** The kind of a provider node. */
  providerTag: "sys.tag.agent-provider",
  /** Which adapter runs the provider: one of this field's own children (ref, one). */
  adapterField: "sys.f.agent.adapter",
  /** Where the adapter reaches its model (url, one); absent is the adapter's default. */
  endpointField: "sys.f.agent.endpoint",
  /** Where the key lives (secret, one): a reference, never the key. */
  credentialField: "sys.f.agent.credential",
  /** The binary the adapter runs (text, one), for an adapter that runs one. */
  executableField: "sys.f.agent.executable",
  /** The model id, in the provider's own vocabulary (text, one). */
  modelField: "sys.f.agent.model",
  /** On the agent's node: the provider the sidebar uses (ref, one); absent is the default. */
  providerField: "sys.f.agent.provider",
} as const;

/** An adapter as data: its frozen id, the option node that names it, and how it reads. */
export interface AdapterOption {
  readonly id: string;
  readonly label: string;
}

/**
 * Every adapter a provider may name, in the order a picker lists them. The
 * host's composition implements each one, which its own test holds it to;
 * a provider naming one a host lacks fails its turn, saying which.
 */
export const AGENT_ADAPTERS = [
  { id: "claude-agent-sdk", label: "Claude Agent SDK" },
  { id: "openai-chat", label: "OpenAI-compatible chat" },
] as const satisfies readonly AdapterOption[];

/** An adapter's frozen id: what a provider's adapter option names, and what an adapter implements. */
export type AdapterId = (typeof AGENT_ADAPTERS)[number]["id"];

/** The adapter a store with no selection, or a provider naming none, runs: today's local Claude. */
export const DEFAULT_ADAPTER = AGENT_ADAPTERS[0].id;

/** The option node that names `adapter` under `sys.f.agent.adapter`. */
export function adapterOptionId(adapter: string): NodeId {
  return `sys.agent.adapter.${adapter}`;
}

const ADAPTER_BY_OPTION: ReadonlyMap<NodeId, string> = new Map(
  AGENT_ADAPTERS.map(({ id }) => [adapterOptionId(id), id]),
);

/** `node`, declared to configure the agent (`sys.f.configures`). */
function configuring(node: KbNode): KbNode {
  return {
    ...node,
    props: {
      ...node.props,
      [SYSTEM_IDS.configuresField]: [{ t: "ref", v: extensionNodeId("agent") }],
    },
  };
}

/** The agent family's seed: the provider kind, its fields, the adapter options, and the selection. */
export function agentSeedNodes(at: string): readonly KbNode[] {
  const options = AGENT_ADAPTERS.map(
    ({ id, label }): KbNode => ({
      id: adapterOptionId(id),
      text: label,
      props: {},
      children: [],
      createdAt: at,
      updatedAt: at,
    }),
  );
  const one = { one: true };
  // Every field a provider is read from configures the agent, wherever it is
  // written: what the adapter runs, where, and with which key.
  return [
    configuring({
      ...seededField(AGENT_IDS.adapterField, "adapter", "ref", at, one),
      children: options.map((option) => option.id),
    }),
    ...options,
    configuring(seededField(AGENT_IDS.endpointField, "endpoint", "url", at, one)),
    configuring(seededField(AGENT_IDS.credentialField, "credential", "secret", at, one)),
    configuring(seededField(AGENT_IDS.executableField, "executable", "text", at, one)),
    configuring(seededField(AGENT_IDS.modelField, "model", "text", at, one)),
    // A provider is the agent's configuration: what it runs, where, with which key.
    configuring(
      seededTag(
        AGENT_IDS.providerTag,
        "agent-provider",
        [
          AGENT_IDS.adapterField,
          AGENT_IDS.endpointField,
          AGENT_IDS.credentialField,
          AGENT_IDS.executableField,
          AGENT_IDS.modelField,
        ],
        at,
      ),
    ),
    // A setting of the agent's own node: written like any field, read per turn.
    seededField(AGENT_IDS.providerField, "provider", "ref", at, {
      one: true,
      props: {
        [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: AGENT_IDS.providerTag }],
        [SYSTEM_IDS.configuresField]: [{ t: "ref", v: extensionNodeId("agent") }],
      },
    }),
  ];
}

/** A provider node, decoded: what an adapter is handed to run one. */
export interface ProviderConfig {
  readonly adapter: string;
  readonly endpoint: string | null;
  /** A secret reference (`env:…`, `keychain:…`), resolved only when a turn runs. */
  readonly credential: string | null;
  readonly executable: string | null;
  readonly model: string | null;
}

/** What a provider with nothing written is: the default adapter, as it runs with no settings. */
export const DEFAULT_PROVIDER: ProviderConfig = {
  adapter: DEFAULT_ADAPTER,
  endpoint: null,
  credential: null,
  executable: null,
  model: null,
};

/** A text setting read as one value; an empty one is unset. */
function textSlot(field: NodeId) {
  return oneOf<string | null>({
    fields: [field],
    read: (props) => {
      const text = firstStr(field)(props);
      return text === "" ? null : text;
    },
    write: (value) => (value === null ? { [field]: [] } : writeStr(field)(value)),
    schema: Schema.NullOr(Schema.String),
    fallback: null,
  });
}

/** How a provider node's props read as a {@link ProviderConfig}. */
export const PROVIDER_SLOTS: ConfigSlots<ProviderConfig> = {
  adapter: oneOf({
    fields: [AGENT_IDS.adapterField],
    read: (props) => {
      const option = firstRef(AGENT_IDS.adapterField)(props);
      return option === undefined ? undefined : ADAPTER_BY_OPTION.get(option);
    },
    write: (adapter) => writeRef(AGENT_IDS.adapterField)(adapterOptionId(adapter)),
    schema: Schema.String,
    fallback: DEFAULT_ADAPTER,
  }),
  endpoint: textSlot(AGENT_IDS.endpointField),
  credential: textSlot(AGENT_IDS.credentialField),
  executable: textSlot(AGENT_IDS.executableField),
  model: textSlot(AGENT_IDS.modelField),
};

/** How the agent's own node reads: which provider the sidebar uses. */
export const SELECTION_SLOTS: ConfigSlots<{ provider: NodeId | null }> = {
  provider: oneOf({
    fields: [AGENT_IDS.providerField],
    read: firstRef(AGENT_IDS.providerField),
    write: writeRef(AGENT_IDS.providerField),
    schema: Schema.NullOr(Schema.String),
    fallback: null,
  }),
};
