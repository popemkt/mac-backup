/**
 * A view node's subject (`subject.ts`): one reading of the node a view is
 * rooted at, and the lens decoding its query and focus through the same slots.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS } from "@kb/model";
import { decodeLensConfig, encodeLensConfig, subjectRootOf, subjectRootProps } from "@kb/views";

const strict = (warning: string) => {
  throw new Error(`unexpected report: ${warning}`);
};

describe("a view's subject", () => {
  test("the root is the stored focus, else the node it is shown for, else none", () => {
    const stored = subjectRootProps("n.root");
    expect(stored).toEqual({ [SYSTEM_IDS.lensFocusField]: [{ t: "ref", v: "n.root" }] });
    expect(subjectRootOf(stored, "n.host")).toBe("n.root");
    expect(subjectRootOf({}, "n.host")).toBe("n.host");
    expect(subjectRootOf({}, null)).toBeUndefined();
  });

  test("the lens writes and reads its focus and query as the subject does", () => {
    expect(encodeLensConfig({ focus: "n.root" })).toEqual(subjectRootProps("n.root"));
    const lens = decodeLensConfig(
      {
        ...subjectRootProps("n.root"),
        [SYSTEM_IDS.lensQueryField]: [{ t: "str", v: "[:find ?id]" }],
      },
      strict,
    );
    expect(lens.focus).toBe("n.root");
    expect(lens.query).toBe("[:find ?id]");
  });
});
