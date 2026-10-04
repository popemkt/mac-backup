/**
 * Groups and frames, which are one concept (plan 2026-10-02, decision 12).
 * A group is a `group` item, drawn as a frame, and an item belongs to it
 * when its `parent` names it; groups nest to any depth. Membership is
 * stored, never inferred on read: geometry only proposes it when an item
 * is placed or let go (`settleMembership`), tldraw's and Obsidian's frame
 * gesture, and ⌘G states it outright (`groupItems`).
 *
 * A group carries its members. Whatever moves, turns or scales it moves,
 * turns or scales them by the same motion; whatever deletes or copies it
 * deletes or copies them (`carriedBy`). Members are stored in world
 * coordinates like every item, so a group's transform rewrites their
 * records and nothing reads a matrix stack.
 */
import { boxBounds, boxFrame, boxToLocal, boxTop, type CanvasBox } from "./box.ts";
import {
  isGroupNode,
  withElevation,
  withParent,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasGroupNode,
  type CanvasNode,
} from "./doc.ts";
import {
  isStill,
  motionBetween,
  motionOf,
  transformItems,
  type CanvasTransform,
} from "./transform.ts";

/** Who belongs to whom on one canvas, as its items' `parent`s say. */
export interface CanvasMembership {
  /** Whether `id` is a group: an item others may belong to. */
  readonly isGroup: (id: string) => boolean;
  /** The group `id` belongs to, or null for one that belongs to the canvas itself. */
  readonly parentOf: (id: string) => string | null;
  /** The items that belong to `group` directly (null: the canvas), in document order. */
  readonly membersOf: (group: string | null) => readonly string[];
}

const NONE: readonly string[] = Object.freeze([]);

/**
 * The group `node` belongs to: its `parent`, when that names a group on the
 * canvas and following parents up from there never comes back to `node`
 * (every item on a cycle belongs to the canvas itself).
 */
function honouredParent(node: CanvasNode, byId: ReadonlyMap<string, CanvasNode>): string | null {
  const named = node.parent;
  if (named === undefined) return null;
  const group = byId.get(named);
  if (group === undefined || !isGroupNode(group)) return null;
  const seen = new Set<string>();
  for (let at: string | undefined = named; at !== undefined; at = byId.get(at)?.parent) {
    if (at === node.id) return null;
    if (seen.has(at)) break;
    seen.add(at);
  }
  return named;
}

export function canvasMembership(nodes: readonly CanvasNode[]): CanvasMembership {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parents = new Map<string, string | null>();
  const members = new Map<string | null, string[]>();
  for (const node of nodes) {
    const parent = honouredParent(node, byId);
    parents.set(node.id, parent);
    const siblings = members.get(parent);
    if (siblings === undefined) members.set(parent, [node.id]);
    else siblings.push(node.id);
  }
  return {
    isGroup: (id) => {
      const node = byId.get(id);
      return node !== undefined && isGroupNode(node);
    },
    parentOf: (id) => parents.get(id) ?? null,
    membersOf: (group) => members.get(group) ?? NONE,
  };
}

/** The groups `id` belongs to, innermost first. */
export function ancestorsOf(membership: CanvasMembership, id: string): string[] {
  const chain: string[] = [];
  for (let at = membership.parentOf(id); at !== null; at = membership.parentOf(at)) chain.push(at);
  return chain;
}

/** Whether `id` belongs to `group`, at any depth. */
export function isWithin(membership: CanvasMembership, id: string, group: string): boolean {
  return ancestorsOf(membership, id).includes(group);
}

/** Every member of `groups`, at any depth, not counting the groups themselves. */
function membersBelow(membership: CanvasMembership, groups: Iterable<string>): string[] {
  const below: string[] = [];
  const queue = [...groups];
  for (let group = queue.shift(); group !== undefined; group = queue.shift()) {
    for (const member of membership.membersOf(group)) {
      below.push(member);
      queue.push(member);
    }
  }
  return below;
}

/**
 * What an act on some items carries: the items it names, the lead first —
 * those of them no other of them holds — and every member below them,
 * which follows them.
 */
export interface CanvasCarried {
  readonly items: readonly CanvasNode[];
  readonly members: readonly CanvasNode[];
}

/** What naming `ids` carries on a canvas of `nodes` (ids it does not hold are left out). */
export function carriedBy(nodes: readonly CanvasNode[], ids: Iterable<string>): CanvasCarried {
  const membership = canvasMembership(nodes);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const named = new Set([...ids].filter((id) => byId.has(id)));
  const items = [...named]
    .filter((id) => !ancestorsOf(membership, id).some((group) => named.has(group)))
    .flatMap((id) => byId.get(id) ?? []);
  const members = membersBelow(
    membership,
    items.map((item) => item.id),
  ).flatMap((id) => byId.get(id) ?? []);
  return { items, members };
}

/** The ids `ids` carry: themselves and every member below them. */
export function withMembers(nodes: readonly CanvasNode[], ids: Iterable<string>): Set<string> {
  const { items, members } = carriedBy(nodes, ids);
  return new Set([...items, ...members].map((node) => node.id));
}

/**
 * `doc` with `carried` transformed by `t` from the records it holds: its
 * items by `t` whole, their members by the motion of space `t` makes
 * (`motionOf`), so an extrude grows the items it names and no member.
 */
export function transformCarried(
  doc: CanvasDoc,
  carried: CanvasCarried,
  t: CanvasTransform,
): CanvasDoc {
  return transformItems(transformItems(doc, carried.items, t), carried.members, motionOf(t));
}

/**
 * `doc` with item `after` written over the item of its id, and that item's
 * members carried by the motion its base made (`motionBetween`): an edit to
 * a group's box — its lift, its turn — moves what stands on it, as its
 * transform would.
 */
export function editItem(doc: CanvasDoc, after: CanvasNode): CanvasDoc {
  const before = doc.nodes.find((node) => node.id === after.id);
  if (before === undefined) return { ...doc, nodes: [...doc.nodes, after] };
  const written = { ...doc, nodes: doc.nodes.map((node) => (node.id === after.id ? after : node)) };
  const motion = motionBetween(before, after);
  if (isStill(motion)) return written;
  const { members } = carriedBy(doc.nodes, [after.id]);
  return transformItems(written, members, motion);
}

/** How much of the floor a footprint covers, canvas units squared. */
const area = (node: CanvasNode) => node.width * node.height;

/**
 * Whether `frame`'s face covers `item`'s centre as the frame's own face-on
 * view sees it: the centre, carried along the frame's normal onto its
 * plane, lies inside its footprint. How far in front of or behind the face
 * it is plays no part, so a frame on the floor holds what stands over it
 * whatever its height, and one stood up as a wall what is laid on its face.
 * Strictly inside: the floor at a wall's foot is at its edge, and not on it.
 */
export function faceHolds(frame: CanvasNode, item: CanvasBox): boolean {
  const own = boxFrame(frame);
  const local = boxToLocal(own, boxFrame(item).centre);
  return Math.abs(local.x) < own.half.x && Math.abs(local.y) < own.half.y;
}

/**
 * The frame that holds `item` on a canvas of `nodes`: of the groups no
 * smaller than it whose face its centre is on, seen face-on (`faceCovers`)
 * — never itself or one of its own members — the innermost, nested
 * deepest, and of those the one drawn on top there; null when none does. A
 * frame as large as its one member (⌘G with no padding) still holds it.
 */
function frameHolding(
  nodes: readonly CanvasNode[],
  membership: CanvasMembership,
  item: CanvasNode,
): string | null {
  let holder: { readonly id: string; readonly depth: number } | null = null;
  for (const node of paintOrder(nodes)) {
    if (!isGroupNode(node) || node.id === item.id || area(node) < area(item)) continue;
    if (isWithin(membership, node.id, item.id) || !faceHolds(node, item)) continue;
    // Later in paint order wins a tie of depth: `>=`.
    const depth = ancestorsOf(membership, node.id).length;
    if (holder === null || depth >= holder.depth) holder = { id: node.id, depth };
  }
  return holder?.id ?? null;
}

/**
 * `doc` with each of `ids` belonging to the frame that holds it, or to the
 * canvas when none does: what placing an item or letting it go means. An
 * item already where it belongs is left untouched.
 */
export function settleMembership(doc: CanvasDoc, ids: Iterable<string>): CanvasDoc {
  let nodes = doc.nodes;
  for (const id of ids) {
    const item = nodes.find((node) => node.id === id);
    if (item === undefined) continue;
    const holder = frameHolding(nodes, canvasMembership(nodes), item) ?? undefined;
    if (item.parent === holder) continue;
    const settled = withParent(item, holder);
    nodes = nodes.map((node) => (node.id === id ? settled : node));
  }
  return nodes === doc.nodes ? doc : { ...doc, nodes };
}

/**
 * `doc` with `items` written in where they were placed — new items, or
 * items written over the ones of their ids — each belonging to the frame
 * that holds it there: how any item lands, whatever placed it.
 */
export function placeItems(doc: CanvasDoc, items: readonly CanvasNode[]): CanvasDoc {
  const placed = new Map(items.map((item) => [item.id, item]));
  const kept = doc.nodes.map((node) => {
    const item = placed.get(node.id);
    placed.delete(node.id);
    return item ?? node;
  });
  return settleMembership(
    { ...doc, nodes: [...kept, ...placed.values()] },
    items.map((item) => item.id),
  );
}

/**
 * `doc` with `ids` gathered into a new group `id`, a frame round them with
 * `pad` to spare on the floor plan, standing at the lowest base among them.
 * It belongs where they all did, when that was one group, and is written
 * just before the first of them, so it lies under them in paint order too.
 */
export function groupItems(doc: CanvasDoc, ids: Iterable<string>, id: string, pad = 0): CanvasDoc {
  const { items, members } = carriedBy(doc.nodes, ids);
  const bounds = boxBounds([...items, ...members]);
  if (bounds === null) return doc;
  const { min, max } = bounds;
  const membership = canvasMembership(doc.nodes);
  const homes = new Set(items.map((item) => membership.parentOf(item.id)));
  const home = homes.size === 1 ? ([...homes][0] ?? undefined) : undefined;
  const frame: CanvasGroupNode = withParent(
    withElevation(
      {
        id,
        type: "group",
        x: min.x - pad,
        y: min.y - pad,
        width: max.x - min.x + pad * 2,
        height: max.y - min.y + pad * 2,
      },
      min.z,
    ),
    home,
  );
  const named = new Set(items.map((item) => item.id));
  const at = doc.nodes.findIndex((node) => named.has(node.id));
  const nodes = doc.nodes.map((node) => (named.has(node.id) ? withParent(node, id) : node));
  return { ...doc, nodes: [...nodes.slice(0, at), frame, ...nodes.slice(at)] };
}

/**
 * `doc` with the groups among `ids` taken apart: each goes, with the edges
 * that end on it, and its members belong where it did. `released` are its
 * members, which the selection becomes.
 */
export function ungroupItems(
  doc: CanvasDoc,
  ids: Iterable<string>,
): { readonly doc: CanvasDoc; readonly released: readonly string[] } {
  const membership = canvasMembership(doc.nodes);
  const gone = new Set([...ids].filter((id) => membership.isGroup(id)));
  if (gone.size === 0) return { doc, released: [] };
  /** Where an item of a group that goes now belongs: the first group above that stays. */
  const home = (id: string): string | undefined =>
    ancestorsOf(membership, id).find((group) => !gone.has(group));
  const released = [...gone].flatMap((group) => membership.membersOf(group));
  const freed = new Set(released);
  const nodes = doc.nodes
    .filter((node) => !gone.has(node.id))
    .map((node) => (freed.has(node.id) ? withParent(node, home(node.id)) : node));
  const edges = doc.edges.filter((edge) => !gone.has(edge.fromNode) && !gone.has(edge.toNode));
  return {
    doc: { ...doc, nodes, edges },
    released: released.filter((id) => !gone.has(id)),
  };
}

/**
 * `source`'s items and the edges between them, written into `doc` under new
 * ids (`newId`) and `offset` across the floor: a paste, or a duplicate. A
 * member whose group came too belongs to the group's copy; the rest are
 * placed, and belong to the frame that holds them there. Returns the ids a
 * selection takes — the placed items, whose members come with them — and
 * the edges written.
 */
export function pasteItems(
  doc: CanvasDoc,
  source: CanvasDoc,
  offset: { readonly x: number; readonly y: number },
  newId: () => string,
): { readonly doc: CanvasDoc; readonly nodeIds: string[]; readonly edgeIds: string[] } {
  const ids = new Map(source.nodes.map((node) => [node.id, newId()]));
  const fresh = (id: string) => ids.get(id) ?? id;
  const copies = source.nodes.map((node) =>
    withParent(
      { ...node, id: fresh(node.id), x: node.x + offset.x, y: node.y + offset.y },
      node.parent === undefined ? undefined : ids.get(node.parent),
    ),
  );
  // A parent the copies cannot honour among themselves (one left behind, or a cycle) is dropped.
  const among = canvasMembership(copies);
  const nodes = copies.map((node) => withParent(node, among.parentOf(node.id) ?? undefined));
  const placed = nodes.filter((node) => node.parent === undefined);
  const edges: CanvasEdge[] = source.edges.flatMap((edge) => {
    const fromNode = ids.get(edge.fromNode);
    const toNode = ids.get(edge.toNode);
    return fromNode === undefined || toNode === undefined
      ? []
      : [{ ...edge, id: newId(), fromNode, toNode }];
  });

  const written = placeItems(
    { ...doc, nodes: [...doc.nodes, ...nodes], edges: [...doc.edges, ...edges] },
    placed,
  );
  return {
    doc: written,
    nodeIds: placed.map((node) => node.id),
    edgeIds: edges.map((edge) => edge.id),
  };
}

/**
 * The part of `doc` that `ids` carry, and the edges inside it plus any of
 * `edgeIds`: what a copy takes, and a duplicate.
 */
export function carriedPart(
  doc: CanvasDoc,
  ids: Iterable<string>,
  edgeIds: ReadonlySet<string> = new Set(),
): CanvasDoc {
  const taken = withMembers(doc.nodes, ids);
  return {
    nodes: doc.nodes.filter((node) => taken.has(node.id)),
    edges: doc.edges.filter(
      (edge) => edgeIds.has(edge.id) || (taken.has(edge.fromNode) && taken.has(edge.toNode)),
    ),
  };
}

/**
 * The frames a canvas is seen through, in document order: its groups that
 * belong to no other. "Go to frame" and present mode step through them
 * (plan decision 7: saved viewpoints are frames).
 */
export function viewpointFrames(
  nodes: readonly CanvasNode[],
  membership: CanvasMembership = canvasMembership(nodes),
): CanvasGroupNode[] {
  return nodes.filter(
    (node): node is CanvasGroupNode => isGroupNode(node) && membership.parentOf(node.id) === null,
  );
}

/**
 * Items back to front: by the height of their top surface; at one height a
 * group before its members, at any depth, and otherwise in document order,
 * which bring-to-front and send-to-back rearrange. Every projection paints
 * and hit-tests in this order, so from the top a higher item covers a lower
 * one and a frame lies under what belongs to it.
 */
// A cone or a sphere is ordered by its point, so from the top a raised card
// over its low rim paints under it there; a tilted item is ordered by its
// highest corner, so the same holds over its low side.
// GAP [[01M41GAYYABEV7H197ZPAVD260]]
export function paintOrder(nodes: readonly CanvasNode[]): CanvasNode[] {
  const membership = canvasMembership(nodes);
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  // Each item's place in the tree: the document index of every group above it, then its own.
  const place = (node: CanvasNode) =>
    [...ancestorsOf(membership, node.id).toReversed(), node.id].map((id) => index.get(id) ?? 0);
  const keyed = nodes.map((node) => ({ node, top: boxTop(node), place: place(node) }));
  return keyed.toSorted((a, b) => a.top - b.top || byPlace(a.place, b.place)).map((k) => k.node);
}

/** Tree order: a group before what belongs to it, and siblings in document order. */
function byPlace(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}
