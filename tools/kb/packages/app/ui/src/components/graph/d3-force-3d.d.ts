/** d3-force-3d ships no types; this is the slice of it the 3D layout uses. */
declare module "d3-force-3d" {
  export interface SimulationNode {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface SimulationLink<N extends SimulationNode> {
    source: string | number | N;
    target: string | number | N;
  }

  export type Force = (alpha: number) => void;

  export interface Simulation<N extends SimulationNode> {
    nodes(): N[];
    nodes(nodes: N[]): this;
    numDimensions(dimensions: 1 | 2 | 3): this;
    alpha(): number;
    alpha(alpha: number): this;
    alphaDecay(decay: number): this;
    alphaMin(min: number): this;
    velocityDecay(decay: number): this;
    force(name: string, force: Force | null): this;
    tick(iterations?: number): this;
    stop(): this;
  }

  export interface LinkForce<N extends SimulationNode, L extends SimulationLink<N>> extends Force {
    links(links: L[]): this;
    id(id: (node: N) => string): this;
    distance(distance: number): this;
  }

  export interface ManyBodyForce extends Force {
    strength(strength: number): this;
  }

  export interface PositionForce extends Force {
    strength(strength: number): this;
  }

  export function forceSimulation<N extends SimulationNode>(
    nodes?: N[],
    dimensions?: 1 | 2 | 3,
  ): Simulation<N>;
  export function forceLink<N extends SimulationNode, L extends SimulationLink<N>>(
    links?: L[],
  ): LinkForce<N, L>;
  export function forceManyBody(): ManyBodyForce;
  export function forceCenter(x?: number, y?: number, z?: number): Force;
  export function forceX(x?: number): PositionForce;
  export function forceY(y?: number): PositionForce;
  export function forceZ(z?: number): PositionForce;
}
