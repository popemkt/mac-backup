/**
 * How a comment is written (`commentWrite`): a thread under its canvas,
 * pinned on a card's node, an item or a point, and a reply under the
 * comment it answers, in its thread.
 */
import { describe, expect, test } from "bun:test";
import {
  CANVAS_IDS,
  CanvasRelationError,
  commentWrite,
  type CanvasDoc,
  type CanvasThread,
} from "../src/index.ts";

const doc: CanvasDoc = {
  nodes: [
    { id: "c1", type: "kb-node", nodeId: "n.topic", x: 0, y: 0, width: 200, height: 80 },
    { id: "s1", type: "text", text: "s1", x: 400, y: 0, width: 200, height: 80 },
  ],
  edges: [],
};
const threads: CanvasThread[] = [
  {
    id: "k.one",
    text: "One",
    canvas: "n.canvas",
    anchor: { item: "s1" },
    resolved: false,
    replies: [{ id: "k.reply", text: "Reply" }],
  },
];
const open = { t: "ref", v: CANVAS_IDS.commentOpen } as const;
const on = { t: "ref", v: "n.canvas" } as const;

describe("commentWrite", () => {
  test("a thread goes under its canvas, open, pinned on a card's node, an item or a point", () => {
    expect(commentWrite("n.canvas", { on: "c1" }, doc, threads)).toEqual({
      parent: "n.canvas",
      props: {
        [CANVAS_IDS.commentCanvasField]: on,
        [CANVAS_IDS.commentNodeField]: { t: "ref", v: "n.topic" },
        [CANVAS_IDS.commentStateField]: open,
      },
      thread: null,
    });
    expect(commentWrite("n.canvas", { on: "s1" }, doc, threads).props).toEqual({
      [CANVAS_IDS.commentCanvasField]: on,
      [CANVAS_IDS.commentItemField]: { t: "str", v: "s1" },
      [CANVAS_IDS.commentStateField]: open,
    });
    expect(commentWrite("n.canvas", { at: { x: 3, y: -4 } }, doc, threads).props).toEqual({
      [CANVAS_IDS.commentCanvasField]: on,
      [CANVAS_IDS.commentAtField]: { t: "str", v: "3,-4" },
      [CANVAS_IDS.commentStateField]: open,
    });
  });

  test("a reply goes under the comment it answers, in that comment's thread", () => {
    expect(commentWrite("n.canvas", { replyTo: "k.reply" }, doc, threads)).toEqual({
      parent: "k.reply",
      props: {},
      thread: "k.one",
    });
  });

  test("an item the canvas does not hold, or a comment of no thread on it, is refused", () => {
    expect(() => commentWrite("n.canvas", { on: "s9" }, doc, threads)).toThrow(CanvasRelationError);
    expect(() => commentWrite("n.canvas", { replyTo: "k.else" }, doc, threads)).toThrow(
      "no comment k.else on this canvas",
    );
  });
});
