/**
 * `graph.trace` and `graph.suggest` end to end: the graph family's reads, by
 * their bare aliases and their namespaced ids, give the answer the page's
 * local read gives over the same nodes (`@kb/graph`'s `traceOf` and
 * `suggestOf`), because both hosts run the same function. The algorithms
 * themselves are `@kb/graph`'s own tests.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionInvocation, KbContext } from "@kb/contracts";
import { suggestOf, traceOf } from "@kb/graph";
import { SYSTEM_IDS, fieldTypeValue } from "@kb/model";
import { invoke } from "../src/invoke.ts";
import { openKb } from "../src/session.ts";

async function must(ctx: KbContext, invocation: ActionInvocation): Promise<unknown> {
  const receipt = await invoke(ctx, invocation);
  if (receipt.status !== "succeeded") throw new Error(`${invocation.id}: ${receipt.message}`);
  return receipt.output;
}

/** a mentions b, b contains c, c —influences→ d; e shares a's neighbour b. */
async function seed(ctx: KbContext): Promise<void> {
  const add = (input: Record<string, unknown>) => must(ctx, { id: "node.add", input });
  await add({
    id: "f.influences",
    text: "influences",
    props: [
      { field: SYSTEM_IDS.typeField, value: { t: "ref", v: SYSTEM_IDS.field } },
      { field: SYSTEM_IDS.fieldTypeField, value: fieldTypeValue("ref") },
    ],
  });
  await add({ id: "d", text: "D" });
  await add({ id: "b", text: "B" });
  await add({
    id: "c",
    text: "C",
    parent: "b",
    props: [{ field: "f.influences", value: { t: "ref", v: "d" } }],
  });
  await add({ id: "a", text: "A on [[b|B]]" });
  await add({ id: "e", text: "E on [[b]]" });
}

describe("graph.trace", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-graph-trace-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("answers what the page's local read answers, under either id", async () => {
    const ctx = await openKb(root);
    await seed(ctx);
    const input = { from: "a", to: "d" };
    const bare = await must(ctx, { id: "graph.trace", input });
    expect(await must(ctx, { id: "ext.graph.trace", input })).toEqual(bare);
    expect(bare).toEqual(JSON.parse(JSON.stringify(traceOf(ctx.nodes, input))));
    const sentences = (bare as { paths: { hops: { sentence: string }[] }[] }).paths[0]?.hops.map(
      (hop) => hop.sentence,
    );
    expect(sentences).toEqual(["A on B mentions B", "B contains C", "C —influences→ D"]);
  });

  test("a node the store does not hold is not_found; a kind that is none is invalid_input", async () => {
    const ctx = await openKb(root);
    await seed(ctx);
    const missing = await invoke(ctx, { id: "graph.trace", input: { from: "a", to: "nope" } });
    expect(missing.status === "failed" && missing.code).toBe("not_found");
    const badKind = await invoke(ctx, {
      id: "graph.trace",
      input: { from: "a", to: "d", kinds: ["sideways"] },
    });
    expect(badKind.status === "failed" && badKind.code).toBe("invalid_input");
  });
});

describe("graph.suggest", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-graph-suggest-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("answers what the page's local read answers", async () => {
    const ctx = await openKb(root);
    await seed(ctx);
    const output = await must(ctx, { id: "graph.suggest", input: { id: "a" } });
    expect(output).toEqual(
      JSON.parse(JSON.stringify({ suggestions: suggestOf(ctx.nodes, { id: "a" }) })),
    );
    expect((output as { suggestions: { id: string }[] }).suggestions.map((s) => s.id)).toContain(
      "e",
    );
  });
});
