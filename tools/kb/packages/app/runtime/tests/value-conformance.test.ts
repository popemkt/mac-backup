/**
 * The write check end to end: through the registry every surface invokes
 * (CLI, MCP and HTTP all call `invoke`), into the store, and back on reopen.
 * The cases are the ones reproduced before the check existed — a number field
 * taking "banana", a ref field taking a dangling id and a number.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYSTEM_IDS, fieldTypeValue, type FieldType, type PropValue } from "@kb/model";
import { openKb } from "../src/session.ts";
import { invoke } from "../src/invoke.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

type Ctx = Awaited<ReturnType<typeof openKb>>;

async function session(): Promise<{ root: string; ctx: Ctx }> {
  const root = await mkdtemp(join(tmpdir(), "kb-conform-"));
  roots.push(root);
  return { root, ctx: await openKb(root) };
}

async function typedField(ctx: Ctx, id: string, type: FieldType): Promise<void> {
  const defined = await invoke(ctx, { id: "field.define", input: { name: id, id } });
  const typed = await invoke(ctx, {
    id: "node.update",
    input: { id, setProps: [{ field: SYSTEM_IDS.fieldTypeField, value: fieldTypeValue(type) }] },
  });
  expect([defined.status, typed.status]).toEqual(["succeeded", "succeeded"]);
}

function setProp(ctx: Ctx, id: string, field: string, value: PropValue) {
  return invoke(ctx, { id: "node.update", input: { id, setProps: [{ field, value }] } });
}

test("a number field refuses a string, and the refusal is a typed invalid_input", async () => {
  const { root, ctx } = await session();
  await typedField(ctx, "f.estimate", "number");
  await invoke(ctx, { id: "node.add", input: { id: "n.task", text: "Task" } });

  const refused = await setProp(ctx, "n.task", "f.estimate", { t: "str", v: "banana" });
  expect(refused).toMatchObject({ status: "failed", code: "invalid_input" });
  if (refused.status === "failed") {
    expect(refused.message).toContain("field f.estimate is number");
  }
  expect((await setProp(ctx, "n.task", "f.estimate", { t: "num", v: 3 })).status).toBe("succeeded");

  const reopened = await openKb(root);
  expect(reopened.nodes.find((n) => n.id === "n.task")?.props["f.estimate"]).toEqual([
    { t: "num", v: 3 },
  ]);
});

test("a ref field refuses a dangling id and a number, and takes a stored node", async () => {
  const { ctx } = await session();
  await typedField(ctx, "f.owner", "ref");
  await invoke(ctx, { id: "node.add", input: { id: "n.task", text: "Task" } });
  await invoke(ctx, { id: "node.add", input: { id: "n.ada", text: "Ada" } });

  const dangling = await setProp(ctx, "n.task", "f.owner", { t: "ref", v: "no-such-node" });
  expect(dangling).toMatchObject({ status: "failed", code: "invalid_input" });
  const numeric = await setProp(ctx, "n.task", "f.owner", { t: "num", v: 42 });
  expect(numeric).toMatchObject({ status: "failed", code: "invalid_input" });
  expect((await setProp(ctx, "n.task", "f.owner", { t: "ref", v: "n.ada" })).status).toBe(
    "succeeded",
  );
});

test("node.add is checked like node.update: a mistyped prop mints nothing", async () => {
  const { ctx } = await session();
  await typedField(ctx, "f.done", "checkbox");
  const refused = await invoke(ctx, {
    id: "node.add",
    input: {
      id: "n.task",
      text: "Task",
      props: [{ field: "f.done", value: { t: "str", v: "yes" } }],
    },
  });
  expect(refused).toMatchObject({ status: "failed", code: "invalid_input" });
  expect(ctx.nodes.some((n) => n.id === "n.task")).toBe(false);
});
