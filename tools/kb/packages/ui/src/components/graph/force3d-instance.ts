/**
 * The `3d-force-graph` seam.
 *
 * The library is generic over its node and link types, but the constructor it
 * publishes is a non-generic `const`, so every accessor callback arrives as
 * `object` unless someone names the types once. This module is that once — it
 * is the only file that imports `3d-force-graph`, and everything downstream
 * sees `FgNode` / `FgLink`.
 */
import ForceGraph3D, { type ForceGraph3DInstance } from "3d-force-graph";

/** A node as this app hands it to the simulation; x/y/z/v* are written back. */
export interface FgNode {
  id: string;
  name: string;
  color: string;
  val: number;
  clusterKey: string;
  tags: string[];
  degree: number;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
}

/** An edge; the simulation replaces the endpoint ids with node objects. */
export interface FgLink {
  source: string | FgNode;
  target: string | FgNode;
  kind: string;
  weight: number;
}

export type KbForceGraph = ForceGraph3DInstance<FgNode, FgLink>;

/** The endpoint id, before or after the simulation resolves it. */
export function linkEndId(end: string | FgNode): string {
  return typeof end === "string" ? end : end.id;
}

/**
 * `new ForceGraph3D(el)`, with kb's node and link types applied.
 *
 * The one assertion in this package that no check can replace: the library
 * declares its constructor as a non-generic `const`, and `Omit`s its instance
 * type, so the generic instance is not assignable from the default one under
 * `strictFunctionTypes` even though the runtime object is identical. Naming
 * the types here is what deletes the fourteen per-callback assertions that
 * used to stand downstream.
 *
 * GAP [[01M1P2RAJVTB4CESYGEVF7NDE1]]
 */
export function createForceGraph(el: HTMLElement): KbForceGraph {
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- GAP [[01M1P2RAJVTB4CESYGEVF7NDE1]] non-generic vendor constructor
  const Ctor = ForceGraph3D as unknown as new (element: HTMLElement) => KbForceGraph;
  return new Ctor(el);
}
