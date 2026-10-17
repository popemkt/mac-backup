/**
 * A diagram (DESIGN.md → Canvas documents → Diagram): boxes and the links
 * among them drawn as a canvas that flows one way. Each box sits in a rank,
 * one past the furthest box that links into it, so links run with the flow;
 * a link that would run against it (a cycle) is drawn, but does not rank.
 * Each rank is laid out by `arrangeItems` as a row across the flow (a column
 * when the flow runs across), centred on the widest; a flow up or to the
 * left is the flow down or to the right mirrored (`flipItems`). Each link is
 * an edge between its two boxes (`connectItems`), bound to them. A datalog
 * query's nodes and the graph's edges among them make one spec, mermaid
 * flowchart text another (`mermaidDiagram`); this is the one layout both
 * are drawn with.
 */
import { boxBounds, type CanvasBounds } from "./box.ts";
import { connectItems } from "./connect.ts";
import { EMPTY_CANVAS_DOC, type CanvasDoc, type CanvasHead } from "./doc.ts";
import { arrangeItems, flipItems } from "./arrange.ts";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- makeItem builds a plain item record; it is no Effect service
import { makeItem, type CanvasItemSpec } from "./presets.ts";
import { CanvasRelationError } from "./relations.ts";
import type { CanvasLooksPatch } from "./style.ts";

/** The way a diagram flows: the way its links run, rank to rank. */
export const DIAGRAM_FLOWS = ["down", "up", "right", "left"] as const;
export type DiagramFlow = (typeof DIAGRAM_FLOWS)[number];

/** A box: its key, which its links name it by and its item's id is, and the item it is. */
export interface DiagramBox {
  readonly key: string;
  readonly item: CanvasItemSpec;
}

/** A link from one box to another, labelled, headed and looking as it says. */
export interface DiagramLink {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly fromHead?: CanvasHead | null;
  readonly toHead?: CanvasHead | null;
  readonly style?: CanvasLooksPatch;
  /** The ref field the link is, from `from`'s node to `to`'s, which both boxes show (`connectItems`). */
  readonly bindField?: string;
}

export interface DiagramSpec {
  readonly boxes: readonly DiagramBox[];
  readonly links: readonly DiagramLink[];
  readonly flow: DiagramFlow;
}

/**
 * The most boxes and links one diagram draws, whichever text made it: past
 * it, a picture of the set is the graph's to draw, not a canvas's.
 */
export const DIAGRAM_LIMITS = { boxes: 200, links: 400 } as const;

/** Why a diagram past `DIAGRAM_LIMITS` in `part` is refused, when it has `has` of them. */
export function pastDiagramLimit(part: keyof typeof DIAGRAM_LIMITS, has: number | string): string {
  return `this diagram has ${has} ${part}; one draws ${DIAGRAM_LIMITS[part]} at most`;
}

/** The room between one rank and the next, canvas units: enough for a link and its label. */
const RANK_GAP = 120;
/** The room between neighbours in a rank: enough for two links leaving one box to part. */
const BOX_GAP = 60;

/** Each box's rank: one past the furthest box linking into it, over the links that run with the flow. */
function ranksOf(keys: readonly string[], links: readonly DiagramLink[]): Map<string, number> {
  const out = new Map(keys.map((key) => [key, [] as string[]]));
  for (const link of links) out.get(link.from)?.push(link.to);
  // Depth first, in the order the boxes are named: a link back onto a box still
  // being walked closes a cycle and does not rank.
  const walking = new Set<string>();
  const done = new Set<string>();
  const finished: string[] = [];
  const forward: [string, string][] = [];
  const walk = (key: string): void => {
    walking.add(key);
    for (const to of out.get(key) ?? []) {
      if (walking.has(to)) continue;
      forward.push([key, to]);
      if (!done.has(to)) walk(to);
    }
    walking.delete(key);
    done.add(key);
    finished.push(key);
  };
  for (const key of keys) if (!done.has(key)) walk(key);
  const rank = new Map(keys.map((key) => [key, 0]));
  for (const key of finished.toReversed()) {
    for (const [from, to] of forward) {
      if (from !== key) continue;
      rank.set(to, Math.max(rank.get(to) ?? 0, (rank.get(from) ?? 0) + 1));
    }
  }
  return rank;
}

/**
 * The boxes of each rank, in order: the first rank as named, every other
 * by where the boxes linking into each stand in the rank before (their
 * mean), so links cross as little as one pass can make them.
 */
function rankRows(spec: DiagramSpec): string[][] {
  const keys = spec.boxes.map((box) => box.key);
  const rank = ranksOf(keys, spec.links);
  const rows: string[][] = [];
  for (const key of keys) {
    const r = rank.get(key) ?? 0;
    (rows[r] ??= []).push(key);
  }
  const at = new Map<string, number>();
  return rows.map((row) => {
    const mean = (key: string): number => {
      const from = spec.links.flatMap((link) => {
        const i = link.to === key ? at.get(link.from) : undefined;
        return i === undefined ? [] : [i];
      });
      return from.length === 0 ? Infinity : from.reduce((sum, i) => sum + i, 0) / from.length;
    };
    const ordered = row
      .map((key, i) => ({ key, i, by: mean(key) }))
      .toSorted((a, b) => a.by - b.by || a.i - b.i)
      .map(({ key }) => key);
    ordered.forEach((key, i) => at.set(key, i));
    return ordered;
  });
}

const extent = (bounds: CanvasBounds, axis: "x" | "y") => bounds.max[axis] - bounds.min[axis];

/**
 * The canvas `spec` draws: its boxes ranked down the flow and each rank laid
 * out across it, then its links. `mint` gives each edge its id and binding
 * id. Throws `CanvasRelationError` for a link to a box the spec does not
 * hold, or one `connectItems` refuses.
 */
export function diagramDoc(spec: DiagramSpec, mint: () => string): CanvasDoc {
  const over = (["boxes", "links"] as const).filter(
    (part) => spec[part].length > DIAGRAM_LIMITS[part],
  );
  if (over.length > 0) {
    throw new CanvasRelationError(
      over.map((part) => pastDiagramLimit(part, spec[part].length)).join("; "),
    );
  }
  const items = new Map(spec.boxes.map((box) => [box.key, makeItem(box.item, box.key)]));
  for (const link of spec.links) {
    for (const end of [link.from, link.to]) {
      if (!items.has(end)) throw new CanvasRelationError(`no box ${end} in this diagram`);
    }
  }
  const across = spec.flow === "down" || spec.flow === "up" ? "x" : "y";
  const along = across === "x" ? "y" : "x";
  const layout = across === "x" ? "row" : "column";
  const rows = rankRows(spec).map((keys) => {
    const row = keys.flatMap((key) => {
      const item = items.get(key);
      return item === undefined ? [] : [item];
    });
    // Laid out alone first, to know how wide and how thick the rank is.
    const alone = boxBounds(
      arrangeItems({ ...EMPTY_CANVAS_DOC, nodes: row }, keys, { layout, gap: BOX_GAP }).nodes,
    );
    return {
      keys,
      row,
      width: alone === null ? 0 : extent(alone, across),
      thick: alone === null ? 0 : extent(alone, along),
    };
  });
  const widest = Math.max(0, ...rows.map((row) => row.width));
  let doc: CanvasDoc = EMPTY_CANVAS_DOC;
  let cursor = 0;
  for (const { keys, row, width, thick } of rows) {
    const inset = (widest - width) / 2;
    const at = across === "x" ? { x: inset, y: cursor } : { x: cursor, y: inset };
    const placed = row.map((item) => ({ ...item, ...at }));
    doc = arrangeItems({ ...doc, nodes: [...doc.nodes, ...placed] }, keys, {
      layout,
      gap: BOX_GAP,
    });
    cursor += thick + RANK_GAP;
  }
  if (spec.flow === "up" || spec.flow === "left") {
    doc = flipItems(
      doc,
      spec.boxes.map((box) => box.key),
      along,
    );
  }
  for (const link of spec.links) {
    doc = connectItems(doc, {
      id: mint(),
      bindingId: mint(),
      from: link.from,
      to: link.to,
      ...(link.label === undefined ? {} : { label: link.label }),
      ...(link.fromHead === undefined ? {} : { fromHead: link.fromHead }),
      ...(link.toHead === undefined ? {} : { toHead: link.toHead }),
      ...(link.style === undefined ? {} : { style: link.style }),
      ...(link.bindField === undefined ? {} : { bindField: link.bindField }),
    }).doc;
  }
  return doc;
}
