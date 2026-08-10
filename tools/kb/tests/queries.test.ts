import { describe, expect, test } from "bun:test";
import {
  LIST_ALL_NODES_QUERY,
  LIST_FIELDS_QUERY,
  LIST_TAGS_QUERY,
  backlinksQuery,
} from "../src/foundation/query/queries.ts";
import {
  mapBacklinks,
  mapFieldList,
  mapSearch,
  mapTagList,
} from "../src/surface/map.ts";

describe("foundation/query/queries", () => {
  test("list queries target the expected type nodes", () => {
    expect(LIST_FIELDS_QUERY).toContain(':node/id "sys.field"');
    expect(LIST_TAGS_QUERY).toContain(':node/id "sys.tag"');
    expect(LIST_ALL_NODES_QUERY).toContain("[?n :node/id ?id]");
    expect(LIST_ALL_NODES_QUERY).not.toContain("sys.field");
  });

  test("backlinksQuery embeds the target id", () => {
    expect(backlinksQuery("sys.tag")).toContain(':node/id "sys.tag"');
    expect(backlinksQuery("n.root-a")).toContain(':node/id "n.root-a"');
  });

  test("surface mappers use foundation queries without semantic drift", () => {
    expect((mapFieldList().input as { query: string }).query).toBe(
      LIST_FIELDS_QUERY,
    );
    expect((mapTagList().input as { query: string }).query).toBe(
      LIST_TAGS_QUERY,
    );
    // Text search delegates to the graph.search action (native substring
    // filtering), not a CLI-side LIST_ALL_NODES_QUERY + filter.
    expect(mapSearch("todo")).toEqual({
      id: "graph.search",
      input: { text: "todo" },
    });
    expect((mapBacklinks("sys.tag").input as { query: string }).query).toBe(
      backlinksQuery("sys.tag"),
    );
  });
});
