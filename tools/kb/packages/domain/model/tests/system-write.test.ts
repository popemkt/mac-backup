/**
 * Which writes to a system node are a person's: only the values of fields
 * that configure it (`sys.f.configures`), and nothing else of it.
 */
import { describe, expect, test } from "bun:test";
import {
  SYSTEM_IDS,
  extensionNodeId,
  isWritableField,
  systemWriteRefusal,
  type KbNode,
} from "../src/index.ts";

const AT = "2026-10-17T00:00:00.000Z";
const AGENT = extensionNodeId("agent");

function node(id: string, props: KbNode["props"] = {}, extra: Partial<KbNode> = {}): KbNode {
  return { id, text: id, props, children: [], createdAt: AT, updatedAt: AT, ...extra };
}

const configures = (target: string) => ({
  [SYSTEM_IDS.configuresField]: [{ t: "ref" as const, v: target }],
});
const FIELDS = new Map<string, KbNode>([
  ["f.provider", node("f.provider", configures(AGENT))],
  ["f.elsewhere", node("f.elsewhere", configures(extensionNodeId("graph")))],
  ["f.plain", node("f.plain")],
]);
const fieldOf = (id: string) => FIELDS.get(id);
const ref = (v: string) => [{ t: "ref" as const, v }];

describe("a write to a system node", () => {
  const before = node(AGENT);

  test("may set and clear a field that configures that node, stamped anew", () => {
    const set = { ...before, props: { "f.provider": ref("n.p") }, updatedAt: "later" };
    expect(systemWriteRefusal(before, set, fieldOf)).toBeNull();
    expect(systemWriteRefusal(set, before, fieldOf)).toBeNull();
    expect(isWritableField(AGENT, fieldOf("f.provider"))).toBe(true);
  });

  test("may not write a field that configures another node, or none", () => {
    for (const field of ["f.elsewhere", "f.plain", SYSTEM_IDS.extensionEnabledField]) {
      const next = { ...before, props: { [field]: ref("n.p") } };
      expect(systemWriteRefusal(before, next, fieldOf), field).toMatch(/write-protected/);
      expect(isWritableField(AGENT, fieldOf(field)), field).toBe(false);
    }
  });

  test("may not change its text, children or rank, nor mint one", () => {
    for (const next of [
      { ...before, text: "renamed" },
      { ...before, children: ["n.child"] },
      { ...before, order: "a0" },
    ]) {
      expect(systemWriteRefusal(before, next, fieldOf)).toMatch(/write-protected/);
    }
    expect(systemWriteRefusal(undefined, before, fieldOf)).toMatch(/write-protected/);
  });

  test("is not this rule's business when the node is not a system node", () => {
    const user = node("n.user");
    expect(systemWriteRefusal(undefined, user, fieldOf)).toBeNull();
    expect(systemWriteRefusal(user, { ...user, text: "anything" }, fieldOf)).toBeNull();
    expect(isWritableField("n.user", fieldOf("f.plain"))).toBe(true);
  });
});
