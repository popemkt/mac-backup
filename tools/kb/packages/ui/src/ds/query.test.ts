import { describe, expect, it } from "vitest";
import { fixtureGraph } from "@/fixtures/graph";
import { buildQueryDb } from "./db";
import { normalizeEdnQuery, runQuery } from "./query";

describe("client datalog execution", () => {
  const qdb = buildQueryDb(fixtureGraph.nodes, fixtureGraph.rev);

  it("normalizes keywords but not directives", () => {
    expect(normalizeEdnQuery("[:find ?id :where [?n :node/id ?id]]")).toBe(
      '[:find ?id :where [?n ":node/id" ?id]]',
    );
  });

  it("runs a query and returns tuple rows", () => {
    const rows = runQuery(
      qdb,
      "[:find ?id :where [?n :node/id ?id]]",
    );
    const ids = rows.map((r) => r[0]);
    expect(ids).toContain("n.root-a");
    expect(ids).toContain("sys.tag");
  });

  it("revives entity ids in results to node ids", () => {
    const rows = runQuery(
      qdb,
      '[:find ?n :where [?n :node/text "Ship kb ui shell"]]',
    );
    expect(rows).toEqual([["n.root-a"]]);
  });

  it("joins through ref props (same dialect as the server)", () => {
    const rows = runQuery(
      qdb,
      '[:find ?id :where [?n :f/sys.f.type ?t] [?t :node/text "todo"] [?n :node/id ?id]]',
    );
    expect(rows.map((r) => r[0])).toContain("n.root-a");
  });

  it("throws on malformed queries (caller shows the error)", () => {
    expect(() => runQuery(qdb, "[:find ?x :where")).toThrow();
  });
});
