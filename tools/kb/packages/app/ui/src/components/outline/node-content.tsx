import { mutations } from "@/actions/mutations";
import {
  NodeTextHost,
  type NodeTextHostBinding,
  type NodeTextHostProps,
} from "@/components/ui/node-text-host";
import { useNodeTextHostBinding } from "@/stores/node-text-host-binding";

/** Outline surface binding of the shared node text host. */
export function NodeContent(props: Omit<NodeTextHostProps, keyof NodeTextHostBinding>) {
  const binding = useNodeTextHostBinding();
  return (
    <NodeTextHost
      {...props}
      {...binding}
      onAttachFile={(file) => {
        void mutations.attachFileToNode(props.nodeId, file);
      }}
      onRemoveTag={(tagId) => {
        void mutations.removeTag(props.nodeId, tagId);
      }}
    />
  );
}
