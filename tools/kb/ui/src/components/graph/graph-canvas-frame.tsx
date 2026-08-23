import type Sigma from "sigma";
import type { LensNode } from "@/lib/graph-lens";
import { GraphLegend } from "./graph-legend";
import { GraphToolbar } from "./graph-toolbar";

/** Shared graph chrome. Renderers only own pixels and renderer-specific input;
 * the frame owns the discoverable vocabulary that surrounds every graph. */
export function GraphCanvasFrame({
  children,
  nodes,
  sigmaRef,
  selectedNodeId,
  onSearchChange,
  onFilterChange,
}: {
  children: React.ReactNode;
  nodes: LensNode[];
  sigmaRef: React.MutableRefObject<Sigma | null>;
  selectedNodeId: string | null;
  onSearchChange: (ids: Set<string> | null) => void;
  onFilterChange: (ids: Set<string> | null) => void;
}) {
  return (
    <>
      {children}
      <GraphToolbar
        sigmaRef={sigmaRef}
        selectedNodeId={selectedNodeId}
        nodeIds={nodes.map((node) => node.id)}
        onSearchChange={onSearchChange}
      />
      <GraphLegend nodes={nodes} onFilterChange={onFilterChange} />
    </>
  );
}
