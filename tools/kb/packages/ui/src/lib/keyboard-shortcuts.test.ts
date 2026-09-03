import { describe, expect, it } from "vitest";
import { matchGlobalShortcut } from "@/lib/keyboard-shortcuts";

describe("keyboard shortcuts", () => {
  it("maps cmd+k to global search without claiming cmd+s", () => {
    expect(
      matchGlobalShortcut({ metaKey: true, ctrlKey: false, key: "k" }),
    ).toBe("global-search");
    expect(
      matchGlobalShortcut({ metaKey: true, ctrlKey: false, key: "S" }),
    ).toBeNull();
    expect(
      matchGlobalShortcut({ metaKey: false, ctrlKey: true, key: "s" }),
    ).toBeNull();
  });

  it("ignores unmodified keys", () => {
    expect(
      matchGlobalShortcut({ metaKey: false, ctrlKey: false, key: "k" }),
    ).toBeNull();
  });
});
