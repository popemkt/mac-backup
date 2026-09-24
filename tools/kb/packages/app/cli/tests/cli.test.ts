import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mapActionInvoke,
  mapAdd,
  mapBacklinks,
  mapChildren,
  mapFieldDefine,
  mapFieldList,
  mapGet,
  mapMv,
  mapQuery,
  mapRm,
  mapRun,
  mapSearch,
  mapSet,
  mapTagDefine,
  mapTagList,
  mapUnset,
  declaredTypes,
  parseFieldValue,
  parsePropArg,
  UsageError,
} from "@kb/operations";
import {
  SYSTEM_IDS,
  fieldTypeValue,
  systemSeedNodes,
  type FieldType,
  type KbNode,
} from "@kb/model";
import { main } from "../src/cli.ts";

describe("arg → invocation mapping", () => {
  test("mapAdd builds node.add input", () => {
    const plan = mapAdd({
      text: "Ship it",
      parent: "01PARENT",
      position: 2,
      tags: ["todo"],
      props: [
        { field: "status", value: { t: "str", v: "doing" } },
        { field: "priority", value: { t: "num", v: 1 } },
      ],
    });
    expect(plan.id).toBe("node.add");
    expect(plan.input).toEqual({
      text: "Ship it",
      parent: "01PARENT",
      position: 2,
      tags: ["todo"],
      props: [
        { field: "status", value: { t: "str", v: "doing" } },
        { field: "priority", value: { t: "num", v: 1 } },
      ],
    });
  });

  test("mapSet / mapUnset / mapRm / mapMv", () => {
    expect(mapSet({ id: "n1", field: "status", value: { t: "str", v: "done" } }).input).toEqual({
      id: "n1",
      setProps: [{ field: "status", value: { t: "str", v: "done" } }],
    });
    expect(mapUnset({ id: "n1", field: "status" }).input).toEqual({
      id: "n1",
      unsetProps: [{ field: "status" }],
    });
    expect(mapRm({ id: "n1" }).input).toEqual({ id: "n1", delete: true });
    expect(mapMv({ id: "n1", parent: "p1", position: 0 }).input).toEqual({
      id: "n1",
      parent: "p1",
      position: 0,
    });
    expect(mapMv({ id: "n1", parent: null }).input).toEqual({
      id: "n1",
      parent: null,
    });
    expect(mapMv({ id: "n1", parent: "sys.field", force: true }).input).toEqual({
      id: "n1",
      parent: "sys.field",
      force: true,
    });
  });

  test("mapGet depth defaults to 1", () => {
    expect(mapGet({ id: "n1" }).input).toEqual({ id: "n1", depth: 1 });
    expect(mapGet({ id: "n1", depth: 3 }).input).toEqual({
      id: "n1",
      depth: 3,
    });
  });

  test("field/tag define + list map to registry actions", () => {
    expect(mapFieldDefine({ name: "status" })).toEqual({
      id: "field.define",
      input: { name: "status" },
    });
    expect(mapTagDefine({ name: "todo", fields: ["status"] }).input).toEqual({
      name: "todo",
      fields: ["status"],
    });
    expect(mapFieldList().id).toBe("graph.query");
    expect(mapTagList().id).toBe("graph.query");
  });

  test("query / run / search / backlinks / children", () => {
    expect(mapQuery({ query: "[:find ?e :where [?e]]" }).input).toEqual({
      query: "[:find ?e :where [?e]]",
    });
    expect(mapRun("all-text")).toEqual({
      id: "graph.run",
      input: { name: "all-text" },
    });
    // Names that can never resolve stay a usage error at the CLI edge; the
    // action owns .kb/queries resolution + read + execution.
    expect(() => mapRun("../escape")).toThrow();
    expect(mapSearch("todo")).toEqual({
      id: "graph.search",
      input: { text: "todo" },
    });
    expect(mapBacklinks("sys.tag").id).toBe("graph.query");
    expect((mapBacklinks("sys.tag").input as { query: string }).query).toContain('"sys.tag"');
    expect(mapChildren("n1").input).toEqual({ id: "n1", depth: 1 });
  });

  test("mapActionInvoke requires id", () => {
    expect(mapActionInvoke({ id: "node.get", input: { id: "x" } })).toEqual({
      id: "node.get",
      input: { id: "x" },
    });
    expect(mapActionInvoke({ id: "graph.query" }).input).toEqual({});
    expect(() => mapActionInvoke({})).toThrow();
  });

  test("parseFieldValue reads an argument as the declared type, never by its shape", () => {
    expect(parseFieldValue("42", "text", "f")).toEqual({ t: "str", v: "42" });
    expect(parseFieldValue("true", "text", "f")).toEqual({ t: "str", v: "true" });
    expect(parseFieldValue("42", "number", "f")).toEqual({ t: "num", v: 42 });
    expect(parseFieldValue("-3.5", "number", "f")).toEqual({ t: "num", v: -3.5 });
    expect(parseFieldValue("true", "checkbox", "f")).toEqual({ t: "bool", v: true });
    expect(parseFieldValue("false", "checkbox", "f")).toEqual({ t: "bool", v: false });
    expect(parseFieldValue("42", "ref", "f")).toEqual({ t: "ref", v: "42" });
    expect(parseFieldValue("https://x.dev", "url", "f")).toEqual({ t: "str", v: "https://x.dev" });
    expect(parseFieldValue("2026-09-24", "date", "f")).toEqual({ t: "str", v: "2026-09-24" });
    for (const [raw, type] of [
      ["abc", "number"],
      ["", "number"],
      ["Infinity", "number"],
      ["yes", "checkbox"],
      ["1", "checkbox"],
    ] as const satisfies readonly (readonly [string, FieldType])[]) {
      expect(() => parseFieldValue(raw, type, "f")).toThrow(UsageError);
    }
  });

  test("declaredTypes resolves a field by name or id; a missing one is text", () => {
    const estimate: KbNode = {
      id: "f.estimate",
      text: "estimate",
      props: {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
        [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("number")],
      },
      children: [],
      createdAt: "",
      updatedAt: "",
    };
    const typeOf = declaredTypes([...systemSeedNodes(), estimate]);
    expect(typeOf("estimate")).toBe("number");
    expect(typeOf("f.estimate")).toBe("number");
    expect(typeOf("type")).toBe("ref");
    expect(typeOf("sys.f.hidden")).toBe("checkbox");
    expect(typeOf("not-yet-minted")).toBe("text");
    expect(parsePropArg("estimate=3", typeOf)).toEqual({
      field: "estimate",
      value: { t: "num", v: 3 },
    });
    expect(() => parsePropArg("estimate", typeOf)).toThrow(UsageError);
  });
});

describe("cli e2e (tmpdir)", () => {
  let root: string;
  let prevExit: string | number | null | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-cli-"));
    prevExit = process.exitCode;
    process.exitCode = 0;
  });

  afterEach(async () => {
    process.exitCode = prevExit;
    await rm(root, { recursive: true, force: true });
  });

  async function kb(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const outWrite = process.stdout.write.bind(process.stdout);
    const errWrite = process.stderr.write.bind(process.stderr);
    process.stdout.write = (chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    };
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    };
    try {
      process.exitCode = 0;
      const code = await main(["bun", "kb", "--root", root, "--json", ...args]);
      return {
        code,
        stdout: stdout.join(""),
        stderr: stderr.join(""),
      };
    } finally {
      process.stdout.write = outWrite;
      process.stderr.write = errWrite;
    }
  }

  test("init seeds example content, and --bare does not", async () => {
    const withExamples = await kb(["init", "--json"]);
    expect(withExamples.code).toBe(0);
    const seeded = JSON.parse(withExamples.stdout);
    expect(seeded.output.exampleNodes).toBeGreaterThan(0);

    const nodes = await readFile(join(root, ".kb", "nodes.jsonl"), "utf8");
    expect(nodes).toContain("ex.tag.task");
    expect(nodes).toContain("ex.onto.work");

    // Re-running init must not duplicate them, and must not resurrect any the
    // owner deleted: the store is no longer pristine.
    const again = await kb(["init", "--json"]);
    expect(again.code).toBe(0);
    expect(JSON.parse(again.stdout).output.exampleNodes).toBe(0);
  });

  test("init --bare leaves a store with nothing but its system seed", async () => {
    const bare = await kb(["init", "--bare", "--json"]);
    expect(bare.code).toBe(0);
    expect(JSON.parse(bare.stdout).output.exampleNodes).toBe(0);
    const nodes = await readFile(join(root, ".kb", "nodes.jsonl"), "utf8");
    expect(nodes).toContain("sys.field");
    expect(nodes).not.toContain("ex.");
  });

  test("set parses its value as the field's declared type", async () => {
    expect((await kb(["init", "--bare"])).code).toBe(0);
    expect((await kb(["field", "define", "label"])).code).toBe(0);
    expect((await kb(["field", "define", "estimate"])).code).toBe(0);
    expect((await kb(["field", "type", "estimate", "number"])).code).toBe(0);
    expect((await kb(["field", "define", "owner"])).code).toBe(0);
    expect((await kb(["field", "type", "owner", "ref"])).code).toBe(0);
    const task = JSON.parse((await kb(["add", "Task", "--id", "n.task"])).stdout).output.id;
    await kb(["add", "Ada", "--id", "n.ada"]);

    const props = async (): Promise<Record<string, unknown>> =>
      JSON.parse((await kb(["get", task, "--depth", "0"])).stdout).output.node.props;
    const fieldId = async (name: string): Promise<string> => {
      const rows = JSON.parse((await kb(["field", "list"])).stdout).output.rows as string[][];
      return rows.find((r) => r[1] === name)?.[0] ?? "";
    };

    expect((await kb(["set", task, "label", "42"])).code).toBe(0);
    expect((await kb(["set", task, "estimate", "42"])).code).toBe(0);
    expect((await kb(["set", task, "owner", "n.ada"])).code).toBe(0);
    const after = await props();
    expect(after[await fieldId("label")]).toEqual([{ t: "str", v: "42" }]);
    expect(after[await fieldId("estimate")]).toEqual([{ t: "num", v: 42 }]);
    expect(after[await fieldId("owner")]).toEqual([{ t: "ref", v: "n.ada" }]);

    // Unreadable as the type: a usage error, before any write.
    const abc = await kb(["set", task, "estimate", "abc"]);
    expect(abc.code).toBe(2);
    expect(JSON.parse(abc.stdout)).toMatchObject({ status: "failed", code: "invalid_input" });
    // Readable, but naming no node: the write check refuses it.
    const dangling = await kb(["set", task, "owner", "no-such-node"]);
    expect(dangling.code).toBe(1);
    expect(JSON.parse(dangling.stdout)).toMatchObject({ status: "failed", code: "invalid_input" });
    expect(await props()).toEqual(after);

    // --prop on add goes through the same parse.
    const added = await kb(["add", "Other", "--prop", "estimate=7", "--prop", "label=7"]);
    const node = JSON.parse(added.stdout).output.node;
    expect(node.props[await fieldId("estimate")]).toEqual([{ t: "num", v: 7 }]);
    expect(node.props[await fieldId("label")]).toEqual([{ t: "str", v: "7" }]);
  });

  test("init → add → query → get", async () => {
    // --bare: this exercises CLI mechanics on a clean store. Example content
    // deliberately occupies ordinary names like "status", so a non-bare init
    // would make `field define status` report the existing field instead.
    const init = await kb(["init", "--bare"]);
    expect(init.code).toBe(0);
    const nodesPath = join(root, ".kb", "nodes.jsonl");
    expect(await readFile(nodesPath, "utf8")).toContain("sys.field");

    await mkdir(join(root, ".kb", "queries"), { recursive: true });

    const field = await kb(["field", "define", "status"]);
    expect(field.code).toBe(0);

    const tag = await kb(["tag", "define", "todo", "--field", "status"]);
    expect(tag.code).toBe(0);

    const add = await kb(["add", "Ship M2 CLI", "--tag", "todo", "--prop", "status=doing"]);
    expect(add.code).toBe(0);
    const addOut = JSON.parse(add.stdout);
    expect(addOut.status).toBe("succeeded");
    const nodeId = addOut.output.id as string;

    const query = await kb([
      "query",
      `[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]`,
    ]);
    expect(query.code).toBe(0);
    const qOut = JSON.parse(query.stdout);
    expect(qOut.status).toBe("succeeded");
    const rows = qOut.output.rows as unknown[][];
    expect(rows.some((r) => r[0] === nodeId && r[1] === "Ship M2 CLI")).toBe(true);

    const got = await kb(["get", nodeId, "--depth", "0"]);
    expect(got.code).toBe(0);
    const gOut = JSON.parse(got.stdout);
    expect(gOut.status).toBe("succeeded");
    expect(gOut.output.node.text).toBe("Ship M2 CLI");

    await writeFile(
      join(root, ".kb", "queries", "all-text.edn"),
      `[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]\n`,
    );
    const run = await kb(["run", "all-text"]);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout).status).toBe("succeeded");

    const search = await kb(["search", "Ship M2"]);
    expect(search.code).toBe(0);
    const sRows = JSON.parse(search.stdout).output.rows as unknown[][];
    expect(sRows.some((r) => r[0] === nodeId)).toBe(true);

    const invoke = await kb([
      "action-invoke",
      JSON.stringify({ id: "node.get", input: { id: nodeId, depth: 0 } }),
    ]);
    expect(invoke.code).toBe(0);
    expect(JSON.parse(invoke.stdout).status).toBe("succeeded");
  });

  test("query and run trace a mention chain with reach", async () => {
    await kb(["init", "--bare"]);
    const added: string[] = [];
    for (let i = 0; i < 4; i++) {
      const prev = added.at(-1);
      const add = await kb(["add", prev === undefined ? "origin" : `step ${i} after [[${prev}]]`]);
      expect(add.code).toBe(0);
      added.push(JSON.parse(add.stdout).output.id as string);
    }
    const [origin, , , last] = added;
    const edn = `[:find ?id :where [?r :node/id "${last}"] (reach ?r :node/mentions ?n) [?n :node/id ?id]]`;

    const query = await kb(["query", edn]);
    expect(query.code).toBe(0);
    const rows = JSON.parse(query.stdout).output.rows as unknown[][];
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r[0]))).toEqual(new Set(added.slice(0, 3)));
    expect(rows.map((r) => r[0])).toContain(origin);

    await mkdir(join(root, ".kb", "queries"), { recursive: true });
    await writeFile(
      join(root, ".kb", "queries", "one-hop.edn"),
      edn.replace("?n)", "?n 1)") + "\n",
    );
    const run = await kb(["run", "one-hop"]);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout).output.rows).toEqual([[added[2]]]);
  });

  test("usage errors exit 2", async () => {
    await kb(["init"]);
    const bad = await kb(["mv", "missing-id"]);
    expect(bad.code).toBe(2);
  });

  test("action-invoke malformed JSON preserves JSON.parse diagnostics", async () => {
    await kb(["init"]);
    const bad = await kb(["action-invoke", "{not-json"]);
    expect(bad.code).toBe(2);
    const msg = `${bad.stderr}${bad.stdout}`;
    expect(msg).toContain("invalid JSON:");
    // Native JSON.parse wording (Bun/JS), not Schema's "valid JSON string".
    expect(msg).toMatch(/JSON Parse error|Unexpected|Expected/i);
    expect(msg).not.toContain("Expected a valid JSON string");
  });

  test("action-invoke stdin I/O failure exits 1, not UsageError 2", async () => {
    await kb(["init"]);
    const prevStdin = process.stdin;
    const broken = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            return Promise.reject(new Error("EIO: simulated stdin failure"));
          },
        };
      },
    };
    Object.defineProperty(process, "stdin", {
      value: broken,
      configurable: true,
      writable: true,
    });
    try {
      const result = await kb(["action-invoke", "-"]);
      expect(result.code).toBe(1);
      const msg = `${result.stderr}${result.stdout}`;
      expect(msg).toContain("EIO: simulated stdin failure");
    } finally {
      Object.defineProperty(process, "stdin", {
        value: prevStdin,
        configurable: true,
        writable: true,
      });
    }
  });

  test("field type/target/target-query with unknown field/tag exit 1 not_found", async () => {
    await kb(["init"]);
    await kb(["field", "define", "status"]);
    await kb(["tag", "define", "todo"]);

    const typeBad = await kb(["field", "type", "no-such-field", "text"]);
    expect(typeBad.code).toBe(1);
    expect(JSON.parse(typeBad.stdout).code).toBe("not_found");

    const targetBadField = await kb(["field", "target", "no-such-field", "todo"]);
    expect(targetBadField.code).toBe(1);
    expect(JSON.parse(targetBadField.stdout).code).toBe("not_found");

    const targetBadTag = await kb(["field", "target", "status", "no-such-tag"]);
    expect(targetBadTag.code).toBe(1);
    expect(JSON.parse(targetBadTag.stdout).code).toBe("not_found");

    const tqBad = await kb(["field", "target-query", "no-such-field", "[:find ?x]"]);
    expect(tqBad.code).toBe(1);
    expect(JSON.parse(tqBad.stdout).code).toBe("not_found");
  });

  test("query with malformed EDN exits 1 invalid_input", async () => {
    await kb(["init"]);
    const q = await kb(["query", "not [valid"]);
    expect(q.code).toBe(1);
    const body = JSON.parse(q.stdout);
    expect(body.status).toBe("failed");
    expect(body.code).toBe("invalid_input");
  });

  test("run routes through graph.run: missing saved query is not_found, invalid name is usage error", async () => {
    await kb(["init"]);
    const missing = await kb(["run", "no-such-query"]);
    expect(missing.code).toBe(1);
    expect(JSON.parse(missing.stdout).code).toBe("not_found");

    const badName = await kb(["run", "../escape"]);
    expect(badName.code).toBe(2);
    expect(`${badName.stderr}${badName.stdout}`).toContain("invalid saved query name");

    // Malformed EDN inside a valid saved query is invalid_input, not internal.
    await writeFile(join(root, ".kb", "queries", "broken.edn"), "not [valid");
    const broken = await kb(["run", "broken"]);
    expect(broken.code).toBe(1);
    expect(JSON.parse(broken.stdout).code).toBe("invalid_input");
  });

  test("mv / add under a sys.* parent require --force", async () => {
    await kb(["init"]);
    const add = await kb(["add", "victim"]);
    expect(add.code).toBe(0);
    const victimId = JSON.parse(add.stdout).output.id as string;

    const blockedMv = await kb(["mv", victimId, "sys.tag"]);
    expect(blockedMv.code).toBe(1);
    expect(JSON.parse(blockedMv.stdout).code).toBe("forbidden");

    const blockedAdd = await kb(["add", "evil", "--parent", "sys.tag"]);
    expect(blockedAdd.code).toBe(1);
    expect(JSON.parse(blockedAdd.stdout).code).toBe("forbidden");

    const forcedAdd = await kb(["add", "minted", "--id", "sys.evil", "--force"]);
    expect(forcedAdd.code).toBe(0);
  });
});
