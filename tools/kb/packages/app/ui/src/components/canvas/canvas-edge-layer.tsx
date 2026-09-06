import type { CanvasDoc, CanvasEdge, CanvasNode } from "@kb/canvas";
import { edgePath, sidePoint } from "@/lib/canvas-edge-path";
import { edgePropPresent } from "@/lib/canvas-api";
import { resolveCanvasColor } from "@/lib/canvas-color";
import type { CanvasSelection } from "@/lib/canvas-selection";
import type { PointerState } from "@/lib/canvas-pointer";
import type { OutlineNode } from "@/lib/types";
import { hasText } from "@/lib/text";

interface CanvasEdgeLayerProps {
  doc: CanvasDoc;
  nodes: Map<string, OutlineNode>;
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

function EdgeMarkers() {
  return (
    <defs>
      <marker
        id="kb-arrow"
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
      </marker>
      {["1", "2", "3", "4", "5", "6"].map((colorId) => (
        <marker
          key={colorId}
          id={`kb-arrow-${colorId}`}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={`var(--canvas-color-${colorId})`} />
        </marker>
      ))}
      <marker
        id="kb-arrow-rev"
        viewBox="0 0 10 10"
        refX="2"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path d="M 10 0 L 0 5 L 10 10 z" fill="currentColor" />
      </marker>
      {["1", "2", "3", "4", "5", "6"].map((colorId) => (
        <marker
          key={`rev-${colorId}`}
          id={`kb-arrow-rev-${colorId}`}
          viewBox="0 0 10 10"
          refX="2"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 10 0 L 0 5 L 10 10 z" fill={`var(--canvas-color-${colorId})`} />
        </marker>
      ))}
    </defs>
  );
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
  const d = edgePath(from, to, edge);
  const selected = selection.edgeIds.has(edge.id);
  const unbound =
    edge.kbLink?.mode === "native" && !!edge.kbLink.fieldId && !edgePropPresent(edge, nodes);
  const edgeColor = resolveCanvasColor(edge.color);
  const markerEnd =
    edge.toEnd === "none"
      ? undefined
      : hasText(edge.color)
        ? `url(#kb-arrow-${edge.color})`
        : "url(#kb-arrow)";
  const markerStart =
    edge.fromEnd === "arrow"
      ? hasText(edge.color)
        ? `url(#kb-arrow-rev-${edge.color})`
        : "url(#kb-arrow-rev)"
      : undefined;

  // Edge label midpoint
  const labelEl = (() => {
    const a = sidePoint(from, edge.fromSide ?? "right");
    const b = sidePoint(to, edge.toSide ?? "left");
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if (editingEdgeLabel === edge.id) {
      return (
        <foreignObject x={mx - 60} y={my - 12} width={120} height={24}>
          <input
            autoFocus
            type="text"
            className="h-full w-full rounded border border-primary/40 bg-popover px-1 text-center text-[11px]"
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
        transform={`translate(${mx}, ${my})`}
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
          className="fill-foreground/70 text-[11px] font-medium"
          style={{ pointerEvents: "none" }}
        >
          {edge.label}
        </text>
      </g>
    );
  })();

  return (
    <g key={edge.id}>
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
        d={d}
        fill="none"
        stroke={
          edgeColor ??
          (unbound
            ? "color-mix(in oklab, var(--foreground) 15%, transparent)"
            : selected
              ? "var(--primary)"
              : "currentColor")
        }
        strokeWidth={selected ? 2.5 : 1.5}
        className="pointer-events-none transition-colors"
        markerEnd={markerEnd}
        markerStart={markerStart}
      >
        {unbound && <title>prop no longer present — rebind?</title>}
      </path>
      {labelEl}
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
  const stageEl = document.querySelector("[data-canvas-stage]")?.parentElement;
  if (!from || !stageEl) return null;
  const stageRect = stageEl.getBoundingClientRect();
  const start = sidePoint(from, edgeDrag.fromSide);
  const end = {
    x: (edgeDrag.x - stageRect.left - pan.x) / zoom,
    y: (edgeDrag.y - stageRect.top - pan.y) / zoom,
  };
  const dx = Math.max(40, Math.abs(end.x - start.x) * 0.45);
  const c1x =
    start.x + (edgeDrag.fromSide === "left" ? -dx : edgeDrag.fromSide === "right" ? dx : 0);
  const c1y =
    start.y + (edgeDrag.fromSide === "top" ? -dx : edgeDrag.fromSide === "bottom" ? dx : 0);
  return (
    <path
      d={`M ${start.x} ${start.y} C ${c1x} ${c1y}, ${end.x} ${end.y}, ${end.x} ${end.y}`}
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
      <EdgeMarkers />
      <g className="pointer-events-auto text-foreground/35">
        {props.doc.edges.map((edge) => (
          <CanvasEdgeView key={edge.id} {...props} edge={edge} />
        ))}
      </g>
      <GhostEdgePath {...props} />
    </svg>
  );
}
