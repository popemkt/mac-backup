import { describe, expect, it } from "vitest";
import { matchGlobalShortcut } from "@/lib/keyboard-shortcuts";

const free = { rowAnchored: false };
const anchored = { rowAnchored: true };

describe("keyboard shortcuts", () => {
  it("maps cmd+k to global search without claiming cmd+s", () => {
    expect(matchGlobalShortcut({ metaKey: true, ctrlKey: false, key: "k" }, free)).toBe(
      "global-search",
    );
    expect(matchGlobalShortcut({ metaKey: true, ctrlKey: false, key: "S" }, free)).toBeNull();
    expect(matchGlobalShortcut({ metaKey: false, ctrlKey: true, key: "s" }, free)).toBeNull();
  });

  it("maps cmd+k to the node palette when a row is there to anchor it", () => {
    expect(matchGlobalShortcut({ metaKey: true, ctrlKey: false, key: "K" }, anchored)).toBe(
      "node-palette",
    );
    expect(matchGlobalShortcut({ metaKey: false, ctrlKey: true, key: "k" }, anchored)).toBe(
      "node-palette",
    );
  });

  it("ignores unmodified keys", () => {
    expect(matchGlobalShortcut({ metaKey: false, ctrlKey: false, key: "k" }, anchored)).toBeNull();
  });
});
