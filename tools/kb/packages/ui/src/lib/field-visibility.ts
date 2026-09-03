import type { NodeMap, OutlineNode, PropValue, ResolvedProp } from "@/lib/types";
import { SYSTEM_IDS, isSysPrefixed } from "@/lib/types";

/**
 * Schema props that live under sys.* but are meant to edit like ordinary
 * fields on tag/field nodes (i10 item 4 — color/hidden on a tag page).
 *
 * The field-configuration trio is here for the same reason: a field node's type
 * and ref constraints are the field's own settings, and editing them on the
 * field's page is what removes the need for a configurator panel built only
 * for them.
 */
export const SCHEMA_SURFACE_FIELDS = new Set<string>([
  SYSTEM_IDS.colorField,
  SYSTEM_IDS.hiddenField,
  SYSTEM_IDS.fieldTypeField,
  SYSTEM_IDS.targetTagField,
  SYSTEM_IDS.targetQueryField,
]);

/** Prop keys that are system/metadata and hidden from normal field rows. */
export function isIntrinsicSystemPropKey(fieldId: string): boolean {
  if (SCHEMA_SURFACE_FIELDS.has(fieldId)) return false;
  return isSysPrefixed(fieldId);
}

/** True when the field definition node carries sys.f.hidden = true. */
export function isFieldNodeHidden(fieldId: string, nodes: NodeMap): boolean {
  const fieldNode = nodes.get(fieldId);
  if (!fieldNode) return false;
  const hidden = fieldNode.props[SYSTEM_IDS.hiddenField]?.[0];
  return hidden?.t === "bool" && hidden.v;
}

export function isPropHiddenByDefault(fieldId: string, nodes: NodeMap): boolean {
  return isIntrinsicSystemPropKey(fieldId) || isFieldNodeHidden(fieldId, nodes);
}

export interface ResolvePropsOptions {
  /**
   * Reveal this node's `sys.*` + hidden fields with muted styling.
   *
   * Per node, per call — the caller reads it from
   * `stores/debug-fields.store` for the node it is rendering. It was once a
   * device-wide pref, which is why the option is worth naming precisely.
   */
  showDebugFields?: boolean;
}

export type VisibleProp = ResolvedProp & {
  /** Muted debug row (sys.* or user-hidden field). */
  debug?: boolean;
  /** Template slot with no value yet (still editable). */
  empty?: boolean;
};

/**
 * Field ids this node inherits, in declaration order.
 *
 * Everything in the node's kind slot contributes its own `sys.f.fields`
 * template: `sys.tag` gives a tag node color and hidden, `sys.field` gives a
 * field node its type and ref constraints, and a user supertag gives its
 * members whatever fields were added to it. That last case is the one this
 * replaces — the old rule consulted only `sys.tag`'s template and only for tag
 * nodes, so fields added to a supertag stayed invisible on its members until
 * somebody set a value, which made adding fields to a tag look like it did
 * nothing.
 */
function templatedFieldIds(node: OutlineNode, nodes: NodeMap): string[] {
  const ids: string[] = [];
  for (const type of node.props[SYSTEM_IDS.typeField] ?? []) {
    if (type.t !== "ref" || typeof type.v !== "string") continue;
    for (const ref of nodes.get(type.v)?.props[SYSTEM_IDS.fieldsField] ?? []) {
      if (ref.t !== "ref" || typeof ref.v !== "string") continue;
      if (!ids.includes(ref.v)) ids.push(ref.v);
    }
  }
  return ids;
}

/** Resolve node props for FieldRow display with visibility filtering. */
export function resolveVisibleProps(
  node: OutlineNode,
  nodes: NodeMap,
  opts: ResolvePropsOptions = {},
): VisibleProp[] {
  const showAll = opts.showDebugFields ?? false;
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

  // Surface inherited fields even when unset, so the node page is always the
  // configurator — no bespoke panel, and a tag's fields show up on its members
  // as soon as the tag declares them.
  for (const fieldId of templatedFieldIds(node, nodes)) {
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

  return out;
}
