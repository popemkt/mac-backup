import { describe, expect, it } from "vitest";
import { matchGlobalShortcut } from "@/lib/keyboard-shortcuts";

describe("keyboard shortcuts", () => {
  it("maps cmd+k to node palette and cmd+s to global search", () => {
    expect(
      matchGlobalShortcut({ metaKey: true, ctrlKey: false, key: "k" }),
    ).toBe("node-palette");
    expect(
      matchGlobalShortcut({ metaKey: true, ctrlKey: false, key: "S" }),
    ).toBe("global-search");
    expect(
      matchGlobalShortcut({ metaKey: false, ctrlKey: true, key: "s" }),
    ).toBe("global-search");
  });

  it("ignores unmodified keys", () => {
    expect(
      matchGlobalShortcut({ metaKey: false, ctrlKey: false, key: "k" }),
    ).toBeNull();
  });
});
