/**
 * Field candidates offered by the view filter popover. Same source as
 * resolveTableColumns: projected rows' tags. Lives outside the popover
 * component so the popover file exports components only.
 */
import type { SchemaIndex } from "@/lib/schema";
import { getViewConfig, resolveTableColumns } from "@/lib/view-config";
import type { NodeMap, OutlineNode } from "@/lib/types";

/** `nodes` is the projection the frame's rows come from; `schema` names their fields. */
export function listFilterFieldOptions(
  frameId: string,
  nodes: NodeMap,
  schema: SchemaIndex,
): Array<{ id: string; text: string }> {
  const frame = nodes.get(frameId);
  if (!frame) return [];
  const children = frame.children
    .map((id) => nodes.get(id))
    .filter((n): n is OutlineNode => n !== undefined);
  const config = getViewConfig(frame.props);
  return resolveTableColumns(config, children, schema, true).map((c) => ({
    id: c.fieldId,
    text: c.label,
  }));
}
