import type { FrameRowTextProps } from "@kb/ui-sdk";
import { NodeContent } from "./node-content";
import { useOutlineStore } from "./outline.store";
import { useNodeKeyDown } from "./use-node-keydown";

/**
 * A frame row's text as the outline edits it, inside the row chrome of
 * whichever frame view lays the row out: the outline's text host, its editing
 * keys, and starting an edit at the caret.
 */
export function FrameRowText({ node, instanceKey, isActive, tags }: FrameRowTextProps) {
  const activateNode = useOutlineStore((s) => s.activateNode);
  const onKeyDown = useNodeKeyDown({ nodeId: node.id, instanceKey });
  return (
    <NodeContent
      node={node}
      instanceKey={instanceKey}
      isActive={isActive}
      tags={tags}
      onActivate={(pos) => activateNode(node.id, pos, instanceKey)}
      onKeyDown={onKeyDown}
    />
  );
}
