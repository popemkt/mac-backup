import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { DOCS_VIEW_OPTION, SYSTEM_IDS, present, type KbNode } from "@kb/model";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKb } from "../src/session.ts";
import type { KbContext, TemplateContext } from "@kb/contracts";
import { invoke } from "../src/invoke.ts";
import { GENERATED_HEADER } from "@kb/operations";
import { todos } from "@kb/ext-docs";

const FIELD_ID = "01TESTFIELDSTATUS000000000";
const TAG_ID = "01TESTTAGTODO0000000000000";
const A_ID = "01TESTNODEA000000000000000";
const B_ID = "01TESTNODEB000000000000000";
const C_ID = "01TESTNODEC000000000000000";

const TODOS_QUERY =
  '[:find ?id :where [?n :f/sys.f.type ?tag] [?tag :node/text "todo"] [?tag :f/sys.f.type ?tagType] [?tagType :node/id "sys.tag"] [?n :node/id ?id]]';

const at = "2026-01-01T00:00:00.000Z";

function mkNode(id: string, text: string, status?: string): KbNode {
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
  await addDocsView(ctx, "todos", {
    output: "docs/kb/todos.md",
    query: TODOS_QUERY,
    template: "todos",
  });
  return ctx;
}

/** A docs view node named `name`, as any caller makes one: `node.add` with its props. */
async function addDocsView(
  ctx: KbContext,
  name: string,
  params: { output?: string; query?: string; savedQuery?: string; template?: string },
) {
  const field = {
    output: SYSTEM_IDS.viewOutputField,
    query: SYSTEM_IDS.lensQueryField,
    savedQuery: SYSTEM_IDS.viewSavedQueryField,
    template: SYSTEM_IDS.viewTemplateField,
  } as const;
  const props = [
    { field: SYSTEM_IDS.viewField, value: { t: "ref" as const, v: DOCS_VIEW_OPTION } },
    ...(["output", "query", "savedQuery", "template"] as const).flatMap((key) => {
      const v = params[key];
      return v === undefined ? [] : [{ field: field[key], value: { t: "str" as const, v } }];
    }),
  ];
  await mustInvoke(ctx, "node.add", { id: `docs.${name}`, text: name, props });
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
    expect(written.written).toEqual([{ view: "todos", output: "docs/kb/todos.md" }]);

    const content = await readFile(join(root, "docs/kb/todos.md"), "utf8");
    expect(content.startsWith(`${GENERATED_HEADER}\n`)).toBe(true);
    expect(content.endsWith("\n")).toBe(true);
    expect(content).toContain("- Ship M4");

    const check = (await mustInvoke(ctx, "docs.check", {})) as {
      clean: boolean;
      views: { view: string; output: string; status: string }[];
    };
    expect(check.clean).toBe(true);
    expect(check.views).toEqual([{ view: "todos", output: "docs/kb/todos.md", status: "clean" }]);
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
    expect(present(stale.views[0], "expected stale.views[0]").status).toBe("stale");

    await mustInvoke(ctx, "docs.materialize", { view: "todos" });
    const clean = (await mustInvoke(ctx, "docs.check", {})) as { clean: boolean };
    expect(clean.clean).toBe(true);

    await rm(join(root, "docs/kb/todos.md"));
    const missing = (await mustInvoke(ctx, "docs.check", {})) as {
      clean: boolean;
      views: { status: string }[];
    };
    expect(missing.clean).toBe(false);
    expect(present(missing.views[0], "expected missing.views[0]").status).toBe("missing");
  });

  test("a docs view is a view node: editing its query param changes what it renders", async () => {
    const ctx = await seedTodos(root);
    await mustInvoke(ctx, "docs.materialize", {});
    const onlyShip = `[:find ?id :where [?n :node/id ?id] [?n :node/text "Ship M4"]]`;
    await mustInvoke(ctx, "node.update", {
      id: "docs.todos",
      unsetProps: [{ field: SYSTEM_IDS.lensQueryField }],
      setProps: [{ field: SYSTEM_IDS.lensQueryField, value: { t: "str", v: onlyShip } }],
    });
    const stale = (await mustInvoke(ctx, "docs.check", {})) as { clean: boolean };
    expect(stale.clean).toBe(false);
    await mustInvoke(ctx, "docs.materialize", {});
    const content = await readFile(join(root, "docs/kb/todos.md"), "utf8");
    expect(content).toContain("- Ship M4");
    expect(content).not.toContain("Everything else");
  });

  test("a docs view that cannot be read is a warning; the others are still checked", async () => {
    const ctx = await seedTodos(root);
    await mustInvoke(ctx, "docs.materialize", {});
    await addDocsView(ctx, "bare", { output: "docs/kb/bare.md", query: TODOS_QUERY });
    const check = (await mustInvoke(ctx, "docs.check", {})) as {
      clean: boolean;
      views: { view: string; output: string; status: string }[];
      warnings: string[];
    };
    expect(check.views).toEqual([{ view: "todos", output: "docs/kb/todos.md", status: "clean" }]);
    expect(check.clean).toBe(true);
    expect(check.warnings).toEqual(["view bare has no template"]);
    const names = (await mustInvoke(ctx, "render.views", {})) as { views: string[] };
    expect(names.views).toEqual(["todos"]);
  });

  test("a docs view's name is refused when it is no workspace name or is taken", async () => {
    const ctx = await seedTodos(root);
    for (const text of ["has space", "todos"]) {
      const made = await invoke(ctx, {
        id: "node.add",
        input: {
          text,
          props: [{ field: SYSTEM_IDS.viewField, value: { t: "ref", v: DOCS_VIEW_OPTION } }],
        },
      });
      expect(made.status).toBe("failed");
    }
  });

  test("invalid docs views fail with typed receipts naming what is wrong", async () => {
    const ctx = await seedTodos(root);

    await addDocsView(ctx, "bare", { output: "docs/kb/bare.md", query: TODOS_QUERY });
    const bare = await invoke(ctx, { id: "docs.check", input: { view: "bare" } });
    expect(bare.status).toBe("failed");
    if (bare.status === "failed") {
      expect(bare.code).toBe("invalid_input");
      expect(bare.message).toContain("template");
    }

    await addDocsView(ctx, "escape", {
      output: "../outside.md",
      query: TODOS_QUERY,
      template: "todos",
    });
    const escape = await invoke(ctx, {
      id: "docs.check",
      input: { view: "escape" },
    });
    expect(escape.status).toBe("failed");
    if (escape.status === "failed") expect(escape.code).toBe("invalid_input");

    await addDocsView(ctx, "untpl", {
      output: "docs/kb/untpl.md",
      query: TODOS_QUERY,
      template: "nope",
    });
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

describe("views.migrate", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-views-migrate-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("imports .kb/views specs, a saved query kept, names each one it skips, and retires the imported files", async () => {
    const ctx = await seedTodos(root);
    await mkdir(join(root, ".kb", "views"), { recursive: true });
    await mkdir(join(root, ".kb", "queries"), { recursive: true });
    await writeFile(join(root, ".kb", "queries", "all-todos.edn"), TODOS_QUERY);
    const views = join(root, ".kb", "views");
    await writeFile(
      join(views, "saved.json"),
      JSON.stringify({ output: "docs/kb/saved.md", savedQuery: "all-todos", template: "todos" }),
    );
    await writeFile(join(views, "broken.json"), "{");
    await writeFile(
      join(views, "todos.json"),
      JSON.stringify({ output: "docs/kb/other.md", query: TODOS_QUERY, template: "todos" }),
    );
    await mustInvoke(ctx, "node.add", { id: "docs.taken", text: "not a docs view" });
    await writeFile(
      join(views, "taken.json"),
      JSON.stringify({ output: "docs/kb/taken.md", query: TODOS_QUERY, template: "todos" }),
    );

    const first = (await mustInvoke(ctx, "views.migrate", {})) as {
      changed: boolean;
      imported: string[];
      warnings: string[];
    };
    expect(first.changed).toBe(true);
    expect(first.imported).toEqual(["saved"]);
    expect(first.warnings).toEqual([
      ".kb/views/broken.json was not imported: it is not a spec kb can read",
      "docs.taken is a node that is no docs view; docs view taken was not imported",
      "docs view todos is already docs.todos; its spec file was not imported again",
    ]);
    expect((await readdir(views)).toSorted()).toEqual(["broken.json", "taken.json", "todos.json"]);

    const written = (await mustInvoke(ctx, "docs.materialize", { view: "saved" })) as {
      written: { view: string; output: string }[];
    };
    expect(written.written).toEqual([{ view: "saved", output: "docs/kb/saved.md" }]);
    expect(await readFile(join(root, "docs/kb/saved.md"), "utf8")).toContain("- Ship M4");

    const again = (await mustInvoke(ctx, "views.migrate", {})) as { changed: boolean };
    expect(again.changed).toBe(false);
  });
});
