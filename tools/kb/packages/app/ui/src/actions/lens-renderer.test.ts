import { describe, expect, it } from "vitest";
import { SYSTEM_IDS } from "@/lib/types";
import type { WireNode } from "@kb/contracts";
import { planSetLensProp, planSetLensRenderer } from "./plan";

const perspective: WireNode = {
  id: "perspective",
  text: "Perspective",
  props: { [SYSTEM_IDS.lensRendererField]: [{ t: "str", v: "tree" }] },
  children: [],
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
};

describe("lens action inputs", () => {
  it("replaces renderer through ordered node.update actions", () => {
    expect(planSetLensRenderer([perspective], perspective.id, "force3d").actions).toEqual([
      {
        id: "node.update",
        input: {
          id: perspective.id,
          unsetProps: [{ field: SYSTEM_IDS.lensRendererField }],
        },
      },
      {
        id: "node.update",
        input: {
          id: perspective.id,
          setProps: [
            {
              field: SYSTEM_IDS.lensRendererField,
              value: { t: "ref", v: "sys.graph.renderer.force3d" },
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
