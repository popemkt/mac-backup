import { describe, expect, it } from "vitest";
import { urlLabel } from "@/lib/url-label";

describe("a url's label", () => {
  it("drops the scheme, www and a trailing slash", () => {
    expect(urlLabel("https://www.example.com/")).toBe("example.com");
    expect(urlLabel("http://kb.example/docs/a")).toBe("kb.example/docs/a");
  });

  it("shows a mail link's address", () => {
    expect(urlLabel("mailto:me@kb.example")).toBe("me@kb.example");
  });

  it("keeps a long path's ends around an ellipsis", () => {
    const long =
      "https://github.com/popemkt/dotfiles/blob/main/tools/kb/packages/app/ui/src/lib/follow.ts";
    const label = urlLabel(long);
    expect(label.startsWith("github.com/popemkt/")).toBe(true);
    expect(label.endsWith("follow.ts")).toBe(true);
    expect(label).toContain("…");
    expect(label.length).toBeLessThanOrEqual(48);
  });

  it("truncates a single long segment", () => {
    const label = urlLabel(`https://example.com/${"a".repeat(80)}`);
    expect(label.length).toBe(48);
    expect(label.endsWith("…")).toBe(true);
  });
});
