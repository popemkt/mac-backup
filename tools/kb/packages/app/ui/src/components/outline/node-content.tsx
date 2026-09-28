import { mutations } from "@/actions/mutations";
import {
  NodeTextHost,
  type NodeTextHostBinding,
  type NodeTextHostProps,
} from "@/components/ui/node-text-host";
import { rowText, shownNodeId } from "@/lib/contextual-ref";
import type { OutlineNode } from "@/lib/types";
import { useNodeTextHostBinding } from "@/stores/node-text-host-binding";

/**
 * Outline surface binding of the shared node text host.
 *
 * It owns the row's text channel, so no surface can wire it differently: the
 * text shown is `rowText`, and every write — typing, `[[` completion, a
 * dropped file — goes to `shownNodeId`, the node that text belongs to. For an
 * ordinary row that is the row itself; for a contextual reference it is the
 * target, which is what makes a reference edit the original in place. The
 * tag chips are the shown node's too (the surface passes `shownNode(…).tags`),
 * so removing one removes it from the node it is drawn on.
 */
export function NodeContent({
  node,
  ...props
}: Omit<NodeTextHostProps, keyof NodeTextHostBinding | "nodeId" | "content" | "onChange"> & {
  /** The row's node, as the surface renders it (a projection may pass its own map). */
  node: OutlineNode;
}) {
  const binding = useNodeTextHostBinding();
  const content = rowText(node, binding.schema);
  const textNodeId = shownNodeId(node);
  return (
    <NodeTextHost
      {...props}
      {...binding}
      nodeId={node.id}
      content={content}
      onChange={(next) => {
        if (next !== content) void mutations.updateNodeContent(textNodeId, next);
      }}
      onAttachFile={(file) => {
        void mutations.attachFileToNode(textNodeId, file);
      }}
      onRemoveTag={(tagId) => {
        void mutations.removeTag(textNodeId, tagId);
      }}
    />
  );
}
