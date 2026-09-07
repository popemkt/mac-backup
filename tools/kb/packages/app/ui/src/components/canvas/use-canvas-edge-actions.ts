import type { Dispatch, RefObject, SetStateAction } from "react";
import { ulid } from "ulid";
import type { CanvasDoc, CanvasEdge, CanvasNode, KbLinkMode } from "@kb/canvas";
import { removeCanvasEdge, upsertCanvasEdge } from "@kb/canvas";
import type { useCanvasDoc } from "@/components/canvas/use-canvas-doc";
import type { isValidNativeTarget } from "@/lib/canvas-api";
import { planEdgeRelink, type EdgeRelink } from "@/lib/canvas-edge-link";
import { type CanvasSelection, EMPTY_SELECTION } from "@/lib/canvas-selection";
import { toast } from "@/lib/toast";

interface CanvasEdgeActionContext {
  selectedEdge: CanvasEdge | null;
  byId: Map<string, CanvasNode>;
  docRef: RefObject<CanvasDoc>;
  nodes: Parameters<typeof isValidNativeTarget>[2];
  queryDb: Parameters<typeof isValidNativeTarget>[3];
  flushPersist: ReturnType<typeof useCanvasDoc>["flushPersist"];
  setSelection: Dispatch<SetStateAction<CanvasSelection>>;
  setInspectorAnchor: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
}

/** Apply what the planner decided: a toast, nothing, or one atomic write. */
async function relinkEdge(context: CanvasEdgeActionContext, change: EdgeRelink) {
  const edge = context.selectedEdge;
  if (!edge) return;
  const plan = planEdgeRelink(edge, change, {
    byId: context.byId,
    nodes: context.nodes,
    queryDb: context.queryDb,
    bindingId: ulid(),
  });
  if (plan.kind === "reject") {
    toast(plan.reason);
    return;
  }
  if (plan.kind === "none") return;
  await context.flushPersist(upsertCanvasEdge(context.docRef.current, plan.edge), plan.props);
}

async function deleteEdge(context: CanvasEdgeActionContext) {
  const edge = context.selectedEdge;
  if (!edge) return;
  const link = edge.kbLink;
  const next = removeCanvasEdge(context.docRef.current, edge.id);
  const offerUnset =
    link?.mode === "native" &&
    !!link.fieldId &&
    window.confirm("Also remove the bound prop from the source node?");
  if (offerUnset) {
    await context.flushPersist(next, {
      propTargetId: link.sourceNodeId,
      unsetProps: [
        {
          field: link.fieldId,
          value: { t: "ref", v: link.targetNodeId },
        },
      ],
    });
  } else {
    await context.flushPersist(next);
  }
  context.setSelection(EMPTY_SELECTION);
  context.setInspectorAnchor(null);
}

export function createCanvasEdgeActions(context: CanvasEdgeActionContext) {
  return {
    onDeleteEdge: () => deleteEdge(context),
    onFieldChange: (fieldId: string) => relinkEdge(context, { kind: "field", fieldId }),
    onModeChange: (mode: KbLinkMode) => relinkEdge(context, { kind: "mode", mode }),
  };
}
