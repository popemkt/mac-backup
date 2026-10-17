/**
 * The outline's own node-palette steps, contributed through
 * `PaletteStepPoint` as any family's are: add a tag, add a field, turn a row
 * into a reference. They are the same gesture over different node kinds, and
 * the same gesture as every other node picker (lib/picker): only the
 * candidate source, whether a new one may be minted, and the write vary. A
 * reference draws its candidates from `nodeCandidates`, the source the `[[`
 * autocomplete and the field picker share.
 */
import { HashIcon, LinkSimpleIcon, TextTIcon } from "@phosphor-icons/react";
import type { WireNode } from "@kb/contracts";
import type { ContributionEntry } from "@kb/plugin";
import {
  browserHost,
  emptyValueForType,
  nodeCandidates,
  type PaletteStep,
  type PickerCandidate,
  resolveFieldTypeById,
  SYSTEM_IDS,
} from "@kb/ui-sdk";

/** Nodes whose kind slot points at `kind`, by name. */
function nodesOfKind(wireNodes: readonly WireNode[], kind: string): PickerCandidate[] {
  return wireNodes
    .filter((n) => (n.props[SYSTEM_IDS.typeField] ?? []).some((v) => v.t === "ref" && v.v === kind))
    .map((n) => ({ id: n.id, label: n.text || n.id }))
    .toSorted((a, b) => a.label.localeCompare(b.label));
}

const addTag: PaletteStep = {
  label: "Add tag",
  placeholder: "Search or name a tag...",
  icon: <HashIcon size={12} weight="bold" />,
  createLabel: (name) => `Create tag "${name}"`,
  candidates: (graph) => nodesOfKind(graph.wireNodes, SYSTEM_IDS.tag),
  commit: async ({ targetNodeId, pickedId, creating, name }) => {
    const tagId = creating ? await browserHost().writes.defineTag(name) : pickedId;
    if (tagId !== null) await browserHost().writes.addTag(targetNodeId, tagId);
  },
};

const addField: PaletteStep = {
  label: "Add field",
  placeholder: "Search or name a field...",
  icon: <TextTIcon size={12} weight="bold" />,
  createLabel: (name) => `Create field "${name}"`,
  candidates: (graph) => nodesOfKind(graph.wireNodes, SYSTEM_IDS.field),
  commit: async ({ targetNodeId, schema, pickedId, creating, name }) => {
    const fieldId = creating ? await browserHost().writes.defineField(name) : pickedId;
    if (fieldId === null) return;
    // An empty typed value is what makes the row appear and focusable; the
    // field's own declared type decides which editor that row gets.
    await browserHost().writes.updateProp(
      targetNodeId,
      fieldId,
      emptyValueForType(resolveFieldTypeById(fieldId, schema)),
    );
  },
};

const addRef: PaletteStep = {
  label: "Reference a node",
  placeholder: "Search for a node to reference...",
  icon: <LinkSimpleIcon size={12} weight="bold" />,
  // A reference to itself is not a reference.
  candidates: (graph) => nodeCandidates(graph.nodes, { exclude: (id) => id === graph.anchorId }),
  limit: 12,
  commit: async ({ targetNodeId, pickedId }) => {
    // The whole creation gesture, and nothing but existing primitives: point
    // the target field at the picked node. The field is the kind.
    await browserHost().writes.updateProp(targetNodeId, SYSTEM_IDS.refTargetField, {
      t: "ref",
      v: pickedId,
    });
  },
};

/**
 * The outline's steps. Each is opened by its id in the outline's namespace,
 * `outline.add-tag` and so on, as any contribution is named.
 */
export const OUTLINE_STEPS: readonly ContributionEntry<PaletteStep>[] = [
  { id: "add-tag", value: addTag },
  { id: "add-field", value: addField },
  { id: "add-ref", value: addRef },
];
