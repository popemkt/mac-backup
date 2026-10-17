/**
 * Comments on a canvas (DESIGN.md → Canvas documents → Comments): a thread
 * is a `#comment` node pinned on a canvas, its replies its children. It is
 * a backlink of its canvas and of the node it is about, `describe` lists it
 * with its pin and whether it is resolved, and an open thread whose pin is
 * gone from the canvas is linted as an orphan.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANVAS_IDS, threadProps, type CommentAnchor } from "@kb/canvas";
import type { ActionReceipt, KbContext } from "@kb/contracts";
import { backlinksQuery } from "@kb/query";
import { invoke } from "../src/invoke.ts";
import { resetRegistryCache } from "../src/registry.ts";
import { openKb } from "../src/session.ts";

function output(receipt: ActionReceipt): Record<string, unknown> {
  if (receipt.status !== "succeeded") throw new Error(JSON.stringify(receipt));
  return receipt.output as Record<string, unknown>;
}

const card = (id: string, nodeId: string) => ({
  id,
  type: "kb-node",
  nodeId,
  x: 0,
  y: 0,
  width: 200,
  height: 80,
});
const shape = (id: string) => ({
  id,
  type: "text",
  text: id,
  x: 400,
  y: 0,
  width: 200,
  height: 80,
});

/** Write a thread on `n.canvas` pinned at `anchor`, the way the page and the verb write one. */
const thread = (ctx: KbContext, id: string, text: string, anchor: CommentAnchor) =>
  invoke(ctx, {
    id: "node.add",
    input: {
      id,
      text,
      tags: ["comment"],
      parent: "n.canvas",
      props: Object.entries(threadProps("n.canvas", anchor)).map(([field, value]) => ({
        field,
        value,
      })),
    },
  });

const describeComments = async (ctx: KbContext) =>
  output(await invoke(ctx, { id: "ext.canvas.describe", input: { canvasId: "n.canvas" } }));

describe("comments on a canvas", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-canvas-comments-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    resetRegistryCache();
  });

  test("a thread is a backlink of its canvas and its node, listed by describe with its replies", async () => {
    const ctx = await openKb(root);
    await invoke(ctx, {
      id: "node.add",
      input: { id: "n.canvas", text: "Board", tags: ["canvas"] },
    });
    await invoke(ctx, { id: "node.add", input: { id: "n.topic", text: "Topic" } });
    output(
      await invoke(ctx, {
        id: "ext.canvas.tx.apply",
        input: {
          canvasId: "n.canvas",
          doc: { nodes: [card("c1", "n.topic"), shape("s1")], edges: [] },
        },
      }),
    );
    output(await thread(ctx, "k.topic", "Is this right?", { node: "n.topic" }));
    output(await thread(ctx, "k.shape", "Move this", { item: "s1" }));
    output(await thread(ctx, "k.point", "Room here", { at: { x: 900, y: 40 } }));
    output(
      await invoke(ctx, {
        id: "node.add",
        input: { id: "k.reply", text: "Yes", tags: ["comment"], parent: "k.topic" },
      }),
    );

    const referrers = async (id: string) =>
      (
        output(await invoke(ctx, { id: "graph.query", input: { query: backlinksQuery(id) } }))
          .rows as unknown[][]
      )
        .map((row) => String(row[0]))
        .toSorted((a, b) => a.localeCompare(b));
    expect(await referrers("n.topic")).toEqual(["k.topic", "n.canvas"]);
    expect(await referrers("n.canvas")).toEqual(["k.point", "k.shape", "k.topic"]);

    const told = await describeComments(ctx);
    expect(told.comments).toEqual([
      {
        id: "k.topic",
        text: "Is this right?",
        canvas: "n.canvas",
        anchor: { node: "n.topic" },
        resolved: false,
        replies: [{ id: "k.reply", text: "Yes" }],
      },
      expect.objectContaining({ id: "k.shape", anchor: { item: "s1" }, replies: [] }),
      expect.objectContaining({ id: "k.point", anchor: { at: { x: 900, y: 40 } } }),
    ]);

    // Resolving is writing its state, as any option field is written.
    output(
      await invoke(ctx, {
        id: "node.update",
        input: {
          id: "k.shape",
          unsetProps: [{ field: CANVAS_IDS.commentStateField }],
          setProps: [
            {
              field: CANVAS_IDS.commentStateField,
              value: { t: "ref", v: CANVAS_IDS.commentResolved },
            },
          ],
        },
      }),
    );
    expect((await describeComments(ctx)).comments).toContainEqual(
      expect.objectContaining({ id: "k.shape", resolved: true }),
    );
  });

  test("an open thread whose pin leaves the canvas is an orphan; a resolved one, or a point, is not", async () => {
    const ctx = await openKb(root);
    await invoke(ctx, {
      id: "node.add",
      input: { id: "n.canvas", text: "Board", tags: ["canvas"] },
    });
    await invoke(ctx, { id: "node.add", input: { id: "n.topic", text: "Topic" } });
    const write = async (nodes: unknown[]) =>
      output(
        await invoke(ctx, {
          id: "ext.canvas.tx.apply",
          input: { canvasId: "n.canvas", doc: { nodes, edges: [] } },
        }),
      );
    await write([card("c1", "n.topic"), shape("s1"), shape("s2")]);
    output(await thread(ctx, "k.topic", "On the topic", { node: "n.topic" }));
    output(await thread(ctx, "k.shape", "On s1", { item: "s1" }));
    output(await thread(ctx, "k.done", "On s2, done", { item: "s2" }));
    output(await thread(ctx, "k.point", "Here", { at: { x: 0, y: 500 } }));
    output(
      await invoke(ctx, {
        id: "node.update",
        input: {
          id: "k.done",
          unsetProps: [{ field: CANVAS_IDS.commentStateField }],
          setProps: [
            {
              field: CANVAS_IDS.commentStateField,
              value: { t: "ref", v: CANVAS_IDS.commentResolved },
            },
          ],
        },
      }),
    );

    // The write that takes the card and the shapes away says what it orphaned.
    const cleared = await write([]);
    expect(
      (cleared.lints as { new: { rule: string; ids: string[] }[] }).new
        .filter((lint) => lint.rule === "orphan-comment")
        .map((lint) => lint.ids),
    ).toEqual([["k.topic"], ["k.shape"]]);
  });
});
