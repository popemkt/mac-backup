import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KB_TEXT_CLASS,
  assetSrcUrl,
  clearInlineMdCache,
  inlineSpanSource,
  parseInlineMd,
  parseInlineSource,
  textHasAssetRef,
} from "./md-inline";

function literal(text: string): void {
  expect(parseInlineMd(text)).toEqual([{ t: "text", v: text }]);
}

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

  describe("CommonMark flanking", () => {
    it("never opens or closes `_` inside a word", () => {
      literal("a_b_c");
      literal("snake_case_name");
      literal("Review reconcile_claude_direct_routing.py");
      literal("x__y__z");
    });

    it("still emphasises a `_` run at word boundaries", () => {
      expect(parseInlineMd("_em_")).toEqual([{ t: "italic", v: "em" }]);
      expect(parseInlineMd("a _b_ c")).toEqual([
        { t: "text", v: "a " },
        { t: "italic", v: "b" },
        { t: "text", v: " c" },
      ]);
      // The intraword `_` inside is text; the outer pair still closes.
      expect(parseInlineMd("_foo_bar_")).toEqual([{ t: "italic", v: "foo_bar" }]);
      // CommonMark: `__init__.py` is strong "init" — the closing run is followed
      // by punctuation, which does not stop it from closing.
      expect(parseInlineMd("__init__.py")).toEqual([
        { t: "bold", v: "init" },
        { t: "text", v: ".py" },
      ]);
    });

    it("opens a run longer than two on its inner strong delimiter", () => {
      expect(parseInlineMd("***text***")).toEqual([{ t: "bold", v: "text" }]);
      expect(parseInlineMd("****bold****")).toEqual([{ t: "bold", v: "bold" }]);
      expect(parseInlineMd("a ***b*** c")).toEqual([
        { t: "text", v: "a " },
        { t: "bold", v: "b" },
        { t: "text", v: " c" },
      ]);
      // Only one side has the extra mark: it stays text.
      expect(parseInlineMd("***x**")).toEqual([
        { t: "text", v: "*" },
        { t: "bold", v: "x" },
      ]);
      literal("***");
      literal("a *** b");
    });

    it("flanks a long `_` run on its outer boundary, not its inner marks", () => {
      literal("a___b___c");
      literal("x___y");
      literal("__foo___bar");
      expect(parseInlineMd("___foo___")).toEqual([{ t: "bold", v: "foo" }]);
      // A run that cannot close is skipped, and the search goes on to a later
      // valid closer rather than giving up at the first failed one.
      expect(parseInlineMd("__foo___bar__")).toEqual([{ t: "bold", v: "foo___bar" }]);
      expect(parseInlineMd("___foo___bar___")).toEqual([{ t: "bold", v: "foo___bar" }]);
      expect(parseInlineMd("__foo___")).toEqual([
        { t: "bold", v: "foo" },
        { t: "text", v: "_" },
      ]);
    });

    it("lets `*` emphasise inside a word", () => {
      expect(parseInlineMd("un*frig*ly")).toEqual([
        { t: "text", v: "un" },
        { t: "italic", v: "frig" },
        { t: "text", v: "ly" },
      ]);
    });

    it("does not open before, or close after, whitespace", () => {
      literal("2 * 3 * 4");
      literal("a ** b ** c");
    });
  });
});

describe("parseInlineSource", () => {
  const corpus = [
    "",
    "plain",
    "**b** and *i* plus `c`",
    "__b__ _i_ snake_case_name",
    "***both*** and ****four****",
    "***left** only",
    "**right*** only",
    "see [[n.root-a|Ship]] ok [[sys.tag]] [[ spaced | label ]]",
    "[docs](https://ex.test/a_(b)) and [bad](javascript:x)",
    "![shot](assets/a.png) ![x](https://ex.test/a.png) ![v](assets/v.mp4)",
    "unmatched ** and * and ` and [[ and [x](",
    "`**not bold**` then **bold `code`**",
    "line one\nline **two**",
  ];

  it("rebuilds every text byte for byte from its spans", () => {
    for (const text of corpus) {
      expect(parseInlineSource(text).map(inlineSpanSource).join("")).toBe(text);
    }
  });

  it("keeps the delimiters a segment was written with", () => {
    expect(parseInlineSource("__b__ ***i***")).toEqual([
      { seg: { t: "bold", v: "b" }, open: "__", close: "__" },
      { seg: { t: "text", v: " " }, open: "", close: "" },
      { seg: { t: "bold", v: "i" }, open: "***", close: "***" },
    ]);
    expect(parseInlineSource("[docs](https://ex.test)")).toEqual([
      {
        seg: { t: "link", href: "https://ex.test", label: "docs" },
        open: "[",
        close: "](https://ex.test)",
      },
    ]);
  });

  it("carries an atomic segment's whole token in open", () => {
    expect(parseInlineSource("[[ n.a | L ]]")).toEqual([
      { seg: { t: "ref", id: "n.a", label: "L" }, open: "[[ n.a | L ]]", close: "" },
    ]);
  });

  it("is the one parse parseInlineMd reads", () => {
    const text = "**b** [[n.a|L]]";
    expect(parseInlineMd(text)).toEqual(parseInlineSource(text).map((span) => span.seg));
  });
});

describe("line-height consistency (edit vs view)", () => {
  it("edit and view share KB_TEXT_CLASS / .kb-text token", () => {
    const tokens = readFileSync(path.join(root, "tokens.css"), "utf8");
    const content = readFileSync(path.join(root, "components/ui/node-text-host.tsx"), "utf8");
    expect(KB_TEXT_CLASS).toBe("kb-text");
    expect(tokens).toMatch(/\.kb-text\s*\{[^}]*var\(--type-body\)/s);
    // Both modes must apply the same token class (equal computed font/line-height).
    expect(content).toContain(`KB_TEXT_CLASS`);
    expect(content).toMatch(/isActive[\s\S]*KB_TEXT_CLASS/);
  });
});
