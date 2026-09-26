/**
 * How a new graph arrives, in every renderer that draws nodes on a canvas
 * (Lab principles P2, M3, M5): the best-connected nodes first, then their
 * neighbours, one small stagger per hop outward, each node growing in on the
 * one ease over `--motion-duration-reveal`. With the hop count capped, the
 * whole graph has settled in 300–400ms, so it reads as the hubs gathering
 * their neighbourhoods rather than as dots popping in. Under reduced motion
 * the graph is simply there (M7).
 *
 * Values live in one Float32Array in the renderer's own node order, so a
 * frame's step allocates nothing (P3).
 */
import { easeAt, type Timing } from "@/lib/timing";

/**
 * How far a node must have arrived before its label shows, in every renderer:
 * a label comes in after the node it names, never at full ink over a node
 * still growing in.
 */
const LABEL_ARRIVED = 0.85;

/** Whether a node that has arrived this far may be labelled. */
export function labelArrived(arrival: number): boolean {
  return arrival >= LABEL_ARRIVED;
}

/** Hops past which every node arrives together: the stagger's reach. */
const MAX_HOPS = 4;
/** The share of nodes, by degree, that arrive first (at least one). */
const HUB_SHARE = 0.03;

/** Each node's hops from the nearest hub (the top `HUB_SHARE` by degree), capped at `MAX_HOPS`. */
export function hopsFromHubs(
  count: number,
  degree: (i: number) => number,
  neighbours: (i: number) => Iterable<number>,
): Uint8Array {
  const hops = new Uint8Array(count).fill(MAX_HOPS);
  if (count === 0) return hops;
  const order = Array.from({ length: count }, (_, i) => i).toSorted(
    (a, b) => degree(b) - degree(a) || a - b,
  );
  let frontier = order.slice(0, Math.max(1, Math.round(count * HUB_SHARE)));
  for (const i of frontier) hops[i] = 0;
  for (let hop = 1; hop < MAX_HOPS && frontier.length > 0; hop++) {
    const next: number[] = [];
    for (const i of frontier)
      for (const j of neighbours(i))
        if (hops[j] === MAX_HOPS) {
          hops[j] = hop;
          next.push(j);
        }
    frontier = next;
  }
  return hops;
}

export class GraphArrival {
  /** 0 (not yet arrived) … 1 (in place), per node. */
  values: Float32Array = new Float32Array(0);
  private hops: Uint8Array = new Uint8Array(0);
  private clock = 0;
  private arriving = false;
  private readonly timing: Timing;

  constructor(timing: Timing) {
    this.timing = timing;
  }

  /** The whole arrival's length, seconds: the last hop's delay plus one reveal. */
  get duration(): number {
    return MAX_HOPS * this.timing.stagger + this.timing.reveal;
  }

  get active(): boolean {
    return this.arriving;
  }

  /** A new node set, ordered by `hops`: it arrives from the hubs, or is simply there. */
  start(hops: Uint8Array, animate: boolean): void {
    this.hops = hops;
    this.values = new Float32Array(hops.length).fill(animate ? 0 : 1);
    this.clock = 0;
    this.arriving = animate && hops.length > 0;
  }

  /** Advance by `dt`; `reduced` lands every node. Whether it still moves. */
  step(dt: number, reduced: boolean): boolean {
    if (!this.arriving) return false;
    this.clock = reduced ? Infinity : this.clock + dt;
    const { stagger, reveal, settle } = this.timing;
    let still = true;
    for (let i = 0; i < this.values.length; i++) {
      const progress = (this.clock - (this.hops[i] ?? 0) * stagger) / reveal;
      const value = easeAt(settle, progress);
      this.values[i] = value;
      if (value < 1) still = false;
    }
    this.arriving = !still;
    return true;
  }
}
