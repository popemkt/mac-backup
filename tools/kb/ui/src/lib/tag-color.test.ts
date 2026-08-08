import { describe, expect, it } from "vitest";
import {
  TAG_PALETTE,
  djb2Hash,
  hashTagColor,
  resolveTagColor,
} from "./tag-color";

describe("tag color hash (DESIGN-RESKIN §1.8)", () => {
  it("maps tag ids deterministically into the 12-color palette", () => {
    const a = hashTagColor("tag.todo");
    const b = hashTagColor("tag.todo");
    expect(a).toBe(b);
    expect(TAG_PALETTE).toContain(a);
    const colors = TAG_PALETTE.map((_, i) => hashTagColor(`tag-palette-${i}`));
    expect(new Set(colors).size).toBeGreaterThan(1);
  });

  it("djb2Hash is stable for known inputs", () => {
    expect(djb2Hash("tag.todo")).toBe(djb2Hash("tag.todo"));
    expect(typeof djb2Hash("x")).toBe("number");
  });

  it("explicit color prop overrides the hash", () => {
    expect(resolveTagColor("tag.todo", "#112233")).toBe("#112233");
    expect(resolveTagColor("tag.todo", "  #aabbcc  ")).toBe("#aabbcc");
    expect(resolveTagColor("tag.todo", null)).toBe(hashTagColor("tag.todo"));
    expect(resolveTagColor("tag.todo", "")).toBe(hashTagColor("tag.todo"));
  });
});
