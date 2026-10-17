/**
 * A canvas's lints (plan 2026-10-02, decision 16; C23 §4.4): what is
 * probably a mistake on it, said so an agent that cannot see it can fix it.
 * Every canvas write answers the lints it made and the ones it cleared
 * (`lintDiff`), so a verb's receipt says what it broke.
 *
 * - `overlap`: two items take up the same room, one of them a solid
 *   (`overlaps`) — cards laid over one another on a plane are a pile, not
 *   a mistake.
 * - `floating`: an item is raised off the floor with nothing under it — no
 *   solid it rests on (`restingOn`), and no frame whose face it lies on.
 * - `missing-end`: an edge names an item the canvas does not hold.
 * - `missing-node`: an item stands for a node the store does not hold.
 * - `dead-link`: an item's link leads to a node the store does not hold,
 *   or to an item its canvas does not hold.
 * - `unreachable-page`: a page of the canvas's board that no chain of links
 *   leads to from the board (`./pages.ts`).
 * - `missing-group`: an item names a group that is not one (`parent`).
 * - `outside-frame`: an item belongs to a frame whose face no longer holds it.
 * - `orphan-comment`: an open comment thread has lost its pin — its node is
 *   on no card of the canvas, or its item is gone (`pinLost`). It stays on
 *   the canvas, pinned nowhere, until it is pinned again or resolved; a
 *   resolved thread is history, and is not flagged.
 */
import { boxFrame } from "./box.ts";
import { pinLost } from "./comments.ts";
import { canvasElevation, isGroupNode, type CanvasDoc, type CanvasNode } from "./doc.ts";
import type { CanvasItemLink } from "./links.ts";
import { canvasMembership, faceHolds } from "./membership.ts";
import { unreachablePages } from "./pages.ts";
import { isSolid, overlaps } from "./relations.ts";
import { restingOn } from "./snap.ts";
import { baseOf } from "./transform.ts";
import type { CanvasWorld } from "./world.ts";

export const CANVAS_LINT_RULES = [
  "overlap",
  "floating",
  "missing-end",
  "missing-node",
  "dead-link",
  "unreachable-page",
  "missing-group",
  "outside-frame",
  "orphan-comment",
] as const;
export type CanvasLintRule = (typeof CANVAS_LINT_RULES)[number];

/** One lint: its rule, the items or edges it is about, and what is wrong, in words. */
export interface CanvasLint {
  readonly rule: CanvasLintRule;
  readonly ids: readonly string[];
  readonly message: string;
}

/** How far off the floor, or off a frame's face, an item may be and still lie on it, canvas units. */
const LIES_ON = 2;

/** Whether `item`'s base lies on `frame`'s face: within a hair of its plane, and held by it. */
function liesOnFace(item: CanvasNode, frame: CanvasNode): boolean {
  const { centre, matrix } = boxFrame(frame);
  const base = baseOf(item);
  const off =
    (base.x - centre.x) * matrix[2] +
    (base.y - centre.y) * matrix[5] +
    (base.z - centre.z) * matrix[8];
  return Math.abs(off) <= LIES_ON && faceHolds(frame, item);
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Why `link`, on an item of `doc`, leads nowhere; undefined when it leads somewhere (or out of kb). */
function deadLink(link: CanvasItemLink, doc: CanvasDoc, world: CanvasWorld): string | undefined {
  if ("url" in link) return undefined;
  const node = "node" in link ? link.node : undefined;
  if (node !== undefined && world.textOf(node) === undefined) {
    return `leads to node ${node}, which is gone`;
  }
  if (link.item === undefined) return undefined;
  const target = node === undefined ? doc : world.docOf(node);
  const where = node === undefined ? "this canvas" : `canvas ${node}`;
  if (target === undefined) return `leads to item ${link.item} on ${node}, which is no canvas`;
  return target.nodes.some((item) => item.id === link.item)
    ? undefined
    : `leads to item ${link.item}, which is not on ${where}`;
}

/**
 * Every lint on `doc`, canvas `canvasId`'s document, in a stable order,
 * reading kb through `world` — in which `canvasId` holds `doc`.
 */
export function lintCanvas(canvasId: string, doc: CanvasDoc, world: CanvasWorld): CanvasLint[] {
  const lints: CanvasLint[] = [];
  const membership = canvasMembership(doc.nodes);
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const items = doc.nodes.filter((node) => !isGroupNode(node));
  items.forEach((a, i) => {
    for (const b of items.slice(i + 1)) {
      if ((isSolid(a) || isSolid(b)) && overlaps(a, b)) {
        lints.push({ rule: "overlap", ids: [a.id, b.id], message: `${a.id} and ${b.id} overlap` });
      }
    }
  });
  for (const item of items) {
    const z = canvasElevation(item);
    if (z <= LIES_ON || restingOn(item, items) !== null) continue;
    const parent = membership.parentOf(item.id);
    const frame = parent === null ? undefined : byId.get(parent);
    if (frame !== undefined && liesOnFace(item, frame)) continue;
    lints.push({
      rule: "floating",
      ids: [item.id],
      message: `${item.id} floats ${round(z)} above the floor with nothing under it`,
    });
  }
  for (const edge of doc.edges) {
    const gone = [edge.fromNode, edge.toNode].filter((end) => !byId.has(end));
    if (gone.length > 0) {
      lints.push({
        rule: "missing-end",
        ids: [edge.id],
        message: `edge ${edge.id} ends on ${gone.join(" and ")}, which is not on the canvas`,
      });
    }
  }
  for (const node of doc.nodes) {
    if (node.nodeId !== undefined && world.textOf(node.nodeId) === undefined) {
      lints.push({
        rule: "missing-node",
        ids: [node.id],
        message: `${node.id} stands for node ${node.nodeId}, which is gone`,
      });
    }
    const parent = membership.parentOf(node.id);
    if (node.parent !== undefined && parent === null) {
      lints.push({
        rule: "missing-group",
        ids: [node.id],
        message: `${node.id} belongs to ${node.parent}, which is not a frame it can be in`,
      });
    }
    const frame = parent === null ? undefined : byId.get(parent);
    if (frame !== undefined && !faceHolds(frame, node)) {
      lints.push({
        rule: "outside-frame",
        ids: [node.id],
        message: `${node.id} belongs to frame ${frame.id} but lies outside it`,
      });
    }
  }
  return [...lints, ...linkLints(canvasId, doc, world), ...commentLints(canvasId, doc, world)];
}

/** An open thread on the canvas that has lost its pin. */
function commentLints(canvasId: string, doc: CanvasDoc, world: CanvasWorld): CanvasLint[] {
  return world
    .threadsOn(canvasId)
    .filter((thread) => !thread.resolved && pinLost(thread.anchor, doc))
    .map((thread) => ({
      rule: "orphan-comment" as const,
      ids: [thread.id],
      message: `comment ${thread.id} ("${thread.text}") has lost its pin: what it was on is not on the canvas`,
    }));
}

/** The lints on where `doc`'s items lead: each dead link, then each page of its board no link reaches. */
function linkLints(canvasId: string, doc: CanvasDoc, world: CanvasWorld): CanvasLint[] {
  const dead = doc.nodes.flatMap((node) => {
    const why = node.link === undefined ? undefined : deadLink(node.link, doc, world);
    return why === undefined
      ? []
      : [{ rule: "dead-link" as const, ids: [node.id], message: `${node.id} ${why}` }];
  });
  const unreached = unreachablePages(world, canvasId).map((page) => ({
    rule: "unreachable-page" as const,
    ids: [page],
    message: `page ${world.textOf(page) ?? page} (${page}) is reached by no link from its board`,
  }));
  return [...dead, ...unreached];
}

/** A lint's identity across two readings of a canvas: its rule and what it is about. */
function lintKey(lint: CanvasLint): string {
  return `${lint.rule}:${lint.ids.join(",")}`;
}

/** What a write did to a canvas's lints: the ones it made, and the ones it cleared. */
export interface CanvasLintDiff {
  readonly new: readonly CanvasLint[];
  readonly resolved: readonly CanvasLint[];
}

/** The lints in `after` that `before` lacked, and those in `before` that `after` lacks. */
export function lintDiff(
  before: readonly CanvasLint[],
  after: readonly CanvasLint[],
): CanvasLintDiff {
  const was = new Set(before.map(lintKey));
  const is = new Set(after.map(lintKey));
  return {
    new: after.filter((lint) => !was.has(lintKey(lint))),
    resolved: before.filter((lint) => !is.has(lintKey(lint))),
  };
}
