import type { Dispatch, RefObject, SetStateAction } from "react";
import { ulid } from "ulid";
import type { CanvasDoc, CanvasEdge, CanvasNode, KbLinkMode } from "@kb/canvas";
import { isKbNode, removeCanvasEdge, upsertCanvasEdge } from "@kb/canvas";
import type { useCanvasDoc } from "@/components/canvas/use-canvas-doc";
import { isValidNativeTarget, planNativeBind } from "@/lib/canvas-api";
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

function kbEndpoints(context: CanvasEdgeActionContext, edge: CanvasEdge) {
  const from = context.byId.get(edge.fromNode);
  const to = context.byId.get(edge.toNode);
  return from && to && isKbNode(from) && isKbNode(to) ? { from, to } : null;
}

async function changeEdgeMode(context: CanvasEdgeActionContext, mode: KbLinkMode) {
  const edge = context.selectedEdge;
  if (!edge) return;
  const endpoints = kbEndpoints(context, edge);

  if (mode === "native" && edge.kbLink?.fieldId === undefined) {
    toast("Pick a ref field before enabling native mode");
    return;
  }
  if (!endpoints) {
    await context.flushPersist(
      upsertCanvasEdge(context.docRef.current, {
        ...edge,
        kbLink: edge.kbLink
          ? {
              ...edge.kbLink,
              mode: mode === "native" && !edge.kbLink.fieldId ? "layout" : mode,
            }
          : undefined,
      }),
    );
    return;
  }
  const { from, to } = endpoints;

  const link = {
    mode,
    via: "prop" as const,
    fieldId: edge.kbLink?.fieldId ?? "",
    sourceNodeId: from.nodeId,
    targetNodeId: to.nodeId,
    bindingId: edge.kbLink?.bindingId ?? ulid(),
  };
  if (mode === "native" && !link.fieldId) {
    toast("Pick a ref field before enabling native mode");
    return;
  }
  const next = upsertCanvasEdge(context.docRef.current, { ...edge, kbLink: link });
  if (mode !== "native" || !link.fieldId) {
    await context.flushPersist(next);
    return;
  }
  if (!isValidNativeTarget(link.fieldId, to.nodeId, context.nodes, context.queryDb)) {
    toast("Target not allowed for this ref field");
    return;
  }
  const bind = planNativeBind(context.nodes, from.nodeId, link.fieldId, to.nodeId);
  await context.flushPersist(next, {
    propTargetId: from.nodeId,
    setProps: bind.skip ? undefined : bind.setProps,
  });
}

async function changeEdgeField(context: CanvasEdgeActionContext, fieldId: string) {
  const edge = context.selectedEdge;
  if (!edge) return;
  const from = context.byId.get(edge.fromNode);
  const to = context.byId.get(edge.toNode);
  if (!from || !to || !isKbNode(from) || !isKbNode(to)) return;
  if (!isValidNativeTarget(fieldId, to.nodeId, context.nodes, context.queryDb)) {
    toast("Target not allowed for this ref field");
    return;
  }

  const link = {
    mode: "native" as const,
    via: "prop" as const,
    fieldId,
    sourceNodeId: from.nodeId,
    targetNodeId: to.nodeId,
    bindingId: edge.kbLink?.bindingId ?? ulid(),
  };
  const next = upsertCanvasEdge(context.docRef.current, { ...edge, kbLink: link });
  const bind = planNativeBind(context.nodes, from.nodeId, fieldId, to.nodeId);
  await context.flushPersist(next, {
    propTargetId: from.nodeId,
    setProps: bind.skip ? undefined : bind.setProps,
  });
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
    onFieldChange: (fieldId: string) => changeEdgeField(context, fieldId),
    onModeChange: (mode: KbLinkMode) => changeEdgeMode(context, mode),
  };
}
