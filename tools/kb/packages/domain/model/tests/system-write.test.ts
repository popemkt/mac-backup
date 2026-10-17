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
  writesConfiguration,
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
  ["sys.f.provider", node("sys.f.provider", configures(AGENT))],
  ["sys.f.elsewhere", node("sys.f.elsewhere", configures(extensionNodeId("graph")))],
  ["sys.f.every", node("sys.f.every", configures(SYSTEM_IDS.extensionsRoot))],
  ["f.minted", node("f.minted", configures(AGENT))],
  ["f.plain", node("f.plain")],
]);
const fieldOf = (id: string) => FIELDS.get(id);
const ref = (v: string) => [{ t: "ref" as const, v }];

describe("a write to configuration", () => {
  const kinds = new Map<string, KbNode>([
    ...FIELDS,
    ["sys.tag.provider", node("sys.tag.provider", configures(AGENT))],
    ["tag.minted", node("tag.minted", configures(AGENT))],
  ]);
  const nodeOf = (id: string) => kinds.get(id);
  const of = (kind: string) => node("n.p", { [SYSTEM_IDS.typeField]: ref(kind) });

  test("is a node of a system kind that configures an extension, written in any way", () => {
    const provider = of("sys.tag.provider");
    for (const write of [
      { before: undefined, after: provider },
      { before: provider, after: { ...provider, text: "renamed" } },
      { before: provider, after: undefined },
      { before: provider, after: node("n.p") },
    ]) {
      expect(writesConfiguration(write, nodeOf)).toBe(true);
    }
  });

  test("is a value of a setting on the node it configures", () => {
    const set = { ...node(AGENT), props: { "sys.f.provider": ref("n.p") } };
    expect(writesConfiguration({ before: node(AGENT), after: set }, nodeOf)).toBe(true);
    const same = { before: set, after: { ...set, updatedAt: "later" } };
    expect(writesConfiguration(same, nodeOf)).toBe(false);
  });

  test("is a value of a field that configures an extension, on any node", () => {
    const untagged = node("n.u");
    const endpoint = { ...untagged, props: { "sys.f.provider": ref("n.p") } };
    expect(writesConfiguration({ before: untagged, after: endpoint }, nodeOf)).toBe(true);
    expect(writesConfiguration({ before: undefined, after: endpoint }, nodeOf)).toBe(true);
    // A field anyone could add declares nothing.
    const minted = { ...untagged, props: { "f.minted": ref("n.p") } };
    expect(writesConfiguration({ before: untagged, after: minted }, nodeOf)).toBe(false);
  });

  test("is not a node of a kind anyone could add, nor a plain node", () => {
    expect(writesConfiguration({ before: undefined, after: of("tag.minted") }, nodeOf)).toBe(false);
    expect(writesConfiguration({ before: undefined, after: node("n.q") }, nodeOf)).toBe(false);
  });
});

describe("a write to a system node", () => {
  const before = node(AGENT);

  test("may set and clear a field that configures that node, stamped anew", () => {
    const set = { ...before, props: { "sys.f.provider": ref("n.p") }, updatedAt: "later" };
    expect(systemWriteRefusal(before, set, fieldOf)).toBeNull();
    expect(systemWriteRefusal(set, before, fieldOf)).toBeNull();
    expect(isWritableField(AGENT, "sys.f.provider", fieldOf("sys.f.provider"))).toBe(true);
  });

  test("may write a field that configures every extension's node, on each of them", () => {
    for (const id of [AGENT, extensionNodeId("graph")]) {
      expect(isWritableField(id, "sys.f.every", fieldOf("sys.f.every")), id).toBe(true);
    }
    // The list itself, and any other system node, is no extension's node.
    for (const id of [SYSTEM_IDS.extensionsRoot, SYSTEM_IDS.viewsRoot]) {
      expect(isWritableField(id, "sys.f.every", fieldOf("sys.f.every")), id).toBe(false);
    }
  });

  test("may not write a field that configures another node, or none", () => {
    for (const field of ["sys.f.elsewhere", "f.plain"]) {
      const next = { ...before, props: { [field]: ref("n.p") } };
      expect(systemWriteRefusal(before, next, fieldOf), field).toMatch(/write-protected/);
      expect(isWritableField(AGENT, field, fieldOf(field)), field).toBe(false);
    }
  });

  test("may not write a field anyone could add that declares itself a setting", () => {
    // Only a system field is a setting: a field that is not one names what it likes.
    const next = { ...before, props: { "f.minted": ref("n.p") } };
    expect(systemWriteRefusal(before, next, fieldOf)).toMatch(/write-protected/);
    expect(isWritableField(AGENT, "f.minted", fieldOf("f.minted"))).toBe(false);
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
    expect(isWritableField("n.user", "f.plain", fieldOf("f.plain"))).toBe(true);
  });
});
