import { describe, expect, it } from "vitest";
import { SYSTEM_IDS } from "@kb/ui-sdk";
import type { WireNode } from "@kb/contracts";
import { planSetGraphRenderer, planSetLensProp } from "./plan";

const perspective: WireNode = {
  id: "perspective",
  text: "Perspective",
  props: { [SYSTEM_IDS.viewField]: [{ t: "ref", v: "sys.view.graph.tree" }] },
  children: [],
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
};

describe("lens action inputs", () => {
  it("replaces the renderer — the graph view's view — in one node.update, so no one sees it unset", () => {
    expect(
      planSetGraphRenderer([perspective], perspective.id, "sys.view.graph.force3d").actions,
    ).toEqual([
      {
        id: "node.update",
        input: {
          id: perspective.id,
          unsetProps: [{ field: SYSTEM_IDS.viewField }],
          setProps: [
            {
              field: SYSTEM_IDS.viewField,
              value: { t: "ref", v: "sys.view.graph.force3d" },
            },
          ],
        },
      },
    ]);
  });

  it("uses the same replacement builder for every lens field", () => {
    expect(
      planSetLensProp([perspective], perspective.id, "lens.field", { t: "num", v: 3 }).actions[0],
    ).toMatchObject({
      id: "node.update",
      input: { setProps: [{ field: "lens.field", value: { t: "num", v: 3 } }] },
    });
  });
});
