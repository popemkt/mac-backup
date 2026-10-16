/**
 * Outline paste syntax (`parseOutline`): the tree a Tana-Paste-shaped text
 * reads as, and the line every malformed text is refused at. Resolution —
 * tags, field types, refs — is `node.addTree`'s and is tested there.
 */
import { describe, expect, test } from "bun:test";
import { outlineFieldNames, parseOutline, type OutlineItem } from "../src/outline.ts";

/** The tree as plain data: what a fixture says it should read as. */
interface Shape {
  text: string;
  tags?: string[];
  fields?: Record<string, string[]>;
  children?: Shape[];
}

function shape(items: readonly OutlineItem[]): Shape[] {
  return items.map((item) => ({
    text: item.text,
    ...(item.tags.length > 0 ? { tags: item.tags } : {}),
    ...(item.fields.length > 0
      ? {
          fields: Object.fromEntries(
            item.fields.map((field) => [field.name, field.values.map((v) => v.raw)]),
          ),
        }
      : {}),
    ...(item.children.length > 0 ? { children: shape(item.children) } : {}),
  }));
}

function read(source: string): Shape[] {
  const parsed = parseOutline(source);
  if (!parsed.ok) throw new Error(`line ${parsed.line}: ${parsed.reason}`);
  return shape(parsed.items);
}

function refusal(source: string): { line: number; reason: string } {
  const parsed = parseOutline(source);
  if (parsed.ok) throw new Error("expected the outline to be refused");
  return { line: parsed.line, reason: parsed.reason };
}

describe("parseOutline: what an outline reads as", () => {
  test("a Tana Paste fixture: header, nesting, tags, fields, multi-value fields, refs", () => {
    const source = [
      "%%tana%%",
      "- Launch plan #project",
      "  - status:: doing",
      "  - Owners::",
      "    - [[Ada]]",
      "    - [[01ABC|Grace]]",
      "  - Draft the brief #todo #[[needs review]]",
      "    - see [[Launch plan]] and [[sys.tag]]",
      "- Ada",
    ].join("\n");
    expect(read(source)).toEqual([
      {
        text: "Launch plan",
        tags: ["project"],
        fields: { status: ["doing"], Owners: ["[[Ada]]", "[[01ABC|Grace]]"] },
        children: [
          {
            text: "Draft the brief",
            tags: ["todo", "needs review"],
            children: [{ text: "see [[Launch plan]] and [[sys.tag]]" }],
          },
        ],
      },
      { text: "Ada" },
    ]);
  });

  test("the header is optional, blank lines are skipped, and CRLF reads like LF", () => {
    const lf = "- a\n\n  - b\n   \n- c";
    expect(read(lf)).toEqual([{ text: "a", children: [{ text: "b" }] }, { text: "c" }]);
    expect(read(lf.replaceAll("\n", "\r\n"))).toEqual(read(lf));
    expect(read(`%%tana%%\n\n${lf}`)).toEqual(read(lf));
  });

  test("tabs nest like spaces, and any consistent indent width works", () => {
    const tabs = "- a\n\t- b\n\t\t- c\n- d";
    const four = "- a\n    - b\n        - c\n- d";
    expect(read(tabs)).toEqual(read(four));
    expect(read(tabs)).toEqual([
      { text: "a", children: [{ text: "b", children: [{ text: "c" }] }] },
      { text: "d" },
    ]);
  });

  test("a common leading indent on every line is the top level", () => {
    expect(read("  - a\n    - b\n  - c")).toEqual([
      { text: "a", children: [{ text: "b" }] },
      { text: "c" },
    ]);
  });

  test("a dedent may close several levels at once", () => {
    expect(read("- a\n  - b\n    - c\n- d")).toEqual([
      { text: "a", children: [{ text: "b", children: [{ text: "c" }] }] },
      { text: "d" },
    ]);
  });

  test("what is not a tag stays text: C#, a#b, URL fragments, headings, todos", () => {
    expect(read("- C# and a#b https://x.test/#frag")).toEqual([
      { text: "C# and a#b https://x.test/#frag" },
    ]);
    expect(read("- # Heading")).toEqual([{ text: "# Heading" }]);
    expect(read("- !! Tana heading")).toEqual([{ text: "!! Tana heading" }]);
    expect(read("- [ ] open\n- [x] done")).toEqual([{ text: "[ ] open" }, { text: "[x] done" }]);
    expect(read("- see [[01ABC|issue #4]]")).toEqual([{ text: "see [[01ABC|issue #4]]" }]);
  });

  test("a tag name may hold a dot inside it, never at its end", () => {
    expect(read("- release #v1.2")).toEqual([{ text: "release", tags: ["v1.2"] }]);
    expect(read("- Fix it #todo.")).toEqual([{ text: "Fix it.", tags: ["todo"] }]);
  });

  test("tags come out of the text wherever they sit; an item may be tags only", () => {
    expect(read("- #todo Fix #urgent it")).toEqual([{ text: "Fix it", tags: ["todo", "urgent"] }]);
    expect(read("- #todo")).toEqual([{ text: "", tags: ["todo"] }]);
    expect(read("-")).toEqual([{ text: "" }]);
  });

  test("a field takes an inline value and nested values together; a field line repeats", () => {
    expect(read("- n\n  - tags:: a\n    - b\n  - tags:: c")).toEqual([
      { text: "n", fields: { tags: ["c"] } },
    ]);
    const parsed = parseOutline("- n\n  - tags:: a\n    - b\n  - tags:: c");
    expect(parsed.ok && parsed.items[0]?.fields.map((f) => f.values.map((v) => v.raw))).toEqual([
      ["a", "b"],
      ["c"],
    ]);
  });

  test("`::` is a field only when followed by whitespace or the end of the line", () => {
    expect(read("- ratio a::b")).toEqual([{ text: "ratio a::b" }]);
    expect(read("- n\n  - url:: https://x.test/a::b")).toEqual([
      { text: "n", fields: { url: ["https://x.test/a::b"] } },
    ]);
  });

  test("outlineFieldNames lists each field once, in order of appearance", () => {
    const parsed = parseOutline("- a\n  - status:: x\n  - b\n    - owner:: y\n    - status:: z");
    expect(parsed.ok && outlineFieldNames(parsed.items)).toEqual(["status", "owner"]);
  });
});

describe("parseOutline: refused, at the line that is wrong", () => {
  test("an indent between two levels", () => {
    expect(refusal("- a\n    - b\n  - c")).toEqual({
      line: 3,
      reason: expect.stringContaining("indentation matches no line above it"),
    });
  });

  test("siblings mixing tabs and spaces", () => {
    expect(refusal("- a\n\t- b\n    - c").line).toBe(3);
    expect(refusal("- a\n\t- b\n    - c").reason).toContain("mixed tabs and spaces");
  });

  test("a line indented less than the first item", () => {
    expect(refusal("  - a\n- b")).toEqual({ line: 2, reason: "indented less than the first item" });
  });

  test("a line that is not a `- ` item", () => {
    expect(refusal("- a\nplain text").line).toBe(2);
    expect(refusal("* a").line).toBe(1);
    expect(refusal("1. a").line).toBe(1);
  });

  test("a field with no item above it, with no value, or as a value", () => {
    expect(refusal("- status:: doing").line).toBe(1);
    expect(refusal("- a\n  - status::\n- b")).toEqual({
      line: 2,
      reason: "field status has no value",
    });
    expect(refusal("- a\n  - f::\n    - g:: h").line).toBe(3);
  });

  test("a child under a field value", () => {
    expect(refusal("- a\n  - f::\n    - v\n      - w").line).toBe(4);
  });

  test("Tana dates and directives, and a late header", () => {
    expect(refusal("- due [[date:2026-10-16]]").reason).toContain("date references");
    expect(refusal("- a\n  - due:: [[date:2026-10-16]]").line).toBe(2);
    expect(refusal("- %%view:table%%").reason).toContain("directives");
    expect(refusal("- a\n%%tana%%").line).toBe(2);
  });
});
