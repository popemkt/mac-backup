/**
 * A canvas's pages (DESIGN.md → Canvas documents, Pages): a board is a
 * `#canvas` node whose parent is no canvas, and its pages are itself and
 * the canvases under it in the outline, through canvases only, in outline
 * order — so a page is a node like any other, named by its text, moved and
 * ordered as a node is, and a page's own pages are the board's too. What
 * leads from one page to another is an item's link (`link`).
 */
import type { NodeId } from "@kb/model";
import type { CanvasDoc } from "./doc.ts";
import { itemLead } from "./links.ts";
import type { CanvasWorld } from "./world.ts";

const isCanvas = (world: CanvasWorld, id: NodeId) => world.docOf(id) !== undefined;

/** The board canvas `id` is a page of: itself, or its highest ancestor reached through canvases. */
export function boardOf(world: CanvasWorld, id: NodeId): NodeId {
  let board = id;
  for (
    let up = world.parentOf(board);
    up !== undefined && isCanvas(world, up);
    up = world.parentOf(up)
  ) {
    board = up;
  }
  return board;
}

/** The pages of the board canvas `id` is on, the board first, then each canvas under it in outline order. */
export function canvasPages(world: CanvasWorld, id: NodeId): NodeId[] {
  const pages: NodeId[] = [];
  const visit = (page: NodeId) => {
    pages.push(page);
    for (const child of world.childrenOf(page)) if (isCanvas(world, child)) visit(child);
  };
  visit(boardOf(world, id));
  return pages;
}

/**
 * The name a new page takes among pages named `taken`: "Page N", N the
 * page it will be, or the next number no page is named by — so a page
 * deleted from the middle never makes a new one repeat a name.
 */
export function nextPageName(taken: readonly string[]): string {
  const names = new Set(taken);
  let n = taken.length + 1;
  while (names.has(`Page ${String(n)}`)) n += 1;
  return `Page ${String(n)}`;
}

/** The pages each page's items lead to (`link`), in its document. */
function linkedPages(doc: CanvasDoc, pages: ReadonlySet<NodeId>): NodeId[] {
  return doc.nodes.flatMap((item) => {
    const lead = itemLead(item);
    return lead !== undefined && "node" in lead && pages.has(lead.node) ? [lead.node] : [];
  });
}

/** The pages of `id`'s board that no chain of links leads to from the board. */
export function unreachablePages(world: CanvasWorld, id: NodeId): NodeId[] {
  const pages = canvasPages(world, id);
  const all = new Set(pages);
  const reached = new Set<NodeId>();
  const walk = (page: NodeId) => {
    if (reached.has(page)) return;
    reached.add(page);
    for (const next of linkedPages(world.docOf(page) ?? { nodes: [], edges: [] }, all)) walk(next);
  };
  walk(pages[0] ?? id);
  return pages.filter((page) => !reached.has(page));
}
