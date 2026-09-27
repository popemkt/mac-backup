/**
 * A url value's form, stated once: what `normalizeUrl` makes of input, and
 * that every surface agrees because they all go through it — a value the
 * parser produces is one the write check accepts, and a value the write
 * check refuses is one the parser would never have produced.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  FIELD_TYPES,
  SYSTEM_IDS,
  fieldTypeValue,
  migrateDateValues,
  normalizeUrl,
  parseTypedValue,
  txIntegrityError,
  type KbNode,
} from "../src/index.ts";

const AT = "2026-01-01T00:00:00.000Z";
const node = (id: string, props: KbNode["props"] = {}): KbNode => ({
  id,
  text: id,
  props,
  children: [],
  createdAt: AT,
  updatedAt: AT,
});

describe("normalizeUrl", () => {
  test("keeps a link as written", () => {
    expect(normalizeUrl("https://kb.example/a?b=1#c")).toBe("https://kb.example/a?b=1#c");
    expect(normalizeUrl("http://x.dev")).toBe("http://x.dev");
    expect(normalizeUrl("mailto:me@x.dev")).toBe("mailto:me@x.dev");
  });

  test("trims, and makes a bare host an https link", () => {
    expect(normalizeUrl("  example.com/x ")).toBe("https://example.com/x");
    expect(normalizeUrl("docs.kb.example")).toBe("https://docs.kb.example");
    expect(normalizeUrl("localhost:3000/p")).toBe("https://localhost:3000/p");
    expect(normalizeUrl("//cdn.example/a.js")).toBe("https://cdn.example/a.js");
  });

  test("refuses what no link in kb may open", () => {
    for (const raw of [
      "javascript:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "file:///etc/passwd",
      "not a url",
      "word",
      "https://has space.dev",
    ]) {
      expect(normalizeUrl(raw)).toBeNull();
    }
  });

  test("an unset url stays unset", () => {
    expect(normalizeUrl("")).toBe("");
    expect(normalizeUrl("   ")).toBe("");
  });

  test("is idempotent", () => {
    fc.assert(
      fc.property(fc.webUrl(), fc.string(), (url, junk) => {
        for (const raw of [url, junk]) {
          const once = normalizeUrl(raw);
          if (once !== null) expect(normalizeUrl(once)).toBe(once);
        }
      }),
    );
  });
});

describe("every surface agrees on a value's form", () => {
  test("a value the parser produces is one the write check accepts", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FIELD_TYPES.filter((t) => t !== "ref")),
        fc.oneof(fc.webUrl(), fc.string({ maxLength: 12 }), fc.domain()),
        (type, raw) => {
          const parsed = parseTypedValue(raw, type);
          if (!parsed.ok) return;
          const base = [node("f", { [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue(type)] })];
          const tx = { upserts: [node("n.a", { f: [parsed.value] })], deletes: [] };
          expect(txIntegrityError(base, tx)).toBeNull();
        },
      ),
    );
  });

  test("a url in no link form is refused by the write check, as by the parser", () => {
    const base = [node("f", { [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("url")] })];
    const write = (v: string) =>
      txIntegrityError(base, { upserts: [node("n.a", { f: [{ t: "str", v }] })], deletes: [] });
    expect(write("javascript:alert(1)")).toContain("is not a link");
    // A bare host is a link, but not in the form the store holds it in.
    expect(write("example.com")).toContain("https://example.com");
    expect(write("https://example.com")).toBeNull();
    expect(parseTypedValue("javascript:alert(1)", "url").ok).toBe(false);
    expect(parseTypedValue("example.com", "url")).toEqual({
      ok: true,
      value: { t: "str", v: "https://example.com" },
    });
  });
});

describe("one date carrier", () => {
  test("a date field accepts only the string carrier", () => {
    const base = [node("f", { [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("date")] })];
    const write = (value: KbNode["props"][string][number]) =>
      txIntegrityError(base, { upserts: [node("n.a", { f: [value] })], deletes: [] });
    expect(write({ t: "str", v: "2026-09-28" })).toBeNull();
    expect(write({ t: "date", v: "2026-09-28" })).toContain("cannot hold");
  });

  test("opening rewrites the legacy carrier, idempotently, and leaves the rest alone", () => {
    const legacy = node("n.a", {
      due: [{ t: "date", v: "2026-09-28" }],
      note: [{ t: "str", v: "x" }],
    });
    const plain = node("n.b", { note: [{ t: "str", v: "y" }] });
    const first = migrateDateValues([legacy, plain]);
    expect(first.changed).toBe(true);
    expect(first.nodes[0]?.props).toEqual({
      due: [{ t: "str", v: "2026-09-28" }],
      note: [{ t: "str", v: "x" }],
    });
    expect(first.nodes[1]).toBe(plain);
    const again = migrateDateValues(first.nodes);
    expect(again.changed).toBe(false);
    expect(again.nodes).toBe(first.nodes);
  });
});
