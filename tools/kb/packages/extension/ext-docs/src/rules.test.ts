import { describe, expect, test } from "bun:test";
import type { KbNode } from "@kb/model";
import type { TemplateContext } from "@kb/contracts";
import { rules } from "./rules.ts";

const GAP_TAG_ID = "01TESTGAPTAG00000000000000";
const STATUS_FIELD_ID = "01TESTSTATUSFIELD000000000";
const ACTIVE_GAP_ID = "01TESTACTIVEGAP00000000000";
const CLOSED_GAP_ID = "01TESTCLOSEDGAP00000000000";
const at = "2026-01-01T00:00:00.000Z";

function node(id: string, text: string, props: KbNode["props"]): KbNode {
  return { id, text, props, children: [], createdAt: at, updatedAt: at };
}

describe("rules template", () => {
  test("renders done gaps under Closed instead of active Gaps", () => {
    const nodes = [
      node(GAP_TAG_ID, "gap", { "sys.f.type": [{ t: "ref", v: "sys.tag" }] }),
      node(ACTIVE_GAP_ID, "GAP: active", {
        "sys.f.type": [{ t: "ref", v: GAP_TAG_ID }],
      }),
      node(CLOSED_GAP_ID, "GAP: closed", {
        "sys.f.type": [{ t: "ref", v: GAP_TAG_ID }],
        [STATUS_FIELD_ID]: [{ t: "str", v: "done" }],
      }),
    ];
    const ctx: TemplateContext = {
      nodes: new Map(nodes.map((entry) => [entry.id, entry])),
      fieldIdByName: (name) => (name === "status" ? STATUS_FIELD_ID : undefined),
    };

    const markdown = rules([], ctx);
    const activeSection = markdown.slice(
      markdown.indexOf("## Gaps"),
      markdown.indexOf("## Closed"),
    );
    const closedSection = markdown.slice(markdown.indexOf("## Closed"));

    expect(activeSection).toContain("### GAP: active");
    expect(activeSection).not.toContain("### GAP: closed");
    expect(closedSection).toContain("### GAP: closed");
    expect(closedSection).not.toContain("### GAP: active");
  });
});
