/**
 * The canvas verbs through the invoke core (plan 2026-10-02, decision 16):
 * each resolves its relation on the stored document, writes it in one
 * canvas write whose receipt carries the lints it made and cleared, and is
 * decided by the approval policies like any action. The pure halves are
 * `@kb/canvas`'s tests (`verbs.test.ts`).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANVAS_IDS,
  canvasMembership,
  directionFrom,
  itemBounds,
  parseCanvasDoc,
  restingOn,
  type CanvasDoc,
} from "@kb/canvas";
import type { ActionInvocation, ActionReceipt } from "@kb/contracts";
import {
  ACTOR_OPTION_IDS,
  DECISION_OPTION_IDS,
  SYSTEM_IDS,
  fieldTypeValue,
  present,
} from "@kb/model";
import { invoke } from "../src/invoke.ts";
import { resetRegistryCache } from "../src/registry.ts";
import { openKb } from "../src/session.ts";

type Kb = Awaited<ReturnType<typeof openKb>>;

let roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
  resetRegistryCache();
});

/** A fresh kb holding an empty canvas `n.canvas`, with `items` on it. */
async function canvasKb(items: Record<string, unknown>[] = []): Promise<Kb> {
  const root = await mkdtemp(join(tmpdir(), "kb-canvas-verbs-"));
  roots.push(root);
  const ctx = await openKb(root);
  await invoke(ctx, { id: "node.add", input: { text: "Board", id: "n.canvas", tags: ["canvas"] } });
  if (items.length > 0) {
    const applied = await invoke(ctx, {
      id: "ext.canvas.tx.apply",
      input: { canvasId: "n.canvas", doc: { nodes: items, edges: [] } },
    });
    expect(applied.status).toBe("succeeded");
  }
  return ctx;
}

function stored(ctx: Kb): CanvasDoc {
  const node = present(
    ctx.nodes.find((n) => n.id === "n.canvas"),
    "canvas",
  );
  const raw = present(node.props[CANVAS_IDS.canvasField]?.[0], "canvas doc");
  return parseCanvasDoc(String(raw.v));
}

function output(receipt: ActionReceipt): Record<string, unknown> {
  if (receipt.status !== "succeeded") throw new Error(`failed: ${receipt.message}`);
  return receipt.output as Record<string, unknown>;
}

const verb = (
  id: string,
  input: Record<string, unknown>,
  rest: Partial<ActionInvocation> = {},
) => ({
  id: `ext.canvas.${id}`,
  input: { canvasId: "n.canvas", ...input },
  ...rest,
});

const card = (id: string, x: number, y: number, more: Record<string, unknown> = {}) => ({
  id,
  type: "text",
  text: id,
  x,
  y,
  width: 100,
  height: 60,
  ...more,
});
const box = (id: string, x: number, y: number) => ({
  id,
  type: "shape",
  shape: "rect",
  x,
  y,
  width: 120,
  height: 120,
  depth: 120,
});

describe("ext.canvas.place", () => {
  test("makes items by relation, in order, one write; the receipt says where they went", async () => {
    const ctx = await canvasKb([card("a", 0, 0), box("b", 400, 0)]);
    const out = output(
      await invoke(
        ctx,
        verb("place", {
          items: [
            { make: { id: "left", text: "Left of a" }, near: "a", side: "left", gap: 40 },
            { make: { id: "top", preset: "sphere" }, on: "b" },
            { make: { text: "Beside left" }, near: "left", side: "north" },
          ],
        }),
      ),
    );
    const doc = stored(ctx);
    const at = (id: string) =>
      itemBounds(
        present(
          doc.nodes.find((n) => n.id === id),
          id,
        ),
      );
    expect(directionFrom(at("left"), at("a"))).toEqual({ direction: "left", gap: 40 });
    expect(
      restingOn(
        present(
          doc.nodes.find((n) => n.id === "top"),
          "top",
        ),
        doc.nodes,
      )?.id,
    ).toBe("b");
    expect(out.placed).toHaveLength(3);
    expect(out.lints).toEqual({ new: [], resolved: [] });
  });

  test("places a free arrow through the points it is given, wearing the heads it is given", async () => {
    const ctx = await canvasKb([card("a", 0, 0)]);
    output(
      await invoke(
        ctx,
        verb("place", {
          items: [
            {
              make: {
                id: "ar",
                preset: "arrow",
                width: 240,
                height: 80,
                line: {
                  points: [
                    { x: 0, y: 1 },
                    { x: 1, y: 0 },
                  ],
                  fromHead: "dot",
                  toHead: "none",
                },
              },
              near: "a",
              side: "right",
            },
          ],
        }),
      ),
    );
    const placed = stored(ctx).nodes.find((n) => n.id === "ar");
    expect(placed).toMatchObject({
      type: "path",
      width: 240,
      points: [
        { x: 0, y: 1 },
        { x: 1, y: 0 },
      ],
      fromHead: "dot",
    });
    expect(placed).not.toHaveProperty("toHead");
    const told = output(await invoke(ctx, verb("describe", {})));
    expect(told.items).toContainEqual(expect.objectContaining({ id: "ar", kind: "arrow" }));
  });

  test("an item that is not there is refused, and nothing is written", async () => {
    const ctx = await canvasKb([card("a", 0, 0)]);
    const before = stored(ctx);
    const receipt = await invoke(
      ctx,
      verb("place", { items: [{ make: {}, near: "ghost", side: "right" }] }),
    );
    expect(receipt).toMatchObject({ status: "failed", code: "invalid_input" });
    expect(receipt.status === "failed" ? receipt.message : "").toContain("ghost");
    expect(stored(ctx)).toEqual(before);
  });

  test("a placement must name one relation", async () => {
    const ctx = await canvasKb([card("a", 0, 0)]);
    const receipt = await invoke(ctx, verb("place", { items: [{ make: {}, on: "a", in: "a" }] }));
    expect(receipt).toMatchObject({ status: "failed" });
  });

  test("a write that leaves an item floating says so, and one that lands it says that too", async () => {
    const ctx = await canvasKb([card("a", 0, 0)]);
    const up = output(
      await invoke(ctx, verb("place", { items: [{ move: "a", at: { x: 0, y: 0, z: 90 } }] })),
    );
    expect(up.lints).toMatchObject({ new: [{ rule: "floating", ids: ["a"] }], resolved: [] });
    const down = output(
      await invoke(ctx, verb("place", { items: [{ move: "a", at: { x: 0, y: 0, z: 0 } }] })),
    );
    expect(down.lints).toMatchObject({ new: [], resolved: [{ rule: "floating" }] });
  });
});

describe("ext.canvas.describe and lint", () => {
  test("a canvas told in words: kinds, words, boxes, relations; no tab, so every item in full", async () => {
    const ctx = await canvasKb([
      box("b", 0, 0),
      card("on", 10, 10, { z: 120 }),
      card("far", 200, 0),
    ]);
    const out = output(await invoke(ctx, verb("describe", {})));
    expect(out.screen).toBeNull();
    expect(out.items).toContainEqual(
      expect.objectContaining({ id: "b", kind: "box", detail: "focus" }),
    );
    expect(out.relations).toContainEqual({ kind: "on", from: "on", to: "b" });
    expect(out.relations).toContainEqual(
      expect.objectContaining({ kind: "near", from: "b", to: "far", side: "left" }),
    );
  });

  test("an item is made in its looks, its colour by name; describe tells them back", async () => {
    const ctx = await canvasKb([card("a", 0, 0)]);
    output(
      await invoke(
        ctx,
        verb("place", {
          items: [
            {
              make: {
                id: "ref",
                text: "a reference",
                color: "grey",
                style: { dash: "dashed", font: "mono", opacity: 0.5 },
              },
              near: "a",
              side: "right",
            },
            { make: { id: "own", preset: "rect", color: "red" }, near: "a", side: "south" },
          ],
        }),
      ),
    );
    const doc = stored(ctx);
    const made = (id: string) =>
      present(
        doc.nodes.find((n) => n.id === id),
        id,
      );
    expect(made("ref").style).toEqual({ dash: "dashed", font: "mono", opacity: 0.5 });
    // A palette name is written as the JSON Canvas preset other readers know.
    expect(made("own").color).toBe("1");
    const out = output(await invoke(ctx, verb("describe", {})));
    expect(out.items).toContainEqual(
      expect.objectContaining({
        id: "ref",
        color: "grey",
        style: { dash: "dashed", font: "mono", opacity: 0.5 },
      }),
    );
    expect(out.items).toContainEqual(expect.objectContaining({ id: "own", color: "red" }));
  });

  test("lint reads the lints; tx.apply's receipt carries the ones it made", async () => {
    const ctx = await canvasKb([box("a", 0, 0)]);
    const applied = output(
      await invoke(ctx, {
        id: "ext.canvas.tx.apply",
        input: {
          canvasId: "n.canvas",
          doc: { nodes: [box("a", 0, 0), box("b", 60, 60)], edges: [] },
        },
      }),
    );
    expect(applied.lints).toMatchObject({ new: [{ rule: "overlap", ids: ["a", "b"] }] });
    expect(output(await invoke(ctx, verb("lint", {}))).lints).toMatchObject([{ rule: "overlap" }]);
  });
});

describe("ext.canvas.arrange", () => {
  test("layers lift each item by its node's value", async () => {
    const ctx = await canvasKb();
    await invoke(ctx, { id: "field.define", input: { name: "stage", id: "f.stage" } });
    for (const [id, stage] of [
      ["n.1", "a-idea"],
      ["n.2", "b-draft"],
    ] as const) {
      await invoke(ctx, {
        id: "node.add",
        input: { id, text: id, props: [{ field: "f.stage", value: { t: "str", v: stage } }] },
      });
    }
    await invoke(ctx, {
      id: "ext.canvas.tx.apply",
      input: {
        canvasId: "n.canvas",
        doc: {
          nodes: [
            card("c1", 0, 0, { type: "kb-node", nodeId: "n.1" }),
            card("c2", 300, 0, { type: "kb-node", nodeId: "n.2" }),
          ],
          edges: [],
        },
      },
    });
    output(
      await invoke(
        ctx,
        verb("arrange", { ids: ["c2", "c1"], layout: "layers", field: "stage", gap: 100 }),
      ),
    );
    const z = (id: string) => stored(ctx).nodes.find((n) => n.id === id)?.z ?? 0;
    expect([z("c1"), z("c2")]).toEqual([0, 100]);
  });

  test("a row, in the order named", async () => {
    const ctx = await canvasKb([card("a", 0, 0), card("b", 0, 300)]);
    output(await invoke(ctx, verb("arrange", { ids: ["a", "b"], layout: "row", gap: 30 })));
    const doc = stored(ctx);
    const at = (id: string) =>
      itemBounds(
        present(
          doc.nodes.find((n) => n.id === id),
          id,
        ),
      );
    expect(directionFrom(at("b"), at("a"))).toEqual({ direction: "right", gap: 30 });
  });

  test("align, order and flip are arrangements of the same verb", async () => {
    const ctx = await canvasKb([card("a", 0, 0), card("b", 300, 200)]);
    const xs = () => stored(ctx).nodes.map((n) => [n.id, n.x]);
    output(await invoke(ctx, verb("arrange", { ids: ["a", "b"], layout: "align", edge: "right" })));
    expect(xs()).toEqual([
      ["a", 300],
      ["b", 300],
    ]);
    output(await invoke(ctx, verb("arrange", { ids: ["a"], order: "front" })));
    expect(stored(ctx).nodes.map((n) => n.id)).toEqual(["b", "a"]);
    output(await invoke(ctx, verb("arrange", { ids: ["b"], flip: "y" })));
    expect(stored(ctx).nodes.find((n) => n.id === "b")).toMatchObject({ x: 300, y: 200 });
  });

  test("a locked item is refused by every verb that changes it, and described as locked", async () => {
    const ctx = await canvasKb([card("a", 0, 0, { locked: true }), card("b", 300, 200)]);
    for (const [id, input] of [
      ["arrange", { ids: ["a", "b"], layout: "row" }],
      ["arrange", { ids: ["a"], flip: "x" }],
      ["group", { ids: ["a", "b"] }],
      ["place", { items: [{ move: "a", at: { x: 900, y: 900 } }] }],
    ] as const) {
      const receipt = await invoke(ctx, verb(id, input));
      expect(receipt).toMatchObject({ status: "failed", code: "invalid_input" });
      expect(receipt.status === "failed" ? receipt.message : "").toContain("a is locked");
    }
    expect(stored(ctx).nodes.find((n) => n.id === "a")).toMatchObject({ x: 0, y: 0 });
    const described = output(await invoke(ctx, verb("describe", {})));
    expect(JSON.stringify(described)).toContain('"locked":true');
  });

  test("an arrangement is exactly one of a layout, an order or a flip", async () => {
    const ctx = await canvasKb([card("a", 0, 0), card("b", 300, 200)]);
    for (const input of [
      { ids: ["a", "b"] },
      { ids: ["a", "b"], layout: "row", order: "front" },
      { ids: ["a", "b"], order: "back", flip: "x" },
      { ids: ["a", "b"], layout: "align" },
    ]) {
      expect((await invoke(ctx, verb("arrange", input))).status).not.toBe("succeeded");
    }
  });
});

describe("ext.canvas.connect, group, ungroup and promote", () => {
  test("connect draws an arrow; with bind it sets the ref on the source node in the same write", async () => {
    const ctx = await canvasKb();
    await invoke(ctx, { id: "field.define", input: { name: "leads to", id: "f.leads" } });
    await invoke(ctx, {
      id: "node.update",
      input: {
        id: "f.leads",
        setProps: [{ field: SYSTEM_IDS.fieldTypeField, value: fieldTypeValue("ref") }],
      },
    });
    await invoke(ctx, { id: "node.add", input: { id: "n.a", text: "A" } });
    await invoke(ctx, { id: "node.add", input: { id: "n.b", text: "B" } });
    await invoke(ctx, {
      id: "ext.canvas.tx.apply",
      input: {
        canvasId: "n.canvas",
        doc: {
          nodes: [
            card("a", 0, 0, { type: "kb-node", nodeId: "n.a" }),
            card("b", 400, 0, { type: "kb-node", nodeId: "n.b" }),
          ],
          edges: [],
        },
      },
    });
    const out = output(
      await invoke(ctx, verb("connect", { from: "a", to: "b", bind: "leads to" })),
    );
    expect(out.bound).toBe("f.leads");
    const [edge] = stored(ctx).edges;
    expect(edge).toMatchObject({ fromNode: "a", toNode: "b", fromSide: "right", toSide: "left" });
    expect(edge?.kbLink).toMatchObject({ mode: "native", fieldId: "f.leads" });
    expect(ctx.nodes.find((n) => n.id === "n.a")?.props["f.leads"]).toEqual([
      { t: "ref", v: "n.b" },
    ]);
  });

  test("connect takes anchors, a route and bend, heads, a colour and line looks; describe reads them back", async () => {
    const ctx = await canvasKb([card("a", 0, 0), card("b", 400, 200)]);
    const out = output(
      await invoke(
        ctx,
        verb("connect", {
          from: "a",
          to: "b",
          fromAnchor: { x: 1, y: 0.25 },
          toSide: "top",
          route: "elbow",
          bend: 30,
          fromHead: "dot",
          toHead: "open",
          color: "green",
          style: { dash: "dashed", size: "l" },
        }),
      ),
    );
    const [edge] = stored(ctx).edges;
    expect(edge).toMatchObject({
      id: out.edge,
      fromAnchor: { x: 1, y: 0.25 },
      fromSide: "right",
      toSide: "top",
      route: "elbow",
      bend: 30,
      fromEnd: "arrow",
      fromHead: "dot",
      toHead: "open",
      color: "4",
      style: { dash: "dashed", size: "l" },
    });
    const told = output(await invoke(ctx, verb("describe", {})));
    expect(told.relations).toContainEqual(
      expect.objectContaining({
        kind: "linked",
        edge: out.edge,
        route: "elbow",
        fromHead: "dot",
        toHead: "open",
        color: "green",
        style: { dash: "dashed", size: "l" },
      }),
    );
    // A bare arrival is told as none; JSON Canvas's own arrow and curve are not told at all.
    await invoke(ctx, verb("connect", { from: "b", to: "a", toHead: "none" }));
    const again = output(await invoke(ctx, verb("describe", {})));
    const bare = (again.relations as Record<string, unknown>[]).find(
      (r) => r.kind === "linked" && r.from === "b",
    );
    expect(bare).toMatchObject({ toHead: "none" });
    expect(bare).not.toHaveProperty("route");
    expect(bare).not.toHaveProperty("fromHead");
  });

  test("an edge never binds kb's own fields, a node's tags among them", async () => {
    const ctx = await canvasKb();
    await invoke(ctx, { id: "node.add", input: { id: "n.a", text: "A" } });
    await invoke(ctx, { id: "node.add", input: { id: "n.b", text: "B" } });
    await invoke(ctx, {
      id: "ext.canvas.tx.apply",
      input: {
        canvasId: "n.canvas",
        doc: {
          nodes: [
            card("a", 0, 0, { type: "kb-node", nodeId: "n.a" }),
            card("b", 400, 0, { type: "kb-node", nodeId: "n.b" }),
          ],
          edges: [],
        },
      },
    });
    const receipt = await invoke(
      ctx,
      verb("connect", { from: "a", to: "b", bind: SYSTEM_IDS.typeField }),
    );
    expect(receipt).toMatchObject({ status: "failed", code: "invalid_input" });
    expect(ctx.nodes.find((n) => n.id === "n.a")?.props[SYSTEM_IDS.typeField]).toBeUndefined();
  });

  test("a verb refuses a canvas whose document kb cannot read, rather than write over it", async () => {
    const ctx = await canvasKb();
    await invoke(ctx, {
      id: "node.update",
      input: {
        id: "n.canvas",
        unsetProps: [{ field: CANVAS_IDS.canvasField }],
        setProps: [{ field: CANVAS_IDS.canvasField, value: { t: "str", v: "{not json" } }],
      },
    });
    const receipt = await invoke(ctx, verb("place", { items: [{ make: {}, at: { x: 0, y: 0 } }] }));
    expect(receipt).toMatchObject({ status: "failed", code: "invalid_input" });
    const raw = ctx.nodes.find((n) => n.id === "n.canvas")?.props[CANVAS_IDS.canvasField]?.[0];
    expect(raw).toEqual({ t: "str", v: "{not json" });
  });

  test("group gathers a frame round items; ungroup takes it apart", async () => {
    const ctx = await canvasKb([card("a", 0, 0), card("b", 200, 0)]);
    const grouped = output(await invoke(ctx, verb("group", { ids: ["a", "b"], label: "Pair" })));
    const frame = (grouped.group as { id: string }).id;
    expect(canvasMembership(stored(ctx).nodes).parentOf("a")).toBe(frame);
    const released = output(await invoke(ctx, verb("ungroup", { ids: [frame] })));
    expect(released.released).toEqual(["a", "b"]);
    expect(stored(ctx).nodes.some((n) => n.id === frame)).toBe(false);
    expect(await invoke(ctx, verb("ungroup", { ids: ["a"] }))).toMatchObject({ status: "failed" });
  });

  test("promote makes a node of a text card's words, which the card then shows", async () => {
    const ctx = await canvasKb([card("s", 0, 0, { text: "A thought", color: "2" })]);
    const out = output(await invoke(ctx, verb("promote", { id: "s" })));
    const nodeId = String(out.nodeId);
    expect(ctx.nodes.find((n) => n.id === nodeId)?.text).toBe("A thought");
    expect(stored(ctx).nodes[0]).toMatchObject({ type: "kb-node", nodeId, color: "2" });
    expect(await invoke(ctx, verb("promote", { id: "s" }))).toMatchObject({
      status: "failed",
      code: "invalid_input",
    });
  });
});

describe("promote is one write", () => {
  test("the node and the card land in one transaction", async () => {
    const ctx = await canvasKb([card("s", 0, 0, { text: "A thought" })]);
    const head = ctx.log.head;
    const out = output(await invoke(ctx, verb("promote", { id: "s" })));
    expect(ctx.log.head).toBe(head + 1);
    expect(ctx.nodes.some((n) => n.id === out.nodeId)).toBe(true);
  });

  test("a refused canvas write leaves no node behind", async () => {
    const ctx = await canvasKb([card("s", 0, 0, { text: "A thought" })]);
    const policy = await invoke(ctx, {
      id: "node.add",
      approved: true,
      input: {
        id: "p.promote-ask",
        text: "agents ask before promoting",
        props: [
          { field: SYSTEM_IDS.typeField, value: { t: "ref", v: SYSTEM_IDS.approvalPolicyTag } },
          { field: SYSTEM_IDS.approvalMatchField, value: { t: "str", v: "ext.canvas.promote" } },
          { field: SYSTEM_IDS.approvalActorField, value: { t: "ref", v: ACTOR_OPTION_IDS.agent } },
          {
            field: SYSTEM_IDS.approvalDecisionField,
            value: { t: "ref", v: DECISION_OPTION_IDS.ask },
          },
        ],
      },
    });
    expect(policy.status).toBe("succeeded");
    const before = ctx.nodes.length;
    const head = ctx.log.head;
    const refused = await invoke(
      ctx,
      verb("promote", { id: "s", nodeId: "n.promoted" }, { actor: "agent" }),
    );
    expect(refused).toMatchObject({ status: "failed", code: "approval_required" });
    expect(ctx.nodes.some((n) => n.id === "n.promoted")).toBe(false);
    expect(ctx.nodes).toHaveLength(before);
    expect(ctx.log.head).toBe(head);
    expect(stored(ctx).nodes[0]).toMatchObject({ type: "text", text: "A thought" });
  });
});

describe("approval", () => {
  test("a policy on the canvas verbs decides an agent's call, and a person's gesture still runs", async () => {
    const ctx = await canvasKb([card("a", 0, 0)]);
    const policy = await invoke(ctx, {
      id: "node.add",
      approved: true,
      input: {
        id: "p.canvas-ask",
        text: "agents ask before canvas writes",
        props: [
          { field: SYSTEM_IDS.typeField, value: { t: "ref", v: SYSTEM_IDS.approvalPolicyTag } },
          { field: SYSTEM_IDS.approvalMatchField, value: { t: "str", v: "ext.canvas.*" } },
          { field: SYSTEM_IDS.approvalActorField, value: { t: "ref", v: ACTOR_OPTION_IDS.agent } },
          {
            field: SYSTEM_IDS.approvalDecisionField,
            value: { t: "ref", v: DECISION_OPTION_IDS.ask },
          },
        ],
      },
    });
    expect(policy.status).toBe("succeeded");
    const place = verb(
      "place",
      { items: [{ make: {}, near: "a", side: "right" }] },
      { actor: "agent" },
    );
    expect(await invoke(ctx, place)).toMatchObject({
      status: "failed",
      code: "approval_required",
      details: { policy: "p.canvas-ask" },
    });
    expect(stored(ctx).nodes).toHaveLength(1);
    expect(await invoke(ctx, { ...place, approved: true })).toMatchObject({ status: "succeeded" });
    expect(await invoke(ctx, { ...place, actor: "human" })).toMatchObject({ status: "succeeded" });
    // A pattern names reads too: one that should spare them says `every write` instead.
    expect(await invoke(ctx, verb("describe", {}, { actor: "agent" }))).toMatchObject({
      status: "failed",
      code: "approval_required",
    });
  });
});
