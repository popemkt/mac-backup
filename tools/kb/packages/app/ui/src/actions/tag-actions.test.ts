import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { SYSTEM_IDS } from "@/lib/types";
import { planAddTagField, planRemoveTag, planSetTagColor } from "./plan";

const tag: WireNode = {
  id: "tag.work",
  text: "work",
  props: {},
  children: [],
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
};

describe("tag action inputs", () => {
  it("adds a templated field through node.update", () => {
    expect(planAddTagField([tag], tag.id, "field.status").actions[0]).toMatchObject({
      input: {
        setProps: [{ field: SYSTEM_IDS.fieldsField, value: { t: "ref", v: "field.status" } }],
      },
    });
  });

  it("removes tag refs and sets color through ordinary props", () => {
    expect(planRemoveTag([tag], tag.id, "tag.other").actions[0]).toMatchObject({
      input: { unsetProps: [{ field: SYSTEM_IDS.typeField, value: { t: "ref", v: "tag.other" } }] },
    });
    expect(planSetTagColor([tag], tag.id, "#fff").actions[0]).toMatchObject({
      input: { setProps: [{ field: SYSTEM_IDS.colorField, value: { t: "str", v: "#fff" } }] },
    });
  });
});
