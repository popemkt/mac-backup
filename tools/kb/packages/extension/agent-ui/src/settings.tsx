import { AGENT_IDS, agentExtension } from "@kb/agent";
import { extensionNodeId } from "@kb/model";
import type { ComponentType } from "react";
import {
  useFieldEditor,
  useGraphRead,
  type FieldEditorProps,
  type GraphRead,
  type PropValue,
} from "@kb/ui-sdk";

/**
 * Which model the agent talks to, under the dock's header (`DESIGN.md` →
 * Agent packages → providers): the agent's own node's `provider` setting and
 * the selected provider's `model`, each drawn with the page's field editor,
 * as any field is drawn anywhere. Choosing is writing a field; the next
 * turn reads it. There is no settings widget of the agent's own: a provider
 * is an `#agent-provider` node, made and edited like any node.
 */

const AGENT_NODE = extensionNodeId(agentExtension.name);
const NONE: PropValue[] = [];

/** The provider node the selection names, while the graph holds it. */
function selectedProvider(graph: GraphRead, values: readonly PropValue[]) {
  const chosen = values.find((value) => value.t === "ref");
  return chosen === undefined ? undefined : graph.outline.get(chosen.v);
}

/** A field's name, as its node says. */
function nameOf(graph: GraphRead, fieldId: string): string {
  return graph.outline.get(fieldId)?.text ?? fieldId;
}

export function AgentSettings() {
  return <SettingsRows Field={useFieldEditor()} />;
}

/** The rows, drawn with `Field`: the editor the page provides now. */
function SettingsRows({ Field }: { readonly Field: ComponentType<FieldEditorProps> }) {
  const graph = useGraphRead();
  const agent = graph.outline.get(AGENT_NODE);
  if (agent === undefined) return null;
  const selection = agent.props[AGENT_IDS.providerField] ?? NONE;
  const provider = selectedProvider(graph, selection);
  return (
    <section
      aria-label="Agent settings"
      className="shrink-0 border-b border-foreground/[0.06] px-2 py-1"
    >
      <Field
        nodeId={AGENT_NODE}
        fieldId={AGENT_IDS.providerField}
        label={nameOf(graph, AGENT_IDS.providerField)}
        values={selection}
        context={graph}
        depth={-1}
      />
      {provider === undefined ? null : (
        <Field
          nodeId={provider.id}
          fieldId={AGENT_IDS.modelField}
          label={nameOf(graph, AGENT_IDS.modelField)}
          values={provider.props[AGENT_IDS.modelField] ?? NONE}
          context={graph}
          depth={-1}
        />
      )}
    </section>
  );
}
