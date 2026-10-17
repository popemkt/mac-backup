/**
 * Comments on a canvas (DESIGN.md → Canvas documents → Comments): a thread
 * is a `#comment` node pinned on a canvas, its replies its children. It is
 * a backlink of its canvas and of the node it is about, `describe` lists it
 * with its pin and whether it is resolved, and an open thread whose pin is
 * gone from the canvas is linted as an orphan. Threads and replies are
 * written through `ext.canvas.comment`, whose reach a script's grant bounds.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANVAS_IDS } from "@kb/canvas";
import type { ActionInvocation, ActionReceipt, KbContext } from "@kb/contracts";
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

/** Comment on `n.canvas` through the verb: a thread `on` an item or `at` a point, or a reply. */
const comment = (
  ctx: KbContext,
  input: Record<string, unknown>,
  rest: Partial<ActionInvocation> = {},
) => invoke(ctx, { id: "ext.canvas.comment", input: { canvasId: "n.canvas", ...input }, ...rest });
const thread = (ctx: KbContext, id: string, text: string, place: Record<string, unknown>) =>
  comment(ctx, { id, text, ...place });

/** Why `receipt` failed; it fails the test when it succeeded. */
async function failed(receipt: Promise<ActionReceipt>): Promise<string> {
  const told = await receipt;
  if (told.status !== "failed") throw new Error(JSON.stringify(told));
  return told.message;
}

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
    // On a card, the thread is on its node; on a shape, on the shape.
    output(await thread(ctx, "k.topic", "Is this right?", { on: "c1" }));
    output(await thread(ctx, "k.shape", "Move this", { on: "s1" }));
    output(await thread(ctx, "k.point", "Room here", { at: { x: 900, y: 40 } }));
    expect(output(await comment(ctx, { id: "k.reply", text: "Yes", replyTo: "k.topic" }))).toEqual({
      canvasId: "n.canvas",
      id: "k.reply",
      thread: "k.topic",
    });

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
    output(await thread(ctx, "k.topic", "On the topic", { on: "c1" }));
    output(await thread(ctx, "k.shape", "On s1", { on: "s1" }));
    output(await thread(ctx, "k.done", "On s2, done", { on: "s2" }));
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

  test("a comment names one place on its canvas, and a script's comments stay on its subject", async () => {
    const ctx = await openKb(root);
    for (const id of ["n.canvas", "n.other"]) {
      await invoke(ctx, { id: "node.add", input: { id, text: id, tags: ["canvas"] } });
    }
    output(
      await invoke(ctx, {
        id: "ext.canvas.tx.apply",
        input: { canvasId: "n.canvas", doc: { nodes: [shape("s1")], edges: [] } },
      }),
    );
    output(await thread(ctx, "k.here", "Here", { on: "s1" }));
    output(
      await invoke(ctx, {
        id: "ext.canvas.comment",
        input: { canvasId: "n.other", id: "k.there", text: "There", at: { x: 0, y: 0 } },
      }),
    );

    expect(await failed(thread(ctx, "k.no", "Gone", { on: "s9" }))).toContain("no item s9");
    expect(await failed(comment(ctx, { text: "Elsewhere", replyTo: "k.there" }))).toContain(
      "no comment k.there on this canvas",
    );
    expect(await failed(comment(ctx, { text: "Both", on: "s1", at: { x: 0, y: 0 } }))).toContain(
      "exactly one",
    );

    // A script on n.canvas comments and replies there, and nowhere else.
    const asScript: Partial<ActionInvocation> = {
      actor: "script",
      approved: true,
      script: { subject: "n.canvas", grant: { reads: "subject", actions: ["ext.canvas.comment"] } },
    };
    output(await comment(ctx, { id: "k.answer", text: "Done", replyTo: "k.here" }, asScript));
    expect(
      (
        await invoke(ctx, {
          id: "ext.canvas.comment",
          input: { canvasId: "n.other", text: "Over there", at: { x: 1, y: 1 } },
          ...asScript,
        })
      ).status,
    ).toBe("failed");
    // A thread on n.canvas a person filed under n.other: a reply there reaches past the subject.
    output(
      await invoke(ctx, {
        id: "node.add",
        input: {
          id: "k.filed",
          text: "Filed away",
          tags: ["comment"],
          parent: "n.other",
          props: [
            { field: CANVAS_IDS.commentCanvasField, value: { t: "ref", v: "n.canvas" } },
            { field: CANVAS_IDS.commentAtField, value: { t: "str", v: "0,0" } },
          ],
        },
      }),
    );
    expect((await comment(ctx, { text: "Reaching", replyTo: "k.filed" }, asScript)).status).toBe(
      "failed",
    );
    output(await comment(ctx, { id: "k.person", text: "Mine", replyTo: "k.filed" }));
    expect((await describeComments(ctx)).comments).toEqual([
      expect.objectContaining({ id: "k.here", replies: [{ id: "k.answer", text: "Done" }] }),
      expect.objectContaining({ id: "k.filed", replies: [{ id: "k.person", text: "Mine" }] }),
    ]);
  });
});
