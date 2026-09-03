import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KB_TEXT_CLASS,
  assetSrcUrl,
  clearInlineMdCache,
  parseInlineMd,
  textHasAssetRef,
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
    expect(parseInlineMd("[[sys.tag]]")).toEqual([{ t: "ref", id: "sys.tag", label: "sys.tag" }]);
  });

  it("parses ![alt](assets/…) into media segments by kind", () => {
    clearInlineMdCache();
    expect(parseInlineMd("pic ![cat](assets/01.png) end")).toEqual([
      { t: "text", v: "pic " },
      {
        t: "media",
        alt: "cat",
        href: "assets/01.png",
        kind: "image",
      },
      { t: "text", v: " end" },
    ]);
    expect(parseInlineMd("![v](assets/x.mp4)")).toEqual([
      { t: "media", alt: "v", href: "assets/x.mp4", kind: "video" },
    ]);
    expect(parseInlineMd("![a](assets/x.mp3)")).toEqual([
      { t: "media", alt: "a", href: "assets/x.mp3", kind: "audio" },
    ]);
  });

  it("does not treat non-asset image markdown as media", () => {
    clearInlineMdCache();
    // Non-assets ![](…) is not media; the bang stays text and [label](url)
    // may still parse as a normal safe link.
    expect(parseInlineMd("![x](https://ex.test/a.png)")).toEqual([
      { t: "text", v: "!" },
      { t: "link", href: "https://ex.test/a.png", label: "x" },
    ]);
    expect(textHasAssetRef("![x](assets/a.png)")).toBe(true);
    expect(textHasAssetRef("no media")).toBe(false);
    expect(assetSrcUrl("assets/a.png")).toBe("/assets/a.png");
  });

  it("refuses unsafe link protocols (XSS)", () => {
    clearInlineMdCache();
    // javascript:/data: links must fall through as plain text segments.
    expect(parseInlineMd("[x](javascript:alert(1))")).toEqual([
      { t: "text", v: "[x](javascript:alert(1))" },
    ]);
    expect(parseInlineMd("[x](data:text/html,hi)")).toEqual([
      { t: "text", v: "[x](data:text/html,hi)" },
    ]);
    expect(parseInlineMd("[a](assets/pic.png)")).toEqual([
      { t: "link", href: "assets/pic.png", label: "a" },
    ]);
  });

  it("keeps balanced parens inside URLs", () => {
    expect(parseInlineMd("[d](https://ex.test/f(1))")).toEqual([
      { t: "link", href: "https://ex.test/f(1)", label: "d" },
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
    expect(parseInlineMd("a * lone star")).toEqual([{ t: "text", v: "a * lone star" }]);
  });
});

describe("line-height consistency (edit vs view)", () => {
  it("edit and view share KB_TEXT_CLASS / .kb-text token", () => {
    const tokens = readFileSync(path.join(root, "tokens.css"), "utf8");
    const content = readFileSync(path.join(root, "components/outline/node-content.tsx"), "utf8");
    const mdView = readFileSync(path.join(root, "components/outline/md-view.tsx"), "utf8");

    expect(KB_TEXT_CLASS).toBe("kb-text");
    expect(tokens).toMatch(/\.kb-text\s*\{[^}]*var\(--kb-text-size\)/s);
    // Both modes must apply the same token class (equal computed font/line-height).
    expect(content).toContain(`KB_TEXT_CLASS`);
    expect(content).toMatch(/isActive[\s\S]*KB_TEXT_CLASS/);
    expect(mdView).toContain("KB_TEXT_CLASS");
    expect(mdView).toContain('className="kb-md-code"');
    expect(mdView).toContain("kb-md-ref");
    // W6a render branch for assets media
    expect(mdView).toContain('case "media"');
    expect(mdView).toContain("kb-md-media");
    expect(mdView).toMatch(/<img[\s\S]*kb-md-media/);
    expect(mdView).toMatch(/<video[\s\S]*kb-md-media/);
    expect(mdView).toMatch(/<audio[\s\S]*kb-md-media/);
  });
});
