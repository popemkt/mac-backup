/**
 * `ext.check.sync` end to end: the check family decides each rule's
 * enforcement from its check surface, and commits the change through the
 * host's `GraphWrites`, so the write lands in the store as one transaction.
 * The decision itself is `@kb/ext-check`'s own test.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionInvocation, KbContext } from "@kb/contracts";
import { SYSTEM_IDS, fieldTypeValue } from "@kb/model";
import { invoke } from "../src/invoke.ts";
import { openKb } from "../src/session.ts";

const typeRef = (id: string) => ({ field: SYSTEM_IDS.typeField, value: { t: "ref", v: id } });

async function must(ctx: KbContext, invocation: ActionInvocation): Promise<unknown> {
  const receipt = await invoke(ctx, invocation);
  if (receipt.status !== "succeeded") throw new Error(`${invocation.id}: ${receipt.message}`);
  return receipt.output;
}

/** A rule that names no check, stored as `harness`: sync derives `prose`. */
async function seedRule(ctx: KbContext): Promise<void> {
  const add = (input: Record<string, unknown>) => must(ctx, { id: "node.add", input });
  await add({ id: "t.rule", text: "rule", props: [typeRef(SYSTEM_IDS.tag)] });
  await add({
    id: "f.enforcement",
    text: "enforcement",
    props: [
      typeRef(SYSTEM_IDS.field),
      { field: SYSTEM_IDS.fieldTypeField, value: fieldTypeValue("ref") },
    ],
  });
  await add({ id: "v.prose", text: "prose", parent: "f.enforcement" });
  await add({ id: "v.harness", text: "harness", parent: "f.enforcement" });
  await add({
    id: "rule.one",
    text: "One rule",
    props: [typeRef("t.rule"), { field: "f.enforcement", value: { t: "ref", v: "v.harness" } }],
  });
}

describe("ext.check.sync", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-check-sync-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("commits each rule's derived enforcement as one transaction in the store", async () => {
    const ctx = await openKb(root);
    await seedRule(ctx);
    const head = ctx.log.head;

    expect(await must(ctx, { id: "ext.check.sync", input: {} })).toEqual({ updated: ["rule.one"] });
    expect(ctx.index.getNode("rule.one")?.props["f.enforcement"]).toEqual([
      { t: "ref", v: "v.prose" },
    ]);
    expect(ctx.log.head).toBe(head + 1);

    const reopened = await openKb(root);
    expect(reopened.index.getNode("rule.one")?.props["f.enforcement"]).toEqual([
      { t: "ref", v: "v.prose" },
    ]);
    // Synced, there is nothing left to write.
    expect(await must(reopened, { id: "ext.check.sync", input: {} })).toEqual({ updated: [] });
    expect(reopened.log.head).toBe(head + 1);
  });
});
