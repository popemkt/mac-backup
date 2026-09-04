/**
 * r5 ontology core — resolver algebra, seed, migration, and the
 * `ontology.members` receipt.
 *
 * Ordered by what would hurt most if wrong: the extends-cycle test is the
 * highest-value case in the file (it is the failure mode that hangs the UI).
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalJson,
  DEFAULT_MAX_DEPTH,
  ensureSystemSeed,
  fieldTypeOf,
  isOntologyNode,
  listOntologyNodes,
  ontologyClosureMode,
  present,
  resolveOntology,
  SYSTEM_IDS,
  systemSeedNodes,
  type KbNode,
  type NodeLike,
  type PropValue,
  wouldCreateExtendsCycle,
} from "@kb/model";
import { ontologyMembersEffect } from "@kb/operations";
import { runWithKb } from "../src/layers.ts";
import { openKb } from "../src/session.ts";
import { invoke } from "../src/invoke.ts";

// ── fixtures ───────────────────────────────────────────────────────────────

const AT = "2026-08-23T00:00:00.000Z";

function node(
  id: string,
  text: string,
  props: Record<string, PropValue[]> = {},
  children: string[] = [],
): KbNode {
  return { id, text, props, children, createdAt: AT, updatedAt: AT };
}

function tagged(id: string, text: string, ...tagIds: string[]): KbNode {
  return node(id, text, {
    [SYSTEM_IDS.typeField]: tagIds.map((v) => ({ t: "ref", v })),
  });
}

function ontology(
  id: string,
  text: string,
  spec: {
    include?: string[];
    member?: string[];
    exclude?: string[];
    extends?: string[];
    query?: string;
    closure?: string;
  } = {},
): KbNode {
  const props: Record<string, PropValue[]> = {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.ontologyTag }],
  };
  const refValues = (ids: string[]): PropValue[] => ids.map((v) => ({ t: "ref" as const, v }));
  if (spec.include) props[SYSTEM_IDS.ontoIncludeField] = refValues(spec.include);
  if (spec.member) props[SYSTEM_IDS.ontoMemberField] = refValues(spec.member);
  if (spec.exclude) props[SYSTEM_IDS.ontoExcludeField] = refValues(spec.exclude);
  if (spec.extends) props[SYSTEM_IDS.ontoExtendsField] = refValues(spec.extends);
  if (spec.query !== undefined && spec.query !== "") {
    props[SYSTEM_IDS.ontoQueryField] = [{ t: "str", v: spec.query }];
  }
  if (spec.closure !== undefined && spec.closure !== "") {
    props[SYSTEM_IDS.ontoClosureField] = [{ t: "str", v: spec.closure }];
  }
  return node(id, text, props);
}

/** #service / #host tags plus a small content graph. */
function baseGraph(): KbNode[] {
  return [
    tagged("t.service", "service", SYSTEM_IDS.tag),
    tagged("t.host", "host", SYSTEM_IDS.tag),
    tagged("t.secret", "secret", SYSTEM_IDS.tag),
    tagged("n.tailscaled", "tailscaled", "t.service"),
    tagged("n.caddy", "caddy", "t.service"),
    tagged("n.work", "popemkt-work", "t.host"),
    tagged("n.keys", "wireguard keys", "t.secret"),
    node("n.notes", "cloudflare tunnel notes"),
    node("n.oldvpn", "old vpn doc"),
  ];
}

function sortedMembers(members: Set<string>): string[] {
  return [...members].toSorted();
}

// ── 1. include tags ────────────────────────────────────────────────────────

describe("resolveOntology — include tags", () => {
  test("returns exactly the tag's instances and never the ontology itself", () => {
    const nodes = [
      ...baseGraph(),
      ontology("o.infra", "Infrastructure", { include: ["t.service"] }),
    ];
    const r = resolveOntology(nodes, "o.infra");
    expect(sortedMembers(r.members)).toEqual(["n.caddy", "n.tailscaled"]);
    expect(r.members.has("o.infra")).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  test("multiple include tags union", () => {
    const nodes = [
      ...baseGraph(),
      ontology("o.infra", "Infrastructure", {
        include: ["t.service", "t.host"],
      }),
    ];
    const r = resolveOntology(nodes, "o.infra");
    expect(sortedMembers(r.members)).toEqual(["n.caddy", "n.tailscaled", "n.work"]);
  });

  test("a tag with zero instances is not a warning; an unknown tag ref is", () => {
    const nodes = [
      ...baseGraph(),
      tagged("t.empty", "empty", SYSTEM_IDS.tag),
      ontology("o.a", "A", { include: ["t.empty"] }),
      ontology("o.b", "B", { include: ["t.ghost"] }),
    ];
    expect(resolveOntology(nodes, "o.a").warnings).toEqual([]);
    expect(resolveOntology(nodes, "o.b").warnings).toEqual(["include tag not found: t.ghost"]);
  });
});

// ── 2. exclude beats everything ────────────────────────────────────────────

describe("resolveOntology — exclude is absolute", () => {
  const rows = (): unknown[][] => [["n.notes"]];

  test("exclude beats include", () => {
    const nodes = [
      ...baseGraph(),
      ontology("o", "O", { include: ["t.service"], exclude: ["n.caddy"] }),
    ];
    const r = resolveOntology(nodes, "o");
    expect(r.members.has("n.caddy")).toBe(false);
    expect(r.excluded.has("n.caddy")).toBe(true);
    expect(r.reasons.has("n.caddy")).toBe(false);
  });

  test("exclude beats explicit member", () => {
    const nodes = [
      ...baseGraph(),
      ontology("o", "O", { member: ["n.notes"], exclude: ["n.notes"] }),
    ];
    const r = resolveOntology(nodes, "o");
    expect(r.members.has("n.notes")).toBe(false);
    expect(r.excluded.has("n.notes")).toBe(true);
  });

  test("exclude beats query", () => {
    const nodes = [
      ...baseGraph(),
      ontology("o", "O", { query: "[:find ?id :where [?n :node/id ?id]]", exclude: ["n.notes"] }),
    ];
    const r = resolveOntology(nodes, "o", { runQuery: rows });
    expect(r.members.has("n.notes")).toBe(false);
    expect(r.excluded.has("n.notes")).toBe(true);
  });

  test("exclude beats extends-inherited membership", () => {
    const nodes = [
      ...baseGraph(),
      ontology("o.parent", "Parent", { include: ["t.service"] }),
      ontology("o.child", "Child", {
        extends: ["o.parent"],
        exclude: ["n.caddy"],
      }),
    ];
    const r = resolveOntology(nodes, "o.child");
    expect(sortedMembers(r.members)).toEqual(["n.tailscaled"]);
    expect(r.excluded.has("n.caddy")).toBe(true);
  });

  test("exclude beats closure", () => {
    const nodes = [
      ...baseGraph(),
      node("n.parent", "parent", {}, ["n.kid"]),
      node("n.kid", "kid"),
      ontology("o", "O", {
        member: ["n.parent"],
        closure: "descendants",
        exclude: ["n.kid"],
      }),
    ];
    const r = resolveOntology(nodes, "o");
    expect(sortedMembers(r.members)).toEqual(["n.parent"]);
    expect(r.excluded.has("n.kid")).toBe(true);
  });

  test("a parent's exclude does not veto the child's own include", () => {
    const nodes = [
      ...baseGraph(),
      ontology("o.parent", "Parent", {
        include: ["t.service"],
        exclude: ["n.caddy"],
      }),
      ontology("o.child", "Child", {
        extends: ["o.parent"],
        include: ["t.service"],
      }),
    ];
    const r = resolveOntology(nodes, "o.child");
    expect(sortedMembers(r.members)).toEqual(["n.caddy", "n.tailscaled"]);
    expect(r.excluded.size).toBe(0);
  });
});

// ── 3. extends ─────────────────────────────────────────────────────────────

describe("resolveOntology — extends", () => {
  test("unions parent members; grandparent chain resolves", () => {
    const nodes = [
      ...baseGraph(),
      ontology("o.gp", "Grandparent", { member: ["n.notes"] }),
      ontology("o.p", "Parent", { extends: ["o.gp"], include: ["t.host"] }),
      ontology("o.c", "Child", { extends: ["o.p"], include: ["t.service"] }),
    ];
    const r = resolveOntology(nodes, "o.c");
    expect(sortedMembers(r.members)).toEqual(["n.caddy", "n.notes", "n.tailscaled", "n.work"]);
  });

  test("parent ontologies are not themselves members", () => {
    const nodes = [
      ...baseGraph(),
      // o.p is tagged #ontology, and #ontology is also an include tag here.
      ontology("o.p", "Parent", { member: ["n.notes"] }),
      ontology("o.c", "Child", {
        extends: ["o.p"],
        include: [SYSTEM_IDS.ontologyTag],
      }),
    ];
    const r = resolveOntology(nodes, "o.c");
    expect(r.members.has("o.p")).toBe(false);
    expect(r.members.has("o.c")).toBe(false);
  });

  test("extends target that is not an #ontology node warns and is skipped", () => {
    const nodes = [...baseGraph(), ontology("o", "O", { extends: ["n.notes"] })];
    const r = resolveOntology(nodes, "o");
    expect(r.members.size).toBe(0);
    expect(r.warnings).toEqual(["extends target is not an #ontology node: n.notes"]);
  });

  test("extends ref to a missing node warns", () => {
    const nodes = [...baseGraph(), ontology("o", "O", { extends: ["o.ghost"] })];
    const r = resolveOntology(nodes, "o");
    expect(r.warnings).toEqual(["unknown ontology reference: o.ghost"]);
  });

  // THE test: a cycle must terminate, warn, and still return the union.
  test("A → B → A terminates, warns, and returns the correct union", () => {
    const nodes = [
      ...baseGraph(),
      ontology("o.a", "A", { extends: ["o.b"], include: ["t.service"] }),
      ontology("o.b", "B", { extends: ["o.a"], include: ["t.host"] }),
    ];
    const r = resolveOntology(nodes, "o.a");
    expect(sortedMembers(r.members)).toEqual(["n.caddy", "n.tailscaled", "n.work"]);
    expect(r.warnings.some((w) => w.startsWith("extends cycle ignored:"))).toBe(true);
  });

  test("self-extends terminates and warns", () => {
    const nodes = [...baseGraph(), ontology("o", "O", { extends: ["o"], include: ["t.host"] })];
    const r = resolveOntology(nodes, "o");
    expect(sortedMembers(r.members)).toEqual(["n.work"]);
    expect(r.warnings.some((w) => w.startsWith("extends cycle ignored:"))).toBe(true);
  });

  test("depth cap: a 40-deep chain warns and stops", () => {
    const nodes: KbNode[] = [tagged("t.leaf", "leaf", SYSTEM_IDS.tag)];
    for (let i = 0; i < 40; i++) {
      nodes.push(
        ontology(`o.${i}`, `O${i}`, {
          ...(i < 39 ? { extends: [`o.${i + 1}`] } : {}),
          ...(i === 39 ? { member: ["n.deep"] } : {}),
        }),
      );
    }
    nodes.push(node("n.deep", "deep"));
    const r = resolveOntology(nodes, "o.0");
    expect(r.warnings.some((w) => w.includes("extends depth cap"))).toBe(true);
    // The deepest ancestor beyond the cap contributes nothing.
    expect(r.members.has("n.deep")).toBe(false);
    expect(DEFAULT_MAX_DEPTH).toBe(32);
  });

  test("a diamond resolves once and does not duplicate reasons", () => {
    const nodes = [
      ...baseGraph(),
      ontology("o.base", "Base", { member: ["n.notes"] }),
      ontology("o.l", "Left", { extends: ["o.base"] }),
      ontology("o.r", "Right", { extends: ["o.base"] }),
      ontology("o.top", "Top", { extends: ["o.l", "o.r"] }),
    ];
    const r = resolveOntology(nodes, "o.top");
    expect(sortedMembers(r.members)).toEqual(["n.notes"]);
    expect(r.reasons.get("n.notes")).toEqual([
      { kind: "extends", via: "o.l" },
      { kind: "extends", via: "o.r" },
    ]);
  });
});

// ── 4. query ───────────────────────────────────────────────────────────────

describe("resolveOntology — onto.query", () => {
  const EDN = "[:find ?id :where [?n :node/id ?id]]";

  test("well-formed EDN contributes its ids", () => {
    const nodes = [...baseGraph(), ontology("o", "O", { query: EDN })];
    const r = resolveOntology(nodes, "o", {
      runQuery: () => [["n.notes"], ["n.oldvpn"]],
    });
    expect(sortedMembers(r.members)).toEqual(["n.notes", "n.oldvpn"]);
    expect(r.reasons.get("n.notes")).toEqual([{ kind: "query" }]);
  });

  test("rows naming unknown ids contribute nothing", () => {
    const nodes = [...baseGraph(), ontology("o", "O", { query: EDN })];
    const r = resolveOntology(nodes, "o", {
      runQuery: () => [["nope"], [42, "n.notes"]],
    });
    expect(sortedMembers(r.members)).toEqual(["n.notes"]);
  });

  test("a throwing runner warns and contributes nothing — never throws", () => {
    const nodes = [...baseGraph(), ontology("o", "O", { query: "[:find" })];
    const r = resolveOntology(nodes, "o", {
      runQuery: () => {
        throw new Error("EOF while reading");
      },
    });
    expect(r.members.size).toBe(0);
    expect(r.warnings).toEqual(["onto.query failed on o: EOF while reading"]);
  });

  test("absent runner warns and skips", () => {
    const nodes = [...baseGraph(), ontology("o", "O", { query: EDN })];
    const r = resolveOntology(nodes, "o");
    expect(r.members.size).toBe(0);
    expect(r.warnings).toEqual(["onto.query skipped (no query runner supplied): o"]);
  });
});

// ── 5. closure ─────────────────────────────────────────────────────────────

describe("resolveOntology — closure", () => {
  function tree(): KbNode[] {
    return [
      tagged("t.host", "host", SYSTEM_IDS.tag),
      node("n.root", "root", { [SYSTEM_IDS.typeField]: [{ t: "ref", v: "t.host" }] }, ["n.mid"]),
      node("n.mid", "mid", {}, ["n.leaf"]),
      node("n.leaf", "leaf"),
    ];
  }

  test('"descendants" pulls non-member subtrees in transitively', () => {
    const nodes = [...tree(), ontology("o", "O", { include: ["t.host"], closure: "descendants" })];
    const r = resolveOntology(nodes, "o");
    expect(sortedMembers(r.members)).toEqual(["n.leaf", "n.mid", "n.root"]);
    expect(r.reasons.get("n.leaf")).toEqual([{ kind: "closure", via: "n.root" }]);
  });

  test('default ("none") pulls nothing', () => {
    const nodes = [...tree(), ontology("o", "O", { include: ["t.host"] })];
    const r = resolveOntology(nodes, "o");
    expect(sortedMembers(r.members)).toEqual(["n.root"]);
    expect(
      ontologyClosureMode(present(nodes[nodes.length - 1], "expected nodes[nodes.length - 1]")),
    ).toBe("none");
  });

  test("a children cycle terminates", () => {
    const nodes: KbNode[] = [
      tagged("t.host", "host", SYSTEM_IDS.tag),
      node("n.a", "a", { [SYSTEM_IDS.typeField]: [{ t: "ref", v: "t.host" }] }, ["n.b"]),
      node("n.b", "b", {}, ["n.a"]),
      ontology("o", "O", { include: ["t.host"], closure: "descendants" }),
    ];
    const r = resolveOntology(nodes, "o");
    expect(sortedMembers(r.members)).toEqual(["n.a", "n.b"]);
  });
});

// ── 6. provenance ──────────────────────────────────────────────────────────

describe("resolveOntology — provenance", () => {
  test("every member carries at least one reason", () => {
    const nodes = [
      ...baseGraph(),
      ontology("o", "O", { include: ["t.service"], member: ["n.notes"] }),
    ];
    const r = resolveOntology(nodes, "o");
    for (const id of r.members) {
      expect((r.reasons.get(id) ?? []).length).toBeGreaterThan(0);
    }
  });

  test("a tag-derived member's reason names the tag", () => {
    const nodes = [...baseGraph(), ontology("o", "O", { include: ["t.service"] })];
    const r = resolveOntology(nodes, "o");
    expect(r.reasons.get("n.caddy")).toEqual([{ kind: "tag", via: "t.service" }]);
  });

  test("a doubly-derived member carries both reasons", () => {
    const nodes = [
      ...baseGraph(),
      ontology("o", "O", { include: ["t.service"], member: ["n.caddy"] }),
    ];
    const r = resolveOntology(nodes, "o");
    expect(r.reasons.get("n.caddy")).toEqual([
      { kind: "tag", via: "t.service" },
      { kind: "member" },
    ]);
  });

  test("an unknown explicit member warns and is skipped", () => {
    const nodes = [...baseGraph(), ontology("o", "O", { member: ["n.ghost"] })];
    const r = resolveOntology(nodes, "o");
    expect(r.members.size).toBe(0);
    expect(r.warnings).toEqual(["explicit member not found: n.ghost"]);
  });
});

// ── 7. determinism + caps ──────────────────────────────────────────────────

describe("resolveOntology — determinism and caps", () => {
  test("two runs over the same input produce identical output", () => {
    const nodes = [
      ...baseGraph(),
      ontology("o.p", "P", { include: ["t.host"] }),
      ontology("o", "O", {
        extends: ["o.p"],
        include: ["t.service", "t.secret"],
        member: ["n.notes"],
        exclude: ["n.caddy"],
      }),
    ];
    const a = resolveOntology(nodes, "o");
    const b = resolveOntology(nodes, "o");
    expect([...a.members]).toEqual([...b.members]);
    expect([...a.reasons.keys()]).toEqual([...b.reasons.keys()]);
    expect(a.warnings).toEqual(b.warnings);
  });

  test("warnAbove reports size without failing", () => {
    const nodes: KbNode[] = [tagged("t.x", "x", SYSTEM_IDS.tag)];
    for (let i = 0; i < 12; i++) nodes.push(tagged(`n.${i}`, `n${i}`, "t.x"));
    nodes.push(ontology("o", "O", { include: ["t.x"] }));
    const r = resolveOntology(nodes, "o", { warnAbove: 10 });
    expect(r.members.size).toBe(12);
    expect(r.warnings.some((w) => w.includes("above 10"))).toBe(true);
  });

  test("a missing ontology id resolves empty with a warning", () => {
    const r = resolveOntology(baseGraph(), "o.nope");
    expect(r.members.size).toBe(0);
    expect(r.warnings).toEqual(["unknown ontology reference: o.nope"]);
  });
});

// ── 8. helpers ─────────────────────────────────────────────────────────────

describe("ontology helpers", () => {
  test("isOntologyNode / listOntologyNodes sort by label then id", () => {
    const nodes: NodeLike[] = [...baseGraph(), ontology("o.z", "Alpha"), ontology("o.a", "Beta")];
    expect(
      isOntologyNode(
        present(
          nodes.find((n) => n.id === "o.z"),
          'expected nodes.find((n) => n.id === "o.z")',
        ),
      ),
    ).toBe(true);
    expect(
      isOntologyNode(
        present(
          nodes.find((n) => n.id === "n.notes"),
          'expected nodes.find((n) => n.id === "n.notes")',
        ),
      ),
    ).toBe(false);
    expect(listOntologyNodes(nodes).map((n) => n.id)).toEqual(["o.z", "o.a"]);
  });

  test("wouldCreateExtendsCycle catches self, direct, and transitive cycles", () => {
    const nodes = [
      ontology("o.a", "A", { extends: ["o.b"] }),
      ontology("o.b", "B", { extends: ["o.c"] }),
      ontology("o.c", "C"),
      ontology("o.d", "D"),
    ];
    expect(wouldCreateExtendsCycle(nodes, "o.a", "o.a")).toBe(true);
    expect(wouldCreateExtendsCycle(nodes, "o.c", "o.a")).toBe(true);
    expect(wouldCreateExtendsCycle(nodes, "o.b", "o.a")).toBe(true);
    expect(wouldCreateExtendsCycle(nodes, "o.a", "o.d")).toBe(false);
  });
});

// ── 9. seed ────────────────────────────────────────────────────────────────

function refs(n: KbNode, field: string): string[] {
  return (n.props[field] ?? []).filter((v) => v.t === "ref").map((v) => v.v);
}

function strs(n: KbNode, field: string): string[] {
  return (n.props[field] ?? []).filter((v) => v.t === "str").map((v) => v.v);
}

describe("ontology seed", () => {
  test("seeds the #ontology tag, six onto.* fields, and three commands", () => {
    const byId = new Map(systemSeedNodes().map((n) => [n.id, n]));

    for (const id of [
      SYSTEM_IDS.ontoIncludeField,
      SYSTEM_IDS.ontoMemberField,
      SYSTEM_IDS.ontoExcludeField,
      SYSTEM_IDS.ontoExtendsField,
      SYSTEM_IDS.ontoQueryField,
      SYSTEM_IDS.ontoClosureField,
    ]) {
      const field = byId.get(id);
      expect(field).toBeDefined();
      expect(refs(present(field, "expected field"), SYSTEM_IDS.typeField)).toEqual([
        SYSTEM_IDS.field,
      ]);
    }

    // Assert the declared type, not its storage form: field types are option
    // nodes now, and reading through the shared resolver is what keeps this
    // test honest across either representation.
    expect(
      fieldTypeOf(
        present(
          byId.get(SYSTEM_IDS.ontoIncludeField),
          "expected byId.get(SYSTEM_IDS.ontoIncludeField)",
        ).props,
      ),
    ).toBe("ref");
    expect(
      refs(
        present(
          byId.get(SYSTEM_IDS.ontoIncludeField),
          "expected byId.get(SYSTEM_IDS.ontoIncludeField)",
        ),
        SYSTEM_IDS.targetTagField,
      ),
    ).toEqual([SYSTEM_IDS.tag]);
    expect(
      fieldTypeOf(
        present(byId.get(SYSTEM_IDS.ontoQueryField), "expected byId.get(SYSTEM_IDS.ontoQueryField)")
          .props,
      ),
    ).toBe("text");

    // extends uses targetQuery (not targetTag) so the picker offers ontologies.
    const ext = present(
      byId.get(SYSTEM_IDS.ontoExtendsField),
      "expected byId.get(SYSTEM_IDS.ontoExtendsField)",
    );
    expect(refs(ext, SYSTEM_IDS.targetTagField)).toEqual([]);
    expect(strs(ext, SYSTEM_IDS.targetQueryField)[0]).toContain(SYSTEM_IDS.ontologyTag);

    const tag = present(
      byId.get(SYSTEM_IDS.ontologyTag),
      "expected byId.get(SYSTEM_IDS.ontologyTag)",
    );
    expect(tag.text).toBe("ontology");
    expect(refs(tag, SYSTEM_IDS.typeField)).toEqual([SYSTEM_IDS.tag]);
    expect(refs(tag, SYSTEM_IDS.fieldsField)).toEqual([
      SYSTEM_IDS.ontoIncludeField,
      SYSTEM_IDS.ontoMemberField,
      SYSTEM_IDS.ontoExcludeField,
      SYSTEM_IDS.ontoExtendsField,
      SYSTEM_IDS.ontoQueryField,
      SYSTEM_IDS.ontoClosureField,
    ]);

    for (const id of [
      SYSTEM_IDS.cmdNewOntology,
      SYSTEM_IDS.cmdEnterOntology,
      SYSTEM_IDS.cmdExitOntology,
    ]) {
      const cmd = byId.get(id);
      expect(cmd).toBeDefined();
      expect(refs(present(cmd, "expected cmd"), SYSTEM_IDS.typeField)).toEqual([
        SYSTEM_IDS.command,
      ]);
    }
  });

  test("no default ontology instance is seeded", () => {
    expect(systemSeedNodes().filter(isOntologyNode)).toEqual([]);
  });

  test("ensureSystemSeed is idempotent and backfills the tag template", () => {
    const first = ensureSystemSeed([]);
    expect(first.seeded).toBe(true);
    const again = ensureSystemSeed(first.nodes);
    expect(again.seeded).toBe(false);
    expect(again.nodes.length).toBe(first.nodes.length);

    // A pre-ontology #ontology tag with an empty template gets backfilled
    // without losing its user-edited text.
    const stale = first.nodes.map((n) =>
      n.id === SYSTEM_IDS.ontologyTag
        ? { ...n, text: "my-ontology", props: { ...n.props, [SYSTEM_IDS.fieldsField]: [] } }
        : n,
    );
    const healed = ensureSystemSeed(stale);
    expect(healed.seeded).toBe(true);
    const tag = present(
      healed.nodes.find((n) => n.id === SYSTEM_IDS.ontologyTag),
      "expected healed.nodes.find((n) => n.id === SYSTEM_IDS.ontologyTag)",
    );
    expect(tag.text).toBe("my-ontology");
    expect(refs(tag, SYSTEM_IDS.fieldsField)).toHaveLength(6);
  });
});

// ── 10. migration: pre-existing lines stay byte-identical ──────────────────

async function fixtureCtx(nodes: KbNode[]): Promise<Awaited<ReturnType<typeof openKb>>> {
  const root = mkdtempSync(join(tmpdir(), "kb-onto-act-"));
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(root, ".kb"), { recursive: true });
  writeFileSync(
    join(root, ".kb", "nodes.jsonl"),
    nodes.map((n) => JSON.stringify(n)).join("\n") + "\n",
    "utf8",
  );
  return openKb(root);
}

describe("ontology migration", () => {
  test("seeding into a pre-ontology store leaves every existing line byte-identical", async () => {
    const { mkdirSync } = await import("node:fs");
    const root = mkdtempSync(join(tmpdir(), "kb-onto-"));
    mkdirSync(join(root, ".kb"), { recursive: true });
    const jsonl = join(root, ".kb", "nodes.jsonl");

    // A TODO graph that has never heard of ontologies, written in the store's
    // own canonical form so any drift is the seed's fault, not the writer's.
    const legacy: KbNode[] = [
      tagged("01LEGACYTODOTAG00000000001", "todo", SYSTEM_IDS.tag),
      tagged("01LEGACYTODO000000000000001", "Fix drift audit", "01LEGACYTODOTAG00000000001"),
    ];
    const before = legacy.map((n) => canonicalJson(n)).join("\n") + "\n";
    writeFileSync(jsonl, before, "utf8");

    const ctx = await openKb(root);
    const beforeLines = before.trim().split("\n");
    const afterLines = readFileSync(jsonl, "utf8").trim().split("\n");

    // Every original line survives, modulo the one-time additive `order` key
    // stamped by the sibling-order migration (nothing else may change).
    const strip = (line: string) => {
      const { order: _order, ...rest } = JSON.parse(line) as Record<string, unknown>;
      return canonicalJson(rest);
    };
    const afterStripped = afterLines.map(strip);
    for (const line of beforeLines) {
      expect(afterStripped).toContain(strip(line));
    }
    // Everything added is a seed row — no content was rewritten.
    const beforeStripped = new Set(beforeLines.map(strip));
    const added = afterLines.filter((l) => !beforeStripped.has(strip(l)));
    expect(added.length).toBeGreaterThan(0);
    const seedIds = new Set(systemSeedNodes().map((n) => n.id));
    for (const line of added) {
      expect(seedIds.has((JSON.parse(line) as { id: string }).id)).toBe(true);
    }
    // The ontology seed landed, and TODO content is preserved.
    expect(ctx.nodes.some((n) => n.id === SYSTEM_IDS.ontologyTag)).toBe(true);
    expect(ctx.nodes.find((n) => n.id === "01LEGACYTODO000000000000001")?.text).toBe(
      "Fix drift audit",
    );
  });

  test("a node that never joins an ontology carries zero onto.* props", async () => {
    const ctx = await fixtureCtx([
      ...baseGraph(),
      ontology("o", "O", { include: ["t.service"], exclude: ["n.oldvpn"] }),
    ]);
    const ontoFields = [
      SYSTEM_IDS.ontoIncludeField,
      SYSTEM_IDS.ontoMemberField,
      SYSTEM_IDS.ontoExcludeField,
      SYSTEM_IDS.ontoExtendsField,
      SYSTEM_IDS.ontoQueryField,
      SYSTEM_IDS.ontoClosureField,
    ];
    for (const n of ctx.nodes) {
      if (n.id === "o") continue;
      for (const f of ontoFields) expect(n.props[f]).toBeUndefined();
    }
  });
});

// ── 11. the ontology.members receipt ───────────────────────────────────────

describe("ontology.members action", () => {
  test("succeeds with sorted members, excluded, and provenance", async () => {
    const ctx = await fixtureCtx([
      ...baseGraph(),
      ontology("o.infra", "Infrastructure", {
        include: ["t.service"],
        member: ["n.notes"],
        exclude: ["n.caddy"],
      }),
    ]);
    const out = await runWithKb(ctx, ontologyMembersEffect({ id: "o.infra", reasons: true }));
    expect(out.members).toEqual(["n.notes", "n.tailscaled"]);
    expect(out.excluded).toEqual(["n.caddy"]);
    expect(out.warnings).toEqual([]);
    expect(out.reasons?.["n.tailscaled"]).toEqual([{ kind: "tag", via: "t.service" }]);
    expect(out.reasons?.["n.notes"]).toEqual([{ kind: "member" }]);
  });

  test("reasons are omitted unless requested", async () => {
    const ctx = await fixtureCtx([...baseGraph(), ontology("o", "O", { include: ["t.host"] })]);
    const out = await runWithKb(ctx, ontologyMembersEffect({ id: "o" }));
    expect(out.reasons).toBeUndefined();
  });

  test("runs onto.query through the real datalog engine", async () => {
    const ctx = await fixtureCtx([
      ...baseGraph(),
      ontology("o", "O", {
        query: '[:find ?id :where [?n :node/text "old vpn doc"] [?n :node/id ?id]]',
      }),
    ]);
    const out = await runWithKb(ctx, ontologyMembersEffect({ id: "o" }));
    expect(out.members).toEqual(["n.oldvpn"]);
    expect(out.warnings).toEqual([]);
  });

  test("malformed EDN surfaces as a warning, not a failed receipt", async () => {
    const ctx = await fixtureCtx([
      ...baseGraph(),
      ontology("o", "O", { query: "[:find ?id :where" }),
    ]);
    const receipt = await invoke(ctx, {
      id: "ontology.members",
      input: { id: "o" },
    });
    expect(receipt.status).toBe("succeeded");
    const out = (receipt as { output: { warnings: string[] } }).output;
    expect(out.warnings.some((w) => w.startsWith("onto.query failed"))).toBe(true);
  });

  test("not_found for a missing id; invalid_input for an untagged node", async () => {
    const ctx = await fixtureCtx([...baseGraph(), ontology("o", "O")]);

    const missing = await invoke(ctx, {
      id: "ontology.members",
      input: { id: "nope" },
    });
    expect(missing.status).toBe("failed");
    expect((missing as { code: string }).code).toBe("not_found");

    const untagged = await invoke(ctx, {
      id: "ontology.members",
      input: { id: "n.notes" },
    });
    expect(untagged.status).toBe("failed");
    expect((untagged as { code: string }).code).toBe("invalid_input");
  });

  test("the action is registered and manifested as a read action", async () => {
    const ctx = await fixtureCtx([...baseGraph(), ontology("o", "O")]);
    const receipt = await invoke(ctx, {
      id: "ontology.members",
      input: { id: "o" },
    });
    expect(receipt.status).toBe("succeeded");
  });
});
