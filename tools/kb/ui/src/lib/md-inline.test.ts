import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KB_TEXT_CLASS,
  clearInlineMdCache,
  parseInlineMd,
} from "./md-inline";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("parseInlineMd", () => {
  it("maps bold, italic, code, and markdown links", () => {
    expect(parseInlineMd("**b** and *i* plus `c`")).toEqual([
      { t: "bold", v: "b" },
      { t: "text", v: " and " },
      { t: "italic", v: "i" },
      { t: "text", v: " plus " },
      { t: "code", v: "c" },
    ]);
    expect(parseInlineMd("[docs](https://ex.test)")).toEqual([
      { t: "link", href: "https://ex.test", label: "docs" },
    ]);
  });

  it("parses [[id|label]] and bare [[id]] refs", () => {
    expect(parseInlineMd("see [[n.root-a|Ship]] ok")).toEqual([
      { t: "text", v: "see " },
      { t: "ref", id: "n.root-a", label: "Ship" },
      { t: "text", v: " ok" },
    ]);
    expect(parseInlineMd("[[sys.tag]]")).toEqual([
      { t: "ref", id: "sys.tag", label: "sys.tag" },
    ]);
  });

  it("memoizes by text hash (same array identity)", () => {
    clearInlineMdCache();
    const a = parseInlineMd("**x**");
    const b = parseInlineMd("**x**");
    expect(a).toBe(b);
    expect(parseInlineMd("**y**")).not.toBe(a);
  });

  it("leaves unmatched markers as plain text", () => {
    expect(parseInlineMd("a * lone star")).toEqual([
      { t: "text", v: "a * lone star" },
    ]);
  });
});

describe("line-height consistency (edit vs view)", () => {
  it("edit and view share KB_TEXT_CLASS / .kb-text token", () => {
    const tokens = readFileSync(path.join(root, "tokens.css"), "utf8");
    const content = readFileSync(
      path.join(root, "components/outline/node-content.tsx"),
      "utf8",
    );
    const mdView = readFileSync(
      path.join(root, "components/outline/md-view.tsx"),
      "utf8",
    );

    expect(KB_TEXT_CLASS).toBe("kb-text");
    expect(tokens).toMatch(/\.kb-text\s*\{[^}]*var\(--kb-text\)/s);
    // Both modes must apply the same token class (equal computed font/line-height).
    expect(content).toContain(`KB_TEXT_CLASS`);
    expect(content).toMatch(/isActive[\s\S]*KB_TEXT_CLASS/);
    expect(mdView).toContain("KB_TEXT_CLASS");
    expect(mdView).toContain('className="kb-md-code"');
    expect(mdView).toContain("kb-md-ref");
  });
});
