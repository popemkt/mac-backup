import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, hasQueryDef, isQueryNode, queryDefOf } from "@kb/model";

const EDN = "[:find ?id :where [?n :node/id ?id]]";

describe("query nodes", () => {
  test("a query node is read from its field: its EDN, trimmed, and its limit", () => {
    const node = {
      props: {
        [SYSTEM_IDS.queryField]: [{ t: "str" as const, v: `  ${EDN}\n` }],
        [SYSTEM_IDS.queryLimitField]: [{ t: "num" as const, v: 5 }],
      },
    };
    expect(isQueryNode(node)).toBe(true);
    expect(queryDefOf(node)).toEqual({ edn: EDN, limit: 5 });
  });

  test("an empty EDN is a query being written: a query node with nothing to run", () => {
    const node = { props: { [SYSTEM_IDS.queryField]: [{ t: "str" as const, v: " " }] } };
    expect(hasQueryDef(node.props)).toBe(true);
    expect(queryDefOf(node)).toBeNull();
  });

  test("a node without the field is no query node", () => {
    expect(isQueryNode({ props: {} })).toBe(false);
    expect(queryDefOf({ props: {} })).toBeNull();
    expect(queryDefOf(undefined)).toBeNull();
  });
});
