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
 * - `missing-group`: an item names a group that is not one (`parent`).
 * - `outside-frame`: an item belongs to a frame whose face no longer holds it.
 */
import { boxFrame } from "./box.ts";
import { canvasElevation, isGroupNode, type CanvasDoc, type CanvasNode } from "./doc.ts";
import { canvasMembership, faceHolds } from "./membership.ts";
import { isSolid, overlaps } from "./relations.ts";
import { restingOn } from "./snap.ts";
import { baseOf } from "./transform.ts";

export const CANVAS_LINT_RULES = [
  "overlap",
  "floating",
  "missing-end",
  "missing-node",
  "missing-group",
  "outside-frame",
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

/**
 * Every lint on `doc`, in a stable order. `nodeExists` says whether the
 * store holds a node an item stands for.
 */
export function lintCanvas(doc: CanvasDoc, nodeExists: (id: string) => boolean): CanvasLint[] {
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
    if (node.nodeId !== undefined && !nodeExists(node.nodeId)) {
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
  return lints;
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
