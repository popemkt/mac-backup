/**
 * Typing a reference where it is read (DESIGN-UI.md → Graph → Typing a
 * reference in place): with the family's setting `graph.suggest-relations`
 * on, a row that mentions a node offers "Type this reference…" in its node
 * menu, and the step it opens lists each relation the row's mentions can be
 * typed as, a field and a mentioned node, by the one rule every relation
 * write reads (`relationFieldsFor`, `@kb/model`). Picking one types the
 * relation through `graph.relation.type` as the person's own gesture; the
 * text, mention and all, stays as it was.
 */
import { LinkIcon } from "@phosphor-icons/react";
import type { WireNode } from "@kb/contracts";
import { graphExtension, hopLabelsOf, suggestsRelations } from "@kb/graph";
import { extensionNodeId, extractMentions, relationFieldsFor } from "@kb/model";
import type { ContributionEntry } from "@kb/plugin";
import {
  browserHost,
  runQuery,
  toast,
  type Command,
  type PaletteStep,
  type PickerCandidate,
} from "@kb/ui-sdk";

/** The step's id in the graph's namespace, which the node command opens. */
const STEP = "type-reference";
const STEP_ID = `${graphExtension.name}.${STEP}`;

/** A candidate's id carries the field and the target; no node id holds a NUL. */
const SEPARATOR = "\u0000";

/** The host index's EDN runner, which a field's declared target query runs on. */
function hostQuery(): ((edn: string) => unknown[][]) | null {
  const index = browserHost().index();
  return index === null ? null : (edn) => runQuery(index, edn);
}

/**
 * Each relation `sourceId`'s mentions can be typed as and are not yet: a
 * field and a node its text mentions, worded "field → node".
 */
function referenceTypings(
  wireNodes: readonly WireNode[],
  sourceId: string,
  query: ((edn: string) => unknown[][]) | null,
): PickerCandidate[] {
  const nodes = new Map(wireNodes.map((node) => [node.id, node]));
  const source = nodes.get(sourceId);
  if (source === undefined) return [];
  const labels = hopLabelsOf(wireNodes);
  const targets = [...new Set(extractMentions(source.text))].filter(
    (target) => target !== sourceId && nodes.has(target),
  );
  return targets.flatMap((target) =>
    relationFieldsFor(nodes, target, query)
      .filter(
        (field) => !(source.props[field.id] ?? []).some((v) => v.t === "ref" && v.v === target),
      )
      .map((field) => ({
        id: `${field.id}${SEPARATOR}${target}`,
        label: `${labels.textOf(field.id)} → ${labels.textOf(target)}`,
      })),
  );
}

const typeReferenceStep: PaletteStep = {
  label: "Type this reference",
  placeholder: "What does this reference mean?",
  icon: <LinkIcon size={12} weight="bold" />,
  candidates: (graph) =>
    graph.anchorId === null ? [] : referenceTypings(graph.wireNodes, graph.anchorId, hostQuery()),
  commit: async ({ targetNodeId, pickedId }) => {
    const [field, target] = pickedId.split(SEPARATOR);
    if (field === undefined || target === undefined) return;
    const receipt = await browserHost().invoke("graph.relation.type", {
      source: targetNodeId,
      target,
      field,
    });
    if (receipt.status === "failed") toast(receipt.message);
  },
};

/** The node command that opens the step, on a row with a reference left to type. */
const typeReferenceCommand: Command = {
  id: STEP_ID,
  scope: "node",
  chrome: () => ({ label: "Type this reference…", icon: <LinkIcon size={14} weight="bold" /> }),
  when: (ctx) => {
    const { wireNodes } = ctx.outline;
    const nodeId = ctx.target.nodeId;
    if (nodeId === null) return false;
    if (!suggestsRelations(wireNodes.find((node) => node.id === extensionNodeId("graph")))) {
      return false;
    }
    return referenceTypings(wireNodes, nodeId, hostQuery()).length > 0;
  },
  run: (ctx) => ctx.palette.openStep(STEP_ID),
};

export const TYPE_REFERENCE_STEP: ContributionEntry<PaletteStep> = {
  id: STEP,
  value: typeReferenceStep,
};
export const TYPE_REFERENCE_COMMAND: ContributionEntry<Command> = {
  id: typeReferenceCommand.id,
  value: typeReferenceCommand,
};
