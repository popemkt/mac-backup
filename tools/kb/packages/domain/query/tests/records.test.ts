/**
 * A query's rows as records named by its `:find` columns: the shape a chart
 * reads its data in.
 */
import { describe, expect, test } from "bun:test";
import { DatascriptIndex, findColumns, queryRecords } from "@kb/query";
import { SYSTEM_IDS, type KbNode } from "@kb/model";

const AT = "2026-01-01T00:00:00.000Z";

function node(id: string, text: string, props: KbNode["props"] = {}): KbNode {
  return { id, text, props, children: [], createdAt: AT, updatedAt: AT };
}

describe("findColumns", () => {
  test("a variable is its name, an aggregate its function and variable", () => {
    expect(findColumns("[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]")).toEqual(
      ["id", "text"],
    );
    expect(findColumns("[:find ?s (count ?n) :where [?n :f/status ?s]]")).toEqual(["s", "count_n"]);
    expect(findColumns("[:find (pull ?e [:node/id]) :where [?e :node/id _]]")).toEqual(["pull_e"]);
  });

  test("a query outside the IR subset is still named by its :find section", () => {
    const edn =
      "[:find ?id ?n :in $ :where [?e :node/id ?id] [?e :f/num ?n] [(> ?n 2)] (or [?e :a 1] [?e :b 2])]";
    expect(findColumns(edn)).toEqual(["id", "n"]);
  });

  test("a repeated name gets a suffix, so every column is its own key", () => {
    expect(findColumns("[:find ?a (count ?a) (count ?a) :where [?e :x ?a]]")).toEqual([
      "a",
      "count_a",
      "count_a_2",
    ]);
  });

  test("a result that is not rows, or no query, has no columns", () => {
    expect(findColumns("[:find ?a . :where [?e :x ?a]]")).toBeNull();
    expect(findColumns("[:find [?a ...] :where [?e :x ?a]]")).toBeNull();
    expect(findColumns("[:find ?a :keys a :where [?e :x ?a]]")).toBeNull();
    expect(findColumns("{:find [?a]}")).toBeNull();
    expect(findColumns("[:find ?a :where")).toBeNull();
  });
});

describe("queryRecords", () => {
  test("each row of a real query is a record keyed by its columns", () => {
    const index = new DatascriptIndex([
      node("t.a", "a", { [SYSTEM_IDS.queryField]: [{ t: "str", v: "x" }] }),
      node("t.b", "b"),
    ]);
    const edn = "[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]";
    const { columns, records } = queryRecords(edn, index.runDatalog(edn));
    expect(columns).toEqual(["id", "text"]);
    expect(records.toSorted((x, y) => String(x["id"]).localeCompare(String(y["id"])))).toEqual([
      { id: "t.a", text: "a" },
      { id: "t.b", text: "b" },
    ]);
  });

  test("unreadable columns are numbered up to the widest row", () => {
    expect(queryRecords("not edn", [[1], [2, 3]])).toEqual({
      columns: ["col_1", "col_2"],
      records: [
        { col_1: 1, col_2: undefined },
        { col_1: 2, col_2: 3 },
      ],
    });
  });
});
