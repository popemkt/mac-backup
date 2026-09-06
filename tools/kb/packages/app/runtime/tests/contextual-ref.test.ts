/**
 * Contextual references (Tana "contextual content").
 *
 * A contextual reference is an ordinary node carrying its target on the
 * `sys.f.ref.target` ref field — the field is the kind, there is no `#ref`
 * supertag (DESIGN → Kinds, roles and options). It renders the
 * target's text; its own children are the local, contextual content and stay
 * on the reference, never on the target.
 *
 * The relationship half is the load-bearing part: a ref *prop* is a reference,
 * so `:node/mentions` — and therefore `kb backlinks` — must see it exactly as
 * it sees a `[[id]]` token in text.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKb } from "../src/session.ts";
import {
  ensureSystemSeed,
  fieldTypeOf,
  present,
  SYSTEM_IDS,
  systemSeedNodes,
  type KbNode,
} from "@kb/model";
import { backlinksQuery, DatascriptIndex } from "@kb/query";
import { invoke } from "../src/invoke.ts";

function refs(node: KbNode, field: string): string[] {
  return (node.props[field] ?? []).filter((v) => v.t === "ref").map((v) => v.v);
}

const AT = "2026-01-01T00:00:00.000Z";

function mk(
  id: string,
  text: string,
  props: KbNode["props"] = {},
  children: string[] = [],
): KbNode {
  return { id, text, props, children, createdAt: AT, updatedAt: AT };
}

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kb-ctxref-"));
}

describe("seed: the ref.target field, and no #ref tag", () => {
  test("seeds a ref-typed sys.f.ref.target", () => {
    const byId = new Map(systemSeedNodes().map((n) => [n.id, n]));

    const field = byId.get(SYSTEM_IDS.refTargetField);
    expect(field).toBeDefined();
    expect(present(field, "expected field").text).toBe("ref.target");
    expect(refs(present(field, "expected field"), SYSTEM_IDS.typeField)).toEqual([
      SYSTEM_IDS.field,
    ]);
    // The type is DECLARED through the normal fieldType mechanism, never assumed.
    expect(fieldTypeOf(present(field, "expected field").props)).toBe("ref");
  });

  test("seeds no `ref` supertag — a node with no target is not a reference", () => {
    // The general claim (what a supertag is for) lives in @kb/model's
    // kinds.test.ts; this pins the one tag this feature used to carry.
    const texts = systemSeedNodes()
      .filter((n) => refs(n, SYSTEM_IDS.typeField).includes(SYSTEM_IDS.tag))
      .map((n) => n.text);
    expect(texts).not.toContain("ref");
  });

  test("ensureSystemSeed stays idempotent and heals a store missing the field", () => {
    const first = ensureSystemSeed([]);
    expect(first.seeded).toBe(true);
    const again = ensureSystemSeed(first.nodes);
    expect(again.seeded).toBe(false);

    const stale = first.nodes.filter((n) => n.id !== SYSTEM_IDS.refTargetField);
    const healed = ensureSystemSeed(stale);
    expect(healed.seeded).toBe(true);
    const field = present(
      healed.nodes.find((n) => n.id === SYSTEM_IDS.refTargetField),
      "expected the seeded ref.target field",
    );
    expect(fieldTypeOf(field.props)).toBe("ref");
  });
});

describe(":node/mentions counts ref props, not only text tokens", () => {
  test("a ref prop puts its source in the target's backlinks", () => {
    const nodes = [
      mk("n.target", "Original node"),
      mk("n.ctx", "", {
        [SYSTEM_IDS.refTargetField]: [{ t: "ref", v: "n.target" }],
      }),
    ];
    const rows = new DatascriptIndex(nodes).runDatalog(backlinksQuery("n.target"));
    expect(rows.map((r) => r[0])).toEqual(["n.ctx"]);
  });

  test("a text token and a ref prop are one relation, counted once", () => {
    const nodes = [
      mk("n.target", "Original node"),
      mk("n.both", "See [[n.target|Original node]]", {
        [SYSTEM_IDS.refTargetField]: [{ t: "ref", v: "n.target" }],
      }),
    ];
    const rows = new DatascriptIndex(nodes).runDatalog(backlinksQuery("n.target"));
    expect(rows.map((r) => r[0])).toEqual(["n.both"]);
  });

  test("a dangling ref prop is not a mention", () => {
    const nodes = [
      mk("n.ctx", "", {
        [SYSTEM_IDS.refTargetField]: [{ t: "ref", v: "n.missing" }],
      }),
    ];
    const rows = new DatascriptIndex(nodes).runDatalog(backlinksQuery("n.missing"));
    expect(rows).toEqual([]);
  });
});

describe("creating a contextual reference is plain node.add / node.update", () => {
  let root: string;
  beforeEach(async () => {
    root = await tempRoot();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("node.add mints one; its children stay off the target", async () => {
    const ctx = await openKb(root);

    const target = await invoke(ctx, {
      id: "node.add",
      input: { text: "Original node" },
    });
    expect(target.status).toBe("succeeded");
    if (target.status !== "succeeded") return;
    const targetId = (target.output as { id: string }).id;

    const host = await invoke(ctx, {
      id: "node.add",
      input: { text: "Some place in my outline" },
    });
    if (host.status !== "succeeded") return;
    const hostId = (host.output as { id: string }).id;

    // The whole creation gesture — no new registry action.
    const ref = await invoke(ctx, {
      id: "node.add",
      input: {
        text: "",
        parent: hostId,
        props: [
          {
            field: SYSTEM_IDS.refTargetField,
            value: { t: "ref", v: targetId },
          },
        ],
      },
    });
    expect(ref.status).toBe("succeeded");
    if (ref.status !== "succeeded") return;
    const refId = (ref.output as { id: string }).id;

    // Contextual content: an ordinary child of the reference.
    const child = await invoke(ctx, {
      id: "node.add",
      input: { text: "Only true in this context", parent: refId },
    });
    expect(child.status).toBe("succeeded");
    if (child.status !== "succeeded") return;
    const childId = (child.output as { id: string }).id;

    // The target does not adopt the contextual child.
    const got = await invoke(ctx, {
      id: "node.get",
      input: { id: targetId, depth: 2 },
    });
    if (got.status !== "succeeded") return;
    expect(JSON.stringify(got.output)).not.toContain(childId);

    // …and the reference does.
    const refGot = await invoke(ctx, {
      id: "node.get",
      input: { id: refId, depth: 1 },
    });
    if (refGot.status !== "succeeded") return;
    expect(JSON.stringify(refGot.output)).toContain(childId);

    // The relationship is queryable from the target.
    const back = await invoke(ctx, {
      id: "graph.query",
      input: { query: backlinksQuery(targetId) },
    });
    expect(back.status).toBe("succeeded");
    if (back.status !== "succeeded") return;
    const rows = (back.output as { rows: unknown[][] }).rows;
    expect([...rows].map((r) => r[0])).toContain(refId);
  });

  test("node.update turns an existing node into one", async () => {
    const ctx = await openKb(root);

    const target = await invoke(ctx, {
      id: "node.add",
      input: { text: "Original node" },
    });
    if (target.status !== "succeeded") return;
    const targetId = (target.output as { id: string }).id;

    const plain = await invoke(ctx, {
      id: "node.add",
      input: { text: "just a row" },
    });
    if (plain.status !== "succeeded") return;
    const plainId = (plain.output as { id: string }).id;

    const turned = await invoke(ctx, {
      id: "node.update",
      input: {
        id: plainId,
        setProps: [
          {
            field: SYSTEM_IDS.refTargetField,
            value: { t: "ref", v: targetId },
          },
        ],
      },
    });
    expect(turned.status).toBe("succeeded");

    const back = await invoke(ctx, {
      id: "graph.query",
      input: { query: backlinksQuery(targetId) },
    });
    if (back.status !== "succeeded") return;
    const rows = (back.output as { rows: unknown[][] }).rows;
    expect([...rows].map((r) => r[0])).toContain(plainId);
  });
});
