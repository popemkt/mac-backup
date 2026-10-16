/**
 * `node.addTree` through the registry every surface invokes: a whole outline
 * lands as one transaction — every node and prop, one log record — or, when
 * any line is wrong, nothing lands at all.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DECISION_OPTION_IDS,
  SYSTEM_IDS,
  fieldTypeValue,
  type FieldType,
  type KbNode,
} from "@kb/model";
import type { ActionReceipt } from "@kb/contracts";
import { invoke } from "../src/invoke.ts";
import { openKb } from "../src/session.ts";

type Kb = Awaited<ReturnType<typeof openKb>>;

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function session(): Promise<{ root: string; ctx: Kb }> {
  const root = await mkdtemp(join(tmpdir(), "kb-add-tree-"));
  roots.push(root);
  return { root, ctx: await openKb(root) };
}

async function succeed(receipt: Promise<ActionReceipt>): Promise<unknown> {
  const r = await receipt;
  if (r.status !== "succeeded") throw new Error(`${r.code}: ${r.message}`);
  return r.output;
}

async function typedField(ctx: Kb, id: string, type: FieldType): Promise<void> {
  await succeed(invoke(ctx, { id: "field.define", input: { name: id, id } }));
  await succeed(
    invoke(ctx, {
      id: "node.update",
      input: { id, setProps: [{ field: SYSTEM_IDS.fieldTypeField, value: fieldTypeValue(type) }] },
    }),
  );
}

/** A store with a tag, a typed field of each kind the outline uses, and a host node. */
async function seeded(): Promise<{ root: string; ctx: Kb }> {
  const kb = await session();
  await succeed(invoke(kb.ctx, { id: "tag.define", input: { name: "project", id: "t.project" } }));
  await succeed(invoke(kb.ctx, { id: "tag.define", input: { name: "needs review", id: "t.nr" } }));
  await typedField(kb.ctx, "estimate", "number");
  await typedField(kb.ctx, "owner", "ref");
  await typedField(kb.ctx, "note", "text");
  await succeed(invoke(kb.ctx, { id: "node.add", input: { id: "n.host", text: "Host" } }));
  await succeed(
    invoke(kb.ctx, { id: "node.add", input: { id: "n.first", text: "First", parent: "n.host" } }),
  );
  await succeed(
    invoke(kb.ctx, { id: "node.add", input: { id: "n.last", text: "Last", parent: "n.host" } }),
  );
  return kb;
}

function node(ctx: Kb, id: string): KbNode {
  const found = ctx.nodes.find((n) => n.id === id);
  if (found === undefined) throw new Error(`missing ${id}`);
  return found;
}

/** `groups` top-level items of `size` children each, every item's text unique. */
function outlineOf(groups: number, size: number): string {
  const lines: string[] = [];
  for (let g = 0; g < groups; g++) {
    lines.push(`- group ${g}`);
    for (let c = 0; c < size; c++) lines.push(`  - item ${g}.${c}`);
  }
  return lines.join("\n");
}

const OUTLINE = [
  "%%tana%%",
  "- Launch #project",
  "  - estimate:: 3",
  "  - owner:: [[Ada]]",
  "  - note::",
  "    - see [[Ada]]",
  "    - and [[n.first|the first]]",
  "  - Brief #[[needs review]]",
  "    - links back to [[Launch]]",
  "- Ada",
].join("\n");

describe("node.addTree", () => {
  test("lands the whole outline under parent at position, in tree order, with each line's id", async () => {
    const { root, ctx } = await seeded();
    const head = ctx.log.head;
    const output = (await succeed(
      invoke(ctx, {
        id: "node.addTree",
        input: { outline: OUTLINE, parent: "n.host", position: 1 },
      }),
    )) as { ids: string[]; lines: Record<string, string> };

    expect(ctx.log.head).toBe(head + 1);
    expect(output.ids).toHaveLength(4);
    const [launch, brief, back, ada] = output.ids as [string, string, string, string];
    expect(output.lines).toEqual({ "2": launch, "8": brief, "9": back, "10": ada });

    expect(node(ctx, "n.host").children).toEqual(["n.first", launch, ada, "n.last"]);
    expect(node(ctx, launch).children).toEqual([brief]);
    expect(node(ctx, brief).children).toEqual([back]);

    const l = node(ctx, launch);
    expect(l.text).toBe("Launch");
    expect(l.props[SYSTEM_IDS.typeField]).toEqual([{ t: "ref", v: "t.project" }]);
    expect(l.props["estimate"]).toEqual([{ t: "num", v: 3 }]);
    expect(l.props["owner"]).toEqual([{ t: "ref", v: ada }]);
    expect(l.props["note"]).toEqual([
      { t: "str", v: `see [[${ada}|Ada]]` },
      { t: "str", v: "and [[n.first|the first]]" },
    ]);
    expect(node(ctx, brief).props[SYSTEM_IDS.typeField]).toEqual([{ t: "ref", v: "t.nr" }]);
    expect(node(ctx, back).text).toBe(`links back to [[${launch}|Launch]]`);

    const reopened = await openKb(root);
    expect(reopened.nodes.find((n) => n.id === "n.host")?.children).toEqual(
      node(ctx, "n.host").children,
    );
  });

  test("without a parent the top-level items are forest roots, appended in order", async () => {
    const { ctx } = await session();
    const output = (await succeed(
      invoke(ctx, { id: "node.addTree", input: { outline: "- one\n- two\n  - inner\n- three" } }),
    )) as { ids: string[] };
    const [one, two, , three] = output.ids as [string, string, string, string];
    const forest = ctx.nodes
      .filter((n) => !ctx.nodes.some((p) => p.children.includes(n.id)))
      .toSorted((a, b) => ((a.order ?? "") < (b.order ?? "") ? -1 : 1))
      .map((n) => n.id);
    expect(forest.slice(-3)).toEqual([one, two, three]);
  });

  describe("a failure anywhere in the tree writes nothing, and names its line", () => {
    const failures: ReadonlyArray<readonly [string, string, string, number]> = [
      ["a late unresolved ref", "- a\n  - b\n- c [[Nobody]]", "not_found", 3],
      ["an unknown tag", "- a\n  - b #nope", "not_found", 2],
      ["an unknown field", "- a\n- b\n  - colour:: red", "not_found", 3],
      ["a value its field cannot hold", "- a\n  - estimate:: lots", "invalid_input", 2],
      ["an ambiguous ref", "- x\n- x\n- see [[x]]", "ambiguous", 3],
      ["a syntax error", "- a\n    - b\n  - c", "invalid_input", 3],
      ["prose around a ref field's token", "- a\n  - owner:: see [[n.first]]", "invalid_input", 2],
      [
        "a second value for a one-valued field",
        "- a\n  - one:: [[n.first]]\n  - one:: [[n.last]]",
        "invalid_input",
        3,
      ],
      [
        "a nested second value for a one-valued field",
        "- a\n  - one:: [[n.first]]\n    - [[n.last]]",
        "invalid_input",
        3,
      ],
    ];
    for (const [name, outline, code, line] of failures) {
      test(name, async () => {
        const { root, ctx } = await seeded();
        await typedField(ctx, "one", "ref");
        await succeed(
          invoke(ctx, {
            id: "node.update",
            input: {
              id: "one",
              setProps: [
                { field: "sys.f.cardinality", value: { t: "ref", v: "sys.cardinality.one" } },
              ],
            },
          }),
        );
        const before = await readFile(join(root, ".kb", "nodes.jsonl"), "utf8");
        const head = ctx.log.head;
        const count = ctx.nodes.length;

        const receipt = await invoke(ctx, {
          id: "node.addTree",
          input: { outline, parent: "n.host" },
        });
        expect(receipt).toMatchObject({ status: "failed", code, details: { line } });
        if (receipt.status === "failed") {
          expect(receipt.message.startsWith(`outline line ${line}: `)).toBe(true);
        }

        expect(ctx.log.head).toBe(head);
        expect(ctx.nodes).toHaveLength(count);
        expect(node(ctx, "n.host").children).toEqual(["n.first", "n.last"]);
        expect(await readFile(join(root, ".kb", "nodes.jsonl"), "utf8")).toBe(before);
      });
    }
  });

  test("planning reads the stored graph once, however many items the outline has", async () => {
    const { ctx } = await seeded();
    // A store of realistic size: 5000 nodes, 50 groups of 99.
    await succeed(invoke(ctx, { id: "node.addTree", input: { outline: outlineOf(50, 99) } }));
    expect(ctx.nodes.length).toBeGreaterThan(5000);

    /** The session as the action sees it, counting every read of the whole stored node set. */
    const counted = (): { ctx: Kb; reads: () => number } => {
      let reads = 0;
      const view: Kb = Object.create(ctx, {
        nodes: {
          get: () => {
            reads++;
            return ctx.nodes;
          },
        },
      });
      return { ctx: view, reads: () => reads };
    };
    const small = counted();
    await succeed(
      invoke(small.ctx, {
        id: "node.addTree",
        input: { outline: outlineOf(3, 9), parent: "n.host" },
      }),
    );
    const large = counted();
    await succeed(
      invoke(large.ctx, {
        id: "node.addTree",
        input: { outline: outlineOf(100, 29), parent: "n.host" },
      }),
    );
    expect(small.reads()).toBeGreaterThan(0);
    expect(large.reads()).toBe(small.reads());
  });

  test("a policy that asks before node.add asks before node.addTree, its batch", async () => {
    const { ctx } = await session();
    const policy = (match: string, decision: "ask" | "allow") =>
      succeed(
        invoke(ctx, {
          id: "node.add",
          approved: true,
          input: {
            text: `${decision} ${match}`,
            props: [
              { field: SYSTEM_IDS.typeField, value: { t: "ref", v: SYSTEM_IDS.approvalPolicyTag } },
              { field: SYSTEM_IDS.approvalMatchField, value: { t: "str", v: match } },
              {
                field: SYSTEM_IDS.approvalDecisionField,
                value: { t: "ref", v: DECISION_OPTION_IDS[decision] },
              },
            ],
          },
        }),
      );
    await policy("node.add", "ask");
    const call = { id: "node.addTree", input: { outline: "- a" }, actor: "agent" } as const;
    const asked = await invoke(ctx, call);
    expect(asked).toMatchObject({ status: "failed", code: "approval_required" });
    // A policy naming the batch itself cannot unsay what its node.adds ask.
    await policy("node.addTree", "allow");
    expect(await invoke(ctx, call)).toMatchObject({ status: "failed", code: "approval_required" });
    expect(await invoke(ctx, { ...call, approved: true })).toMatchObject({ status: "succeeded" });
  });

  test("a sys.* parent needs force, as node.add's does", async () => {
    const { ctx } = await session();
    const refused = await invoke(ctx, {
      id: "node.addTree",
      input: { outline: "- a", parent: "sys.tag" },
    });
    expect(refused).toMatchObject({ status: "failed", code: "forbidden", details: { line: 1 } });
  });

  test("an outline with no items is refused", async () => {
    const { ctx } = await session();
    const refused = await invoke(ctx, { id: "node.addTree", input: { outline: "%%tana%%\n\n" } });
    expect(refused).toMatchObject({ status: "failed", code: "invalid_input" });
  });
});
