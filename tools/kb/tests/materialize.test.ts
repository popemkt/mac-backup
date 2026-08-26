import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKb, type KbContext } from "../src/context.ts";
import { invoke } from "../src/registry.ts";
import { todos, type TemplateContext } from "../src/operations/docs/templates.ts";
import { GENERATED_HEADER } from "../src/operations/docs/index.ts";
import type { KbNode } from "../src/foundation/model.ts";

const FIELD_ID = "01TESTFIELDSTATUS000000000";
const TAG_ID = "01TESTTAGTODO0000000000000";
const A_ID = "01TESTNODEA000000000000000";
const B_ID = "01TESTNODEB000000000000000";
const C_ID = "01TESTNODEC000000000000000";

const TODOS_QUERY =
  '[:find ?id :where [?n :f/sys.f.type ?tag] [?tag :node/text "todo"] [?tag :f/sys.f.type ?tagType] [?tagType :node/id "sys.tag"] [?n :node/id ?id]]';

const at = "2026-01-01T00:00:00.000Z";

function mkNode(
  id: string,
  text: string,
  status?: string,
): KbNode {
  return {
    id,
    text,
    props: status === undefined ? {} : { [FIELD_ID]: [{ t: "str", v: status }] },
    children: [],
    createdAt: at,
    updatedAt: at,
  };
}

async function mustInvoke(ctx: KbContext, id: string, input: unknown) {
  const r = await invoke(ctx, { id, input });
  expect(r.status).toBe("succeeded");
  if (r.status !== "succeeded") throw new Error(`${id} failed`);
  return r.output;
}

async function seedTodos(root: string): Promise<KbContext> {
  const ctx = await openKb(root);
  await mustInvoke(ctx, "field.define", { name: "status", id: FIELD_ID });
  await mustInvoke(ctx, "tag.define", {
    name: "todo",
    fields: ["status"],
    id: TAG_ID,
  });
  await mustInvoke(ctx, "node.add", {
    id: A_ID,
    text: `Write docs [[${B_ID}|the plan]]`,
    tags: ["todo"],
    props: [{ field: "status", value: { t: "str", v: "doing" } }],
  });
  await mustInvoke(ctx, "node.add", {
    id: B_ID,
    text: "Ship M4",
    tags: ["todo"],
    props: [{ field: "status", value: { t: "str", v: "todo" } }],
  });
  await mustInvoke(ctx, "node.add", {
    id: C_ID,
    text: "Everything else",
    tags: ["todo"],
  });
  await mkdir(join(root, ".kb", "views"), { recursive: true });
  await writeFile(
    join(root, ".kb", "views", "todos.json"),
    JSON.stringify(
      { output: "docs/kb/todos.md", query: TODOS_QUERY, template: "todos" },
      null,
      2,
    ),
  );
  return ctx;
}

describe("templates", () => {
  test("todos snapshot: grouped by status, mentions rendered, deterministic", () => {
    const nodes = [
      mkNode(A_ID, `Write docs [[${B_ID}|the plan]]`, "doing"),
      mkNode(B_ID, "Ship M4", "todo"),
      mkNode(C_ID, "Everything else"),
    ];
    const tctx: TemplateContext = {
      nodes: new Map(nodes.map((n) => [n.id, n])),
      fieldIdByName: (name) => (name === "status" ? FIELD_ID : undefined),
    };
    // reversed row order must not change output
    const rows = [[C_ID], [B_ID], [A_ID]];
    const md = todos(rows, tctx);
    expect(md).toBe(
      [
        "# Todos",
        "",
        "## doing",
        "",
        "- Write docs the plan",
        "",
        "## todo",
        "",
        "- Ship M4",
        "",
        "## (no status)",
        "",
        "- Everything else",
      ].join("\n"),
    );
  });

  test("todos renders empty state", () => {
    const tctx: TemplateContext = {
      nodes: new Map(),
      fieldIdByName: () => undefined,
    };
    expect(todos([], tctx)).toBe("# Todos\n\n_No todos._");
  });

  test("todos snapshot with project hierarchy: grouped by project then status", () => {
    const PROJ_TAG_ID = "01TESTPROJTAG";
    const PROJ_A_ID = "01PROJA";
    const PROJ_B_ID = "01PROJB";
    const tagNode: KbNode = {
      id: PROJ_TAG_ID,
      text: "project",
      props: { "sys.f.type": [{ t: "ref", v: "sys.tag" }] },
      children: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const projANode: KbNode = {
      id: PROJ_A_ID,
      text: ".dotfiles",
      props: { "sys.f.type": [{ t: "ref", v: PROJ_TAG_ID }] },
      children: [A_ID],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const projBNode: KbNode = {
      id: PROJ_B_ID,
      text: "kb",
      props: { "sys.f.type": [{ t: "ref", v: PROJ_TAG_ID }] },
      children: [B_ID],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const nodes = [
      tagNode,
      projANode,
      projBNode,
      mkNode(A_ID, "Nix config", "doing"),
      mkNode(B_ID, "Core engine", "todo"),
      mkNode(C_ID, "Unassigned task", "todo"),
    ];
    const tctx: TemplateContext = {
      nodes: new Map(nodes.map((n) => [n.id, n])),
      fieldIdByName: (name) => (name === "status" ? FIELD_ID : undefined),
    };
    const rows = [[C_ID], [B_ID], [A_ID]];
    const md = todos(rows, tctx);
    expect(md).toBe(
      [
        "# Todos",
        "",
        "## .dotfiles",
        "",
        "### doing",
        "",
        "- Nix config",
        "",
        "## kb",
        "",
        "### todo",
        "",
        "- Core engine",
        "",
        "## (other)",
        "",
        "### todo",
        "",
        "- Unassigned task",
      ].join("\n"),
    );
  });
});

describe("docs.materialize + docs.check", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-m4-test-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("materialize writes header'd file; check reports clean", async () => {
    const ctx = await seedTodos(root);

    const written = (await mustInvoke(ctx, "docs.materialize", {})) as {
      written: { view: string; output: string }[];
    };
    expect(written.written).toEqual([
      { view: "todos", output: "docs/kb/todos.md" },
    ]);

    const content = await readFile(join(root, "docs/kb/todos.md"), "utf8");
    expect(content.startsWith(`${GENERATED_HEADER}\n`)).toBe(true);
    expect(content.endsWith("\n")).toBe(true);
    expect(content).toContain("- Ship M4");

    const check = (await mustInvoke(ctx, "docs.check", {})) as {
      clean: boolean;
      views: { view: string; output: string; status: string }[];
    };
    expect(check.clean).toBe(true);
    expect(check.views).toEqual([
      { view: "todos", output: "docs/kb/todos.md", status: "clean" },
    ]);
  });

  test("mutating a node makes check report stale; deleting output reports missing", async () => {
    const ctx = await seedTodos(root);
    await mustInvoke(ctx, "docs.materialize", {});

    await mustInvoke(ctx, "node.update", { id: B_ID, text: "Ship M4 now" });
    const stale = (await mustInvoke(ctx, "docs.check", {})) as {
      clean: boolean;
      views: { status: string }[];
    };
    expect(stale.clean).toBe(false);
    expect(stale.views[0]!.status).toBe("stale");

    await mustInvoke(ctx, "docs.materialize", { view: "todos" });
    const clean = (await mustInvoke(ctx, "docs.check", {})) as { clean: boolean };
    expect(clean.clean).toBe(true);

    await rm(join(root, "docs/kb/todos.md"));
    const missing = (await mustInvoke(ctx, "docs.check", {})) as {
      clean: boolean;
      views: { status: string }[];
    };
    expect(missing.clean).toBe(false);
    expect(missing.views[0]!.status).toBe("missing");
  });

  test("savedQuery views resolve from .kb/queries", async () => {
    const ctx = await seedTodos(root);
    await mkdir(join(root, ".kb", "queries"), { recursive: true });
    await writeFile(join(root, ".kb", "queries", "todos.edn"), TODOS_QUERY);
    await writeFile(
      join(root, ".kb", "views", "todos.json"),
      JSON.stringify(
        { output: "docs/kb/todos.md", savedQuery: "todos", template: "todos" },
        null,
        2,
      ),
    );
    await mustInvoke(ctx, "docs.materialize", {});
    const check = (await mustInvoke(ctx, "docs.check", {})) as { clean: boolean };
    expect(check.clean).toBe(true);
  });

  test("invalid view specs fail with typed receipts", async () => {
    const ctx = await seedTodos(root);

    await writeFile(
      join(root, ".kb", "views", "bad.json"),
      JSON.stringify({
        output: "docs/kb/bad.md",
        query: TODOS_QUERY,
        savedQuery: "todos",
        template: "todos",
      }),
    );
    const both = await invoke(ctx, { id: "docs.check", input: { view: "bad" } });
    expect(both.status).toBe("failed");
    if (both.status === "failed") expect(both.code).toBe("invalid_input");

    await writeFile(
      join(root, ".kb", "views", "escape.json"),
      JSON.stringify({
        output: "../outside.md",
        query: TODOS_QUERY,
        template: "todos",
      }),
    );
    const escape = await invoke(ctx, {
      id: "docs.check",
      input: { view: "escape" },
    });
    expect(escape.status).toBe("failed");
    if (escape.status === "failed") expect(escape.code).toBe("invalid_input");

    await writeFile(
      join(root, ".kb", "views", "untpl.json"),
      JSON.stringify({
        output: "docs/kb/untpl.md",
        query: TODOS_QUERY,
        template: "nope",
      }),
    );
    const untpl = await invoke(ctx, {
      id: "docs.check",
      input: { view: "untpl" },
    });
    expect(untpl.status).toBe("failed");
    if (untpl.status === "failed") expect(untpl.code).toBe("invalid_input");

    const gone = await invoke(ctx, {
      id: "docs.materialize",
      input: { view: "ghost" },
    });
    expect(gone.status).toBe("failed");
    if (gone.status === "failed") expect(gone.code).toBe("not_found");
  });
});
