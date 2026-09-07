import { SigmaGraph, type SigmaGraphProps } from "./sigma-graph";

export type ClusterGraphProps = Omit<SigmaGraphProps, "cluster" | "layout" | "onNodeOpen"> & {
  onNodeClick: (id: string) => void;
};

/** Cluster is a layout and hull decoration on the shared 2D renderer. */
export function ClusterGraph({ onNodeClick, ...props }: ClusterGraphProps) {
  return <SigmaGraph {...props} cluster onNodeOpen={onNodeClick} />;
}
