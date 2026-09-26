/**
 * Sigma's emphasis, eased: the one place the 2D renderers (force and
 * cluster) turn "what should be lit" into what is drawn.
 *
 * `sigma-graph` decides each node's target presence — the shared
 * search/filter/neighbourhood alpha, times the cluster isolation — and which
 * node is in focus. This owns the node and edge reducers and moves every
 * value toward its target through `lib/graph-fade` (Lab principles M1, M5):
 * a hover's neighbourhood fades in over `--motion-duration-quick` and fades
 * back out the same way, instead of snapping. A new graph also arrives, rather
 * than popping in: the hubs first, then their neighbours hop by hop, each
 * node growing and brightening into place (`lib/graph-arrival`, 300–400ms in
 * all) while the layout settles (P2).
 * Under reduced motion both are immediate (M7).
 *
 * Frames are drawn only while something eases; the loop stops by itself.
 */
import type Sigma from "sigma";
import { EmphasisFade } from "@/lib/graph-fade";
import { readTokenColor } from "@/lib/css-color";
import { premultipliedGraphColor } from "@/lib/graph-dim";
import { GraphArrival, hopsFromHubs, labelArrived } from "@/lib/graph-arrival";
import { clampStep, type Timing } from "@/lib/timing";

/** Presence under which a node's label is not drawn. */
const LABEL_PRESENCE = 0.6;
/** How much the node in focus swells, and how much its links widen. */
const FOCUS_SWELL = 0.2;
const FOCUS_WIDEN = 0.6;
/** A link away from the focus, while something is in focus. */
const ASIDE = 0.08;
/** How small a node starts when the graph arrives. */
const ARRIVE_FROM = 0.3;

interface SigmaTargets {
  /** The node in focus (selected, else hovered). */
  readonly active: string | null;
  /** Something narrows the view (a focus, a search, a filter): lit labels are forced. */
  readonly narrowed: boolean;
  /** A node's target presence, 0–1. */
  readonly presence: (id: string) => number;
}

export interface SigmaEmphasis {
  /** A new node set: index it, and let it arrive. */
  reindex(arrive: boolean): void;
  /** New targets; the values ease toward them. */
  retarget(targets: SigmaTargets): void;
  /** Ring colours, re-read on an appearance change. */
  setRings(rest: string, focus: string): void;
  dispose(): void;
}

export function sigmaEmphasis(sigma: Sigma, timing: Timing, reduced: () => boolean): SigmaEmphasis {
  const graph = sigma.getGraph();
  const presence = new EmphasisFade(0, timing.quick);
  const focus = new EmphasisFade(0, timing.quick, 0);
  let index = new Map<string, number>();
  let active: string | null = null;
  let narrowed = false;
  const arrival = new GraphArrival(timing);
  let ring = { rest: readTokenColor("--background"), focus: readTokenColor("--foreground") };
  let frame = 0;
  let last = -1;

  const at = (fade: EmphasisFade, id: string, fallback: number) =>
    fade.values[index.get(id) ?? -1] ?? fallback;
  const arrived = (id: string) => arrival.values[index.get(id) ?? -1] ?? 1;

  sigma.setSetting("nodeReducer", (id, data) => {
    const lit = at(presence, id, 1);
    const swell = at(focus, id, 0);
    const here = arrived(id);
    const grown = ARRIVE_FROM + (1 - ARRIVE_FROM) * here;
    return {
      ...data,
      color: premultipliedGraphColor(String(data.color), lit * here),
      ringColor: premultipliedGraphColor(swell > 0.5 ? ring.focus : ring.rest, lit * here),
      label: lit >= LABEL_PRESENCE && labelArrived(here) ? data.label : "",
      forceLabel: lit >= 0.95 && narrowed,
      highlighted: id === active,
      zIndex: id === active ? 2 : lit >= 0.95 ? 1 : 0,
      size: data.size * grown * (1 + FOCUS_SWELL * swell),
    };
  });
  sigma.setSetting("edgeReducer", (edge, data) => {
    const [a, b] = graph.extremities(edge);
    const near = Math.max(at(focus, a, 0), at(focus, b, 0));
    const lit = Math.min(at(presence, a, 1), at(presence, b, 1));
    // Toward the focus a link keeps its ends' presence; away from it, it recedes.
    const alpha = active === null ? lit : ASIDE + (lit - ASIDE) * near;
    return {
      ...data,
      color: premultipliedGraphColor(String(data.color), alpha * Math.min(arrived(a), arrived(b))),
      size: Number(data.size) * (1 + FOCUS_WIDEN * near),
      zIndex: near > 0.5 ? 1 : 0,
    };
  });

  const tick = (now: number) => {
    frame = 0;
    const dt = last < 0 ? 1 / 60 : clampStep((now - last) / 1000);
    last = now;
    const still = reduced();
    presence.step(dt, still);
    focus.step(dt, still);
    arrival.step(dt, still);
    sigma.refresh();
    if (presence.active || focus.active || arrival.active) frame = requestAnimationFrame(tick);
    else last = -1;
  };
  const play = () => {
    if (frame === 0) frame = requestAnimationFrame(tick);
  };

  return {
    reindex: (arrive) => {
      index = new Map(graph.nodes().map((id, i) => [id, i]));
      presence.reset(index.size);
      focus.reset(index.size, 0);
      const ids = graph.nodes();
      const hops = hopsFromHubs(
        ids.length,
        (i) => graph.degree(ids[i] ?? ""),
        (i) => graph.neighbors(ids[i] ?? "").map((n) => index.get(n) ?? 0),
      );
      arrival.start(hops, arrive && !reduced());
      if (arrival.active) play();
    },
    retarget: (targets) => {
      active = targets.active;
      narrowed = targets.narrowed;
      for (const [id, i] of index) {
        presence.setTarget(i, targets.presence(id));
        focus.setTarget(i, id === active ? 1 : 0);
      }
      if (reduced()) {
        presence.snap();
        focus.snap();
        sigma.refresh();
        return;
      }
      play();
    },
    setRings: (rest, focused) => {
      ring = { rest, focus: focused };
    },
    dispose: () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
