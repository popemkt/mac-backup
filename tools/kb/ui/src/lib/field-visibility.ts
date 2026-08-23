import type { NodeMap, OutlineNode, PropValue, ResolvedProp } from "@/lib/types";
import { SYSTEM_IDS } from "@/lib/types";

/**
 * Schema props that live under sys.* but are meant to edit like ordinary
 * fields on tag/field nodes (i10 item 4 — color/hidden on a tag page).
 */
export const SCHEMA_SURFACE_FIELDS = new Set<string>([
  SYSTEM_IDS.colorField,
  SYSTEM_IDS.hiddenField,
]);

/** Prop keys that are system/metadata and hidden from normal field rows. */
export function isIntrinsicSystemPropKey(fieldId: string): boolean {
  if (SCHEMA_SURFACE_FIELDS.has(fieldId)) return false;
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
  /** Template slot with no value yet (still editable). */
  empty?: boolean;
};

function isTagNode(node: OutlineNode): boolean {
  const types = node.props[SYSTEM_IDS.typeField] ?? [];
  return types.some((v) => v.t === "ref" && v.v === SYSTEM_IDS.tag);
}

/** Field ids templated onto every tag node via sys.tag.sys.f.fields. */
function tagTemplateFieldIds(nodes: NodeMap): string[] {
  const meta = nodes.get(SYSTEM_IDS.tag);
  if (!meta) return [...SCHEMA_SURFACE_FIELDS];
  const refs = meta.props[SYSTEM_IDS.fieldsField] ?? [];
  const ids: string[] = [];
  for (const v of refs) {
    if (v.t === "ref" && typeof v.v === "string") ids.push(v.v);
  }
  return ids.length > 0 ? ids : [...SCHEMA_SURFACE_FIELDS];
}

/** Resolve node props for FieldRow display with visibility filtering. */
export function resolveVisibleProps(
  node: OutlineNode,
  nodes: NodeMap,
  opts: ResolvePropsOptions = {},
): VisibleProp[] {
  const showAll = opts.showAllFields ?? false;
  const out: VisibleProp[] = [];
  const seen = new Set<string>();

  for (const [fieldId, values] of Object.entries(node.props)) {
    if (fieldId === SYSTEM_IDS.typeField && !showAll) continue;

    const hiddenByDefault = isPropHiddenByDefault(fieldId, nodes);
    if (!showAll && hiddenByDefault) continue;

    const fieldNode = nodes.get(fieldId);
    seen.add(fieldId);
    out.push({
      fieldId,
      fieldName: fieldNode?.text ?? fieldId,
      values,
      debug: showAll && hiddenByDefault,
    });
  }

  // Tag nodes: surface template fields (color, hidden, …) even when unset so
  // the node page is the configurator — no bespoke panel.
  if (isTagNode(node)) {
    for (const fieldId of tagTemplateFieldIds(nodes)) {
      if (seen.has(fieldId)) continue;
      if (!showAll && isPropHiddenByDefault(fieldId, nodes)) continue;
      const fieldNode = nodes.get(fieldId);
      out.push({
        fieldId,
        fieldName: fieldNode?.text ?? fieldId,
        values: [] as PropValue[],
        empty: true,
      });
      seen.add(fieldId);
    }
  }

  return out;
}
