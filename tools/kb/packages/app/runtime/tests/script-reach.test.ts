/**
 * A script reaches only what its subject holds, through any action and any
 * write (DESIGN.md → Sandbox → Grants), replayed through the real invoke
 * core as the `script` actor. Each escape review round 5 found is a row:
 * writing onto a node outside the subject, pointing a node at one, reading
 * one through a canvas's description, and a call an action makes for it.
 * Each is refused, and the same reach within the subject is not.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionInvocation, ActionReceipt, KbContext } from "@kb/contracts";
import { SYSTEM_IDS, fieldTypeValue, type PropValue } from "@kb/model";
import { invoke } from "../src/invoke.ts";
import { resetRegistryCache } from "../src/registry.ts";
import { openKb } from "../src/session.ts";

/** The canvas the script runs for, under a home it does not hold. */
const CANVAS = "n.canvas";
/** A node under the canvas: within the subject. */
const KEPT = "n.kept";
/** A node elsewhere, with words the script must not read and fields it must not write. */
const SECRET = "n.secret";

const GRANT = {
  reads: "subject",
  actions: [
    "ext.canvas.place",
    "ext.canvas.connect",
    "ext.canvas.describe",
    "node.add",
    "node.update",
    "node.delete",
  ],
};

/** A call as a script run for the canvas makes it, approved by a person where it asks: the reach still holds. */
const asScript = (id: string, input: Record<string, unknown>): ActionInvocation => ({
  id,
  input,
  actor: "script",
  approved: true,
  script: { subject: CANVAS, grant: GRANT },
});

const card = (id: string, nodeId: string, x: number) => ({
  id,
  type: "kb-node",
  nodeId,
  x,
  y: 0,
  width: 200,
  height: 80,
});

async function board(root: string): Promise<KbContext> {
  const ctx = await openKb(root);
  const add = (input: Record<string, unknown>) => invoke(ctx, { id: "node.add", input });
  await invoke(ctx, { id: "field.define", input: { name: "leads to", id: "f.leads" } });
  await invoke(ctx, {
    id: "node.update",
    input: {
      id: "f.leads",
      setProps: [{ field: SYSTEM_IDS.fieldTypeField, value: fieldTypeValue("ref") }],
    },
  });
  await add({ id: "n.home", text: "Home" });
  await add({ id: CANVAS, text: "Board", tags: ["canvas"], parent: "n.home" });
  await add({ id: KEPT, text: "Kept", parent: CANVAS });
  await add({ id: "n.kept2", text: "Kept too", parent: CANVAS });
  await add({ id: SECRET, text: "secret words" });
  // A person shows the secret on the board, beside two of its own nodes.
  await invoke(ctx, {
    id: "ext.canvas.tx.apply",
    input: {
      canvasId: CANVAS,
      doc: {
        nodes: [card("s", SECRET, 0), card("k", KEPT, 400), card("k2", "n.kept2", 800)],
        edges: [],
      },
    },
  });
  return ctx;
}

const statusOf = (receipt: ActionReceipt) =>
  receipt.status === "failed" ? receipt.code : receipt.status;

describe("a script's reach", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-script-reach-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    resetRegistryCache();
  });

  const ESCAPES: readonly (readonly [string, string, Record<string, unknown>])[] = [
    [
      "places a card for a node outside its subject",
      "ext.canvas.place",
      {
        canvasId: CANVAS,
        items: [{ make: { nodeId: "n.home", preset: "kb-node" }, at: { x: 0, y: 300 } }],
      },
    ],
    [
      "binds a field on a node outside its subject",
      "ext.canvas.connect",
      { canvasId: CANVAS, from: "s", to: "k", bind: "leads to" },
    ],
    [
      "binds a field on its own node, pointing outside its subject",
      "ext.canvas.connect",
      { canvasId: CANVAS, from: "k", to: "s", bind: "leads to" },
    ],
    [
      "adds a node with a ref outside its subject",
      "node.add",
      {
        text: "pointer",
        parent: KEPT,
        props: [{ field: "f.leads", value: { t: "ref", v: SECRET } }],
      },
    ],
    [
      "adds a node whose words name a node outside its subject",
      "node.add",
      { text: `see [[${SECRET}]]`, parent: KEPT },
    ],
    [
      "sets a ref outside its subject",
      "node.update",
      { id: KEPT, setProps: [{ field: "f.leads", value: { t: "ref", v: SECRET } }] },
    ],
    [
      "reorders its subject, writing the parent it does not hold",
      "node.update",
      { id: CANVAS, position: 0 },
    ],
    ["deletes its subject, writing the parent it does not hold", "node.delete", { id: CANVAS }],
  ];

  for (const [what, id, input] of ESCAPES) {
    test(`a script never ${what}`, async () => {
      const ctx = await board(root);
      const before = JSON.stringify(ctx.index.storedNodes());
      expect(statusOf(await invoke(ctx, asScript(id, input)))).toBe("forbidden");
      expect(JSON.stringify(ctx.index.storedNodes())).toBe(before);
    });
  }

  test("within its subject the same writes land", async () => {
    const ctx = await board(root);
    const within: readonly (readonly [string, Record<string, unknown>])[] = [
      [
        "ext.canvas.place",
        {
          canvasId: CANVAS,
          items: [{ make: { nodeId: KEPT, preset: "kb-node" }, at: { x: 0, y: 300 } }],
        },
      ],
      ["ext.canvas.connect", { canvasId: CANVAS, from: "k", to: "k2", bind: "leads to" }],
      [
        "node.add",
        {
          id: "n.new",
          text: `see [[${KEPT}]]`,
          parent: KEPT,
          props: [{ field: "f.leads", value: { t: "ref", v: "n.kept2" } }],
        },
      ],
      ["node.update", { id: KEPT, position: 1 }],
      ["node.delete", { id: "n.new" }],
      // Moving its card for the secret keeps the reference a person made.
      ["ext.canvas.place", { canvasId: CANVAS, items: [{ move: "s", at: { x: 0, y: 600 } }] }],
    ];
    for (const [id, input] of within) {
      expect([id, statusOf(await invoke(ctx, asScript(id, input)))]).toEqual([id, "succeeded"]);
    }
  });

  test("a script's description of its canvas does not say what a node outside its subject says", async () => {
    const ctx = await board(root);
    const told = await invoke(ctx, asScript("ext.canvas.describe", { canvasId: CANVAS }));
    if (told.status !== "succeeded") throw new Error(JSON.stringify(told));
    expect(JSON.stringify(told.output)).not.toContain("secret words");
    expect(JSON.stringify(told.output)).toContain("Kept");
    // A person's says it.
    const theirs = await invoke(ctx, { id: "ext.canvas.describe", input: { canvasId: CANVAS } });
    expect(JSON.stringify(theirs.status === "succeeded" ? theirs.output : null)).toContain(
      "secret words",
    );
  });

  test("what a bind is refused for says nothing of a node outside its subject", async () => {
    const ctx = await board(root);
    await invoke(ctx, { id: "tag.define", input: { name: "hidden", id: "t.hidden" } });
    await invoke(ctx, { id: "tag.define", input: { name: "shown", id: "t.shown" } });
    await invoke(ctx, {
      id: "node.update",
      input: {
        id: SECRET,
        setProps: [{ field: SYSTEM_IDS.typeField, value: { t: "ref", v: "t.hidden" } }],
      },
    });
    /** A ref field allowing what `target` says: a tag the secret carries, one it does not, a query naming it. */
    const constrained = async (id: string, target: { field: string; value: PropValue }) => {
      await invoke(ctx, { id: "field.define", input: { name: id, id } });
      await invoke(ctx, {
        id: "node.update",
        input: {
          id,
          setProps: [{ field: SYSTEM_IDS.fieldTypeField, value: fieldTypeValue("ref") }, target],
        },
      });
    };
    await constrained("f.hidden", {
      field: SYSTEM_IDS.targetTagField,
      value: { t: "ref", v: "t.hidden" },
    });
    await constrained("f.shown", {
      field: SYSTEM_IDS.targetTagField,
      value: { t: "ref", v: "t.shown" },
    });
    await constrained("f.asked", {
      field: SYSTEM_IDS.targetQueryField,
      value: { t: "str", v: '[:find ?id :where [?n :node/text "secret words"] [?n :node/id ?id]]' },
    });
    const bind = (field: string) => ({ canvasId: CANVAS, from: "k", to: "s", bind: field });
    const told = async (field: string) => {
      const receipt = await invoke(ctx, asScript("ext.canvas.connect", bind(field)));
      return receipt.status === "failed"
        ? [receipt.code, receipt.message.replace(field, "<field>")]
        : [receipt.status];
    };
    // A script's are refused alike, whatever the secret carries.
    const answers = [await told("f.hidden"), await told("f.shown"), await told("f.asked")];
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[2]).toEqual(answers[1]);
    // A person's tell the fields apart: the secret is what two of them allow.
    const persons: string[] = [];
    for (const field of ["f.hidden", "f.shown", "f.asked"]) {
      persons.push(statusOf(await invoke(ctx, { id: "ext.canvas.connect", input: bind(field) })));
    }
    expect(persons).toEqual(["succeeded", "invalid_input", "succeeded"]);
  });

  test("a call an action makes for a script is the script's, within its grant", async () => {
    const ctx = await board(root);
    // describe lists the board's scripts through ext.code.script.list, which this grant does not name.
    const theirs = await invoke(ctx, { id: "ext.canvas.describe", input: { canvasId: CANVAS } });
    expect(theirs.status === "succeeded" && "scripts" in (theirs.output as object)).toBe(true);
    const told = await invoke(ctx, asScript("ext.canvas.describe", { canvasId: CANVAS }));
    expect(told.status === "succeeded" && "scripts" in (told.output as object)).toBe(false);
  });
});
