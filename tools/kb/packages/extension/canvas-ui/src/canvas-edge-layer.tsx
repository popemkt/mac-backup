/**
 * The 2D canvas's edges: each its route's path (`edgeRoute`, `@kb/canvas`),
 * stroked as its look says (`edgePaint`), the heads its ends wear drawn as
 * their own outlines (`edgeHead`) — the ones the 3D scene lays flat — and
 * its label halfway along the route. The ghost of an edge being drawn
 * follows the pointer.
 */
import {
  edgeHead,
  edgeRoute,
  looseRoute,
  routeMidpoint,
  sideTerminal,
  svgPathData,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  type EdgeRoute,
} from "@kb/canvas";
import { edgeUnbound } from "./canvas-api";
import { toneCss } from "./canvas-dom-paint";
import type { CanvasSelection } from "./canvas-selection";
import type { PointerState } from "./canvas-pointer";
import { edgePaint, type EdgePaint } from "./canvas-style";
import { hasText, type OutlineNode } from "@kb/ui-sdk";
import { clientToCanvas } from "./canvas-camera";

interface CanvasEdgeLayerProps {
  doc: CanvasDoc;
  nodes: ReadonlyMap<string, OutlineNode>;
  byId: Map<string, CanvasNode>;
  selection: CanvasSelection;
  pan: { x: number; y: number };
  zoom: number;
  editingEdgeLabel: string | null;
  edgeDrag: Extract<NonNullable<PointerState["drag"]>, { kind: "edge" }> | null;
  onEditingEdgeLabelChange: (edgeId: string | null) => void;
  onEdgeLabelCommit: (edge: CanvasEdge, label: string) => void;
  onEdgeClick: (edge: CanvasEdge, event: React.MouseEvent) => void;
}

type CanvasEdgeViewProps = Pick<
  CanvasEdgeLayerProps,
  | "byId"
  | "editingEdgeLabel"
  | "nodes"
  | "onEdgeClick"
  | "onEdgeLabelCommit"
  | "onEditingEdgeLabelChange"
  | "selection"
> & { edge: CanvasEdge };

type EdgeLabelProps = Pick<
  CanvasEdgeLayerProps,
  "editingEdgeLabel" | "onEdgeLabelCommit" | "onEditingEdgeLabelChange"
> & { edge: CanvasEdge; at: { x: number; y: number } };

/** An edge's label, halfway along its route: a chip, or the field that edits it. */
function EdgeLabel({
  edge,
  at,
  editingEdgeLabel,
  onEdgeLabelCommit,
  onEditingEdgeLabelChange,
}: EdgeLabelProps) {
  if (editingEdgeLabel === edge.id) {
    return (
      <foreignObject x={at.x - 60} y={at.y - 12} width={120} height={24}>
        <input
          autoFocus
          type="text"
          className="h-full w-full rounded-xs border border-primary/40 bg-popover px-1 text-center text-label"
          defaultValue={edge.label ?? ""}
          onBlur={(ev) => {
            const val = ev.currentTarget.value.trim();
            onEdgeLabelCommit(edge, val);
            onEditingEdgeLabelChange(null);
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" || ev.key === "Escape") {
              ev.currentTarget.blur();
            }
            ev.stopPropagation();
          }}
        />
      </foreignObject>
    );
  }
  if (!hasText(edge.label)) return null;
  return (
    <g
      transform={`translate(${at.x}, ${at.y})`}
      className="cursor-pointer"
      onDoubleClick={(ev) => {
        ev.stopPropagation();
        onEditingEdgeLabelChange(edge.id);
      }}
    >
      <rect
        x={-edge.label.length * 3.5 - 6}
        y={-10}
        width={edge.label.length * 7 + 12}
        height={20}
        rx={4}
        className="fill-popover stroke-foreground/10"
        strokeWidth={1}
      />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-foreground/70 text-label font-medium"
        style={{ pointerEvents: "none" }}
      >
        {edge.label}
      </text>
    </g>
  );
}

/** The heads an edge's ends wear, in its ink: filled, or stroked as heavy as its line. */
function EdgeHeads({
  edge,
  route,
  paint,
  ink,
}: {
  edge: CanvasEdge;
  route: EdgeRoute;
  paint: EdgePaint;
  ink: string;
}) {
  return (["from", "to"] as const).map((end) => {
    const head = edgeHead(edge, route, end, paint.headLength);
    if (head === null) return null;
    return (
      <path
        key={end}
        data-edge-head={end}
        data-head-kind={head.kind}
        d={svgPathData(head.path)}
        fill={head.filled ? ink : "none"}
        stroke={ink}
        strokeWidth={head.filled ? 0 : paint.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none transition-colors"
      />
    );
  });
}

function CanvasEdgeView({
  edge,
  byId,
  editingEdgeLabel,
  nodes,
  onEdgeClick: handleEdgeClick,
  onEdgeLabelCommit,
  onEditingEdgeLabelChange,
  selection,
}: CanvasEdgeViewProps) {
  const from = byId.get(edge.fromNode);
  const to = byId.get(edge.toNode);
  if (!from || !to) return null;
  const route = edgeRoute(from, to, edge);
  const d = svgPathData(route.path);
  const selected = selection.edgeIds.has(edge.id);
  const unbound = edgeUnbound(edge, nodes);
  const paint = edgePaint(edge, { selected, unbound });
  const ink = toneCss(paint.ink);
  return (
    <g
      key={edge.id}
      data-edge-id={edge.id}
      data-selected={selected ? "" : undefined}
      opacity={paint.opacity === 1 ? undefined : paint.opacity}
    >
      {/* Fat transparent hit area */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="cursor-pointer"
        onClick={(ev) => handleEdgeClick(edge, ev)}
        onDoubleClick={(ev) => {
          ev.stopPropagation();
          onEditingEdgeLabelChange(edge.id);
        }}
      />
      {/* Visible stroke */}
      <path
        data-edge-path
        d={d}
        fill="none"
        stroke={paint.line === null ? "none" : ink}
        strokeWidth={paint.width}
        strokeDasharray={
          paint.line === null || paint.line.pattern.length === 0
            ? undefined
            : paint.line.pattern.join(" ")
        }
        className="pointer-events-none transition-colors"
      >
        {unbound && <title>prop no longer present — rebind?</title>}
      </path>
      <EdgeHeads edge={edge} route={route} paint={paint} ink={ink} />
      <EdgeLabel
        edge={edge}
        at={routeMidpoint(route)}
        editingEdgeLabel={editingEdgeLabel}
        onEdgeLabelCommit={onEdgeLabelCommit}
        onEditingEdgeLabelChange={onEditingEdgeLabelChange}
      />
    </g>
  );
}

function GhostEdgePath({
  byId,
  edgeDrag,
  pan,
  zoom,
}: Pick<CanvasEdgeLayerProps, "byId" | "edgeDrag" | "pan" | "zoom">) {
  if (!edgeDrag) return null;
  const from = byId.get(edgeDrag.fromCardId);
  const stageEl = document.querySelector("[data-canvas-viewport]");
  if (!from || !stageEl) return null;
  const { width, height } = stageEl.getBoundingClientRect();
  // The drag holds a viewport point: the viewport is its own origin.
  const viewport = { left: 0, top: 0, width, height };
  const end = clientToCanvas({ x: edgeDrag.x, y: edgeDrag.y }, viewport, pan, zoom);
  const route = looseRoute(sideTerminal(from, edgeDrag.fromSide), end);
  return (
    <path
      data-testid="canvas-connection-preview"
      d={svgPathData(route.path)}
      fill="none"
      stroke="var(--primary)"
      strokeWidth={1.5}
      strokeDasharray="4 4"
      className="pointer-events-none"
      opacity={0.6}
    />
  );
}

export function CanvasEdgeLayer(props: CanvasEdgeLayerProps) {
  return (
    <svg
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
      width={8000}
      height={8000}
    >
      <g className="pointer-events-auto">
        {props.doc.edges.map((edge) => (
          <CanvasEdgeView key={edge.id} {...props} edge={edge} />
        ))}
      </g>
      <GhostEdgePath {...props} />
    </svg>
  );
}
