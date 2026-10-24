// View models over one composition and manifest. Every view (the list, the treemap, the kb export) reads the same
// tree, so a new view is a new renderer, not a new model.
import { isIncluded, KIND_LABELS, startTokensOf, tokensOf, type Artifact, type ArtifactKind, type Composition, type Manifest, type Source } from "./model.ts";

export type WeightNode = {
  id: string;
  label: string;
  /** Tokens counted (unknown weights count 0). */
  tokens: number;
  included: boolean;
  kind?: ArtifactKind;
  source?: Source;
  artifact?: Artifact;
  children: WeightNode[];
};

export type Grouping = "source" | "kind";

/**
 * Root → group (a source, or a kind) → artifact, heaviest first. Inactive artifacts are left out unless the manifest
 * adds them. Deferred artifacts weigh nothing at session start; `onDemand` weighs them by what they load when used.
 */
export function weightTree(c: Composition, m: Manifest, by: Grouping = "source", opts: { onDemand?: boolean } = {}): WeightNode {
  const weigh = opts.onDemand === true ? tokensOf : startTokensOf;
  const sources = new Map(c.sources.map(s => [s.id, s]));
  const groups = new Map<string, WeightNode>();
  for (const a of c.artifacts) {
    if (!a.active && m.decisions[a.id] === undefined) continue;
    const key = by === "source" ? a.sourceId : a.kind;
    let g = groups.get(key);
    if (g === undefined) {
      const source = sources.get(a.sourceId);
      g =
        by === "source"
          ? { id: key, label: source?.label ?? key, tokens: 0, included: false, source, children: [] }
          : { id: key, label: KIND_LABELS[a.kind], tokens: 0, included: false, kind: a.kind, children: [] };
      groups.set(key, g);
    }
    const included = isIncluded(a, m);
    g.children.push({ id: a.id, label: a.name, tokens: weigh(a), included, kind: a.kind, artifact: a, children: [] });
  }
  const children = [...groups.values()];
  for (const g of children) {
    g.children.sort((x, y) => y.tokens - x.tokens || x.label.localeCompare(y.label));
    g.tokens = g.children.reduce((n, x) => n + x.tokens, 0);
    g.included = g.children.some(x => x.included);
  }
  children.sort((x, y) => y.tokens - x.tokens || x.label.localeCompare(y.label));
  return { id: "root", label: c.basis.providerName, tokens: children.reduce((n, g) => n + g.tokens, 0), included: true, children };
}

// ------------------------------------------------------------------ treemap

export type Rect = { x: number; y: number; w: number; h: number };
export type Tile = Rect & { node: WeightNode; depth: number };

/** Squarified treemap (Bruls, Huizing, van Wijk) of the weighted nodes inside a rectangle. Zero weights get no tile. */
export function squarify(nodes: readonly WeightNode[], rect: Rect): { node: WeightNode; rect: Rect }[] {
  const items = nodes.filter(n => n.tokens > 0).sort((a, b) => b.tokens - a.tokens);
  const total = items.reduce((n, x) => n + x.tokens, 0);
  if (total === 0 || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const out: { node: WeightNode; rect: Rect }[] = [];
  let free = { ...rect };
  let row: WeightNode[] = [];
  const worst = (r: WeightNode[], side: number) => {
    const areas = r.map(n => n.tokens * scale);
    const sum = areas.reduce((a, b) => a + b, 0);
    const max = Math.max(...areas);
    const min = Math.min(...areas);
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };
  const lay = (r: WeightNode[]) => {
    const sum = r.reduce((n, x) => n + x.tokens * scale, 0);
    if (free.w >= free.h) {
      const w = sum / free.h;
      let y = free.y;
      for (const n of r) {
        const h = (n.tokens * scale) / w;
        out.push({ node: n, rect: { x: free.x, y, w, h } });
        y += h;
      }
      free = { x: free.x + w, y: free.y, w: free.w - w, h: free.h };
    } else {
      const h = sum / free.w;
      let x = free.x;
      for (const n of r) {
        const w = (n.tokens * scale) / h;
        out.push({ node: n, rect: { x, y: free.y, w, h } });
        x += w;
      }
      free = { x: free.x, y: free.y + h, w: free.w, h: free.h - h };
    }
  };
  for (const n of items) {
    const side = Math.min(free.w, free.h);
    if (row.length === 0 || worst([...row, n], side) <= worst(row, side)) row.push(n);
    else {
      lay(row);
      row = [n];
    }
  }
  if (row.length > 0) lay(row);
  return out;
}

/** Two levels of tiles: each group, and its artifacts inside it below a header strip. */
export function treemap(root: WeightNode, rect: Rect, header = 16): Tile[] {
  const tiles: Tile[] = [];
  for (const g of squarify(root.children, rect)) {
    tiles.push({ ...g.rect, node: g.node, depth: 1 });
    const inner = { x: g.rect.x + 1, y: g.rect.y + header, w: g.rect.w - 2, h: g.rect.h - header - 1 };
    if (inner.w < 4 || inner.h < 4) continue;
    for (const a of squarify(g.node.children, inner)) tiles.push({ ...a.rect, node: a.node, depth: 2 });
  }
  return tiles;
}
