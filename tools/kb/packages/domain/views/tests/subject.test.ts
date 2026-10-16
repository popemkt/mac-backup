/**
 * A view node's subject (`subject.ts`): one reading of the node a view is
 * rooted at. The graph lens decoding its query and focus through the same
 * slots is `@kb/graph`'s `lens.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS } from "@kb/model";
import { subjectRootOf, subjectRootProps } from "@kb/views";

describe("a view's subject", () => {
  test("the root is the stored focus, else the node it is shown for, else none", () => {
    const stored = subjectRootProps("n.root");
    expect(stored).toEqual({ [SYSTEM_IDS.lensFocusField]: [{ t: "ref", v: "n.root" }] });
    expect(subjectRootOf(stored, "n.host")).toBe("n.root");
    expect(subjectRootOf({}, "n.host")).toBe("n.host");
    expect(subjectRootOf({}, null)).toBeUndefined();
  });
});
