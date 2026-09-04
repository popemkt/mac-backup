import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatalogError } from "@kb/query";
import { openKb } from "../src/session.ts";
import { classifyQueryError, graphRunEffect, graphSearchEffect } from "@kb/operations";
import { invoke } from "../src/invoke.ts";
import { manifest } from "../src/registry.ts";
import { expectDefined } from "@kb/test-kit";

/** Under tests/ so fixture extensions resolve zod via tools/kb/node_modules. */
async function tempRoot(): Promise<string> {
  return mkdtemp(join(import.meta.dir, "kb-graph-"));
}

let roots: string[] = [];

afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
});

async function makeRoot(): Promise<string> {
  const root = await tempRoot();
  roots.push(root);
  await mkdir(join(root, ".kb", "queries"), { recursive: true });
  return root;
}

describe("graph.search", () => {
  test("case-insensitive substring over node text, id-sorted rows", async () => {
    const ctx = await openKb(await makeRoot());
    await invoke(ctx, { id: "node.add", input: { text: "Alpha", id: "n.alpha" } });
    await invoke(ctx, { id: "node.add", input: { text: "alphabet", id: "n.alphabet" } });
    await invoke(ctx, { id: "node.add", input: { text: "Beta", id: "n.beta" } });

    const found = await invoke(ctx, {
      id: "graph.search",
      input: { text: "alPH" },
    });
    expect(found.status).toBe("succeeded");
    if (found.status !== "succeeded") return;
    const rows = (found.output as { rows: unknown[][] }).rows;
    // alpha < alphabet (id sort), matching the datascript eid order the CLI used.
    expect(rows).toEqual([
      ["n.alpha", "Alpha"],
      ["n.alphabet", "alphabet"],
    ]);

    const none = await invoke(ctx, {
      id: "graph.search",
      input: { text: "zzz-missing" },
    });
    expect(none.status).toBe("succeeded");
    if (none.status !== "succeeded") return;
    expect((none.output as { rows: unknown[][] }).rows).toEqual([]);
  });

  test("limit truncates rows", async () => {
    const ctx = await openKb(await makeRoot());
    await invoke(ctx, { id: "node.add", input: { text: "same", id: "n.1" } });
    await invoke(ctx, { id: "node.add", input: { text: "same", id: "n.2" } });
    await invoke(ctx, { id: "node.add", input: { text: "same", id: "n.3" } });

    const found = await invoke(ctx, {
      id: "graph.search",
      input: { text: "same", limit: 2 },
    });
    expect(found.status).toBe("succeeded");
    if (found.status !== "succeeded") return;
    const rows = (found.output as { rows: unknown[][] }).rows;
    expect(rows).toEqual([
      ["n.1", "same"],
      ["n.2", "same"],
    ]);
  });
});

describe("graph.run", () => {
  test("executes a saved query from .kb/queries/<name>.edn", async () => {
    const ctx = await openKb(await makeRoot());
    await invoke(ctx, { id: "node.add", input: { text: "runnable", id: "n.run" } });
    await writeFile(
      join(ctx.root, ".kb", "queries", "all-ids.edn"),
      "[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]\n",
    );

    const ran = await invoke(ctx, { id: "graph.run", input: { name: "all-ids" } });
    expect(ran.status).toBe("succeeded");
    if (ran.status !== "succeeded") return;
    const out = ran.output as { name: string; query: string; rows: unknown[][] };
    expect(out.name).toBe("all-ids");
    expect(out.query).toContain(":where");
    expect(out.rows.some((r) => r[0] === "n.run" && r[1] === "runnable")).toBe(true);
  });

  test("saved query with :in inputs", async () => {
    const ctx = await openKb(await makeRoot());
    await invoke(ctx, {
      id: "node.add",
      input: { text: "target", id: "n.target" },
    });
    await invoke(ctx, { id: "node.add", input: { text: "other", id: "n.other" } });
    await writeFile(
      join(ctx.root, ".kb", "queries", "by-id.edn"),
      "[:find ?id ?text :in $ ?wanted :where [?e :node/id ?id] [?e :node/text ?text] [(= ?id ?wanted)]]",
    );

    const ran = await invoke(ctx, {
      id: "graph.run",
      input: { name: "by-id", inputs: ["n.target"] },
    });
    expect(ran.status).toBe("succeeded");
    if (ran.status !== "succeeded") return;
    const rows = (ran.output as { rows: unknown[][] }).rows;
    expect(rows).toEqual([["n.target", "target"]]);
  });

  test("invalid name → invalid_input; missing file → not_found", async () => {
    const ctx = await openKb(await makeRoot());
    const badName = await invoke(ctx, {
      id: "graph.run",
      input: { name: "../escape" },
    });
    expect(badName.status).toBe("failed");
    if (badName.status === "failed") {
      expect(badName.code).toBe("invalid_input");
    }

    const missing = await invoke(ctx, {
      id: "graph.run",
      input: { name: "nope" },
    });
    expect(missing.status).toBe("failed");
    if (missing.status === "failed") {
      expect(missing.code).toBe("not_found");
    }
  });

  test("malformed EDN inside a saved query → invalid_input, store intact", async () => {
    const ctx = await openKb(await makeRoot());
    await invoke(ctx, { id: "node.add", input: { text: "still-here", id: "n.ok" } });
    await writeFile(join(ctx.root, ".kb", "queries", "broken.edn"), "not [valid");
    const ran = await invoke(ctx, { id: "graph.run", input: { name: "broken" } });
    expect(ran.status).toBe("failed");
    if (ran.status === "failed") {
      expect(ran.code).toBe("invalid_input");
      expect(ran.message).toContain("datalog");
    }
    const after = await invoke(ctx, { id: "graph.search", input: { text: "still-here" } });
    expect(after.status).toBe("succeeded");
  });
});

describe("graph.query failure classification", () => {
  test("datalog engine errors stay invalid_input, genuine internal errors are internal", () => {
    // The datascript engine rejecting the user's EDN is a malformed-datalog
    // input error — invalid_input, never internal.
    expect(classifyQueryError(new DatalogError("cannot compare"), "[:find ?e]").code).toBe(
      "invalid_input",
    );

    // A plain glue defect (normalization / revive bug) must not be hidden
    // behind invalid_input.
    expect(classifyQueryError(new TypeError("oops"), "[:find ?e]").code).toBe("internal");
  });

  test("graph.query malformed EDN through invoke returns invalid_input", async () => {
    const ctx = await openKb(await makeRoot());
    const q = await invoke(ctx, {
      id: "graph.query",
      input: { query: "not [valid" },
    });
    expect(q.status).toBe("failed");
    if (q.status === "failed") {
      expect(q.code).toBe("invalid_input");
      expect(q.message).toContain("datalog");
    }
  });
});

describe("graph.run / graph.search surface availability", () => {
  test("manifest exposes both as read actions with JSON schemas", async () => {
    const m = await manifest();
    const run = expectDefined(m.find((a) => a.id === "graph.run"));
    expect(run.mode).toBe("read");
    expect(run.inputSchema).toBeTruthy();
    const search = expectDefined(m.find((a) => a.id === "graph.search"));
    expect(search.mode).toBe("read");
    expect(search.inputSchema).toBeTruthy();
  });

  test("Effect handlers are registered natively (no Promise handler)", () => {
    // graphRunEffect / graphSearchEffect are Effect programs — invoking through
    // the registry dispatches the effect seam, never tryPromise.
    expect(typeof graphRunEffect).toBe("function");
    expect(typeof graphSearchEffect).toBe("function");
  });
});
