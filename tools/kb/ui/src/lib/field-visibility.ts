import type { NodeMap, OutlineNode, ResolvedProp } from "@/lib/types";
import { SYSTEM_IDS } from "@/lib/types";

/** Prop keys that are system/metadata and hidden from normal field rows. */
export function isIntrinsicSystemPropKey(fieldId: string): boolean {
  return fieldId.startsWith("sys.");
}

/** True when the field definition node carries sys.f.hidden = true. */
export function isFieldNodeHidden(fieldId: string, nodes: NodeMap): boolean {
  const fieldNode = nodes.get(fieldId);
  if (!fieldNode) return false;
  const hidden = fieldNode.props[SYSTEM_IDS.hiddenField]?.[0];
  return hidden?.t === "bool" && hidden.v === true;
}

export function isPropHiddenByDefault(
  fieldId: string,
  nodes: NodeMap,
): boolean {
  return (
    isIntrinsicSystemPropKey(fieldId) || isFieldNodeHidden(fieldId, nodes)
  );
}

export interface ResolvePropsOptions {
  /** Debug mode: reveal sys.* + hidden fields with muted styling. */
  showAllFields?: boolean;
}

export type VisibleProp = ResolvedProp & {
  /** Muted debug row (sys.* or user-hidden field). */
  debug?: boolean;
};

/** Resolve node props for FieldRow display with visibility filtering. */
export function resolveVisibleProps(
  node: OutlineNode,
  nodes: NodeMap,
  opts: ResolvePropsOptions = {},
): VisibleProp[] {
  const showAll = opts.showAllFields ?? false;
  const out: VisibleProp[] = [];

  for (const [fieldId, values] of Object.entries(node.props)) {
    if (fieldId === SYSTEM_IDS.typeField && !showAll) continue;

    const hiddenByDefault = isPropHiddenByDefault(fieldId, nodes);
    if (!showAll && hiddenByDefault) continue;

    const fieldNode = nodes.get(fieldId);
    out.push({
      fieldId,
      fieldName: fieldNode?.text ?? fieldId,
      values,
      debug: showAll && hiddenByDefault,
    });
  }

  return out;
}
