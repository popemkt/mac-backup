/**
 * Relinking a canvas edge: `(edge, change) -> plan`.
 *
 * Canvas edges are drawings that may *also* bind a ref prop between the two kb
 * nodes they connect. Changing the link mode and choosing the ref field are
 * the same request seen from two ends — both settle on a `kbLink` and, when
 * that link is native, on the one-shot prop write that realises it. This is
 * the single transformation both go through, beside the node planners in
 * `actions/plan.ts` rather than inside the inspector's callbacks.
 *
 * Pure: the fresh binding id arrives on the context, the way the pointer
 * reducer takes its edge ids, so a plan is a function of its inputs.
 */
import {
  isKbNode,
  type CanvasEdge,
  type CanvasKbNode,
  type CanvasNode,
  type KbLinkMode,
} from "@kb/canvas";
import { isValidNativeTarget, planNativeBind } from "@/lib/canvas-api";
import type { OutlineNode, PropValue } from "@/lib/types";

/** What the inspector asked for. */
export type EdgeRelink = { kind: "mode"; mode: KbLinkMode } | { kind: "field"; fieldId: string };

export interface EdgeRelinkContext {
  byId: ReadonlyMap<string, CanvasNode>;
  nodes: Map<string, OutlineNode>;
  queryDb: Parameters<typeof isValidNativeTarget>[3];
  /** Binding id for an edge that does not have one yet. */
  bindingId: string;
}

interface EdgePropWrite {
  propTargetId: string;
  setProps?: { field: string; value: PropValue }[];
}

export type EdgeRelinkPlan =
  /** The request does not apply to this edge; nothing is written, nothing said. */
  | { kind: "none" }
  | { kind: "reject"; reason: string }
  | { kind: "write"; edge: CanvasEdge; props?: EdgePropWrite };

const NEEDS_FIELD = "Pick a ref field before enabling native mode";
const NOT_ALLOWED = "Target not allowed for this ref field";

interface KbEndpoints {
  from: CanvasKbNode;
  to: CanvasKbNode;
}

/** Both ends, when both are kb-node cards — a native link needs two of them. */
function kbEndpoints(edge: CanvasEdge, ctx: EdgeRelinkContext): KbEndpoints | null {
  const from = ctx.byId.get(edge.fromNode);
  const to = ctx.byId.get(edge.toNode);
  return from && to && isKbNode(from) && isKbNode(to) ? { from, to } : null;
}

function linkFor(
  edge: CanvasEdge,
  endpoints: KbEndpoints,
  mode: KbLinkMode,
  fieldId: string,
  ctx: EdgeRelinkContext,
) {
  return {
    mode,
    via: "prop" as const,
    fieldId,
    sourceNodeId: endpoints.from.nodeId,
    targetNodeId: endpoints.to.nodeId,
    bindingId: edge.kbLink?.bindingId ?? ctx.bindingId,
  };
}

/**
 * The tail both changes share: a native link only stands if the field accepts
 * the target, and it carries the prop write that binds them — skipped when the
 * triple is already there.
 */
function planNativeLink(
  edge: CanvasEdge,
  link: ReturnType<typeof linkFor>,
  ctx: EdgeRelinkContext,
): EdgeRelinkPlan {
  if (!isValidNativeTarget(link.fieldId, link.targetNodeId, ctx.nodes, ctx.queryDb)) {
    return { kind: "reject", reason: NOT_ALLOWED };
  }
  const bind = planNativeBind(ctx.nodes, link.sourceNodeId, link.fieldId, link.targetNodeId);
  return {
    kind: "write",
    edge: { ...edge, kbLink: link },
    props: {
      propTargetId: link.sourceNodeId,
      setProps: bind.skip ? undefined : bind.setProps,
    },
  };
}

function planModeChange(
  edge: CanvasEdge,
  mode: KbLinkMode,
  ctx: EdgeRelinkContext,
): EdgeRelinkPlan {
  // An edge with no link at all has no field to go native with.
  if (mode === "native" && edge.kbLink === undefined) {
    return { kind: "reject", reason: NEEDS_FIELD };
  }
  const endpoints = kbEndpoints(edge, ctx);
  if (!endpoints) {
    // A drawing between cards that are not kb nodes: only the mode moves, and
    // native is not a mode it can hold without a field.
    const kbLink = edge.kbLink
      ? {
          ...edge.kbLink,
          mode: mode === "native" && !edge.kbLink.fieldId ? ("layout" as const) : mode,
        }
      : undefined;
    return { kind: "write", edge: { ...edge, kbLink } };
  }
  const link = linkFor(edge, endpoints, mode, edge.kbLink?.fieldId ?? "", ctx);
  if (mode === "native" && !link.fieldId) return { kind: "reject", reason: NEEDS_FIELD };
  if (mode !== "native") return { kind: "write", edge: { ...edge, kbLink: link } };
  return planNativeLink(edge, link, ctx);
}

/** Choosing a field is choosing native mode with that field. */
function planFieldChange(
  edge: CanvasEdge,
  fieldId: string,
  ctx: EdgeRelinkContext,
): EdgeRelinkPlan {
  const endpoints = kbEndpoints(edge, ctx);
  if (!endpoints) return { kind: "none" };
  return planNativeLink(edge, linkFor(edge, endpoints, "native", fieldId, ctx), ctx);
}

export function planEdgeRelink(
  edge: CanvasEdge,
  change: EdgeRelink,
  ctx: EdgeRelinkContext,
): EdgeRelinkPlan {
  return change.kind === "mode"
    ? planModeChange(edge, change.mode, ctx)
    : planFieldChange(edge, change.fieldId, ctx);
}
