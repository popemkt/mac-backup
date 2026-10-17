import { describe, expect, test } from "vitest";
import { linkOfText, textOfLink } from "./item-link-text";

describe("a link written as text", () => {
  test("a web address, a node, an item on it, an item here", () => {
    expect(linkOfText(" https://tldraw.dev/a ")).toEqual({ url: "https://tldraw.dev/a" });
    expect(linkOfText("[[n.page]]")).toEqual({ node: "n.page" });
    expect(linkOfText("n.page")).toEqual({ node: "n.page" });
    expect(linkOfText("[[n.page|Page]]#i1")).toEqual({ node: "n.page", item: "i1" });
    expect(linkOfText("#i1")).toEqual({ item: "i1" });
  });

  test("nothing is no link, and what reads as none is refused", () => {
    expect(linkOfText("  ")).toBeUndefined();
    for (const text of ["javascript:alert(1)", "#", "n.page#", "two words", "[[a]] [[b]]"]) {
      expect(linkOfText(text)).toBeNull();
    }
  });

  test("every link reads back from the text it is written as", () => {
    for (const link of [
      { url: "mailto:a@b.c" },
      { node: "n.page" },
      { node: "n.page", item: "i1" },
      { item: "i1" },
    ]) {
      expect(linkOfText(textOfLink(link))).toEqual(link);
    }
  });
});
