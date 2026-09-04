import { describe, expect, it } from "vitest";
import {
  TAG_PALETTE,
  djb2Hash,
  hashTagColor,
  nodeTagColors,
  resolveTagColor,
  tagColorAlpha,
  tagColorFill,
} from "./tag-color";
import type { TagBadge } from "./types";

function tag(id: string, color: string): TagBadge {
  return { id, name: id, color };
}

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

  it("matches nxus getSupertagColor (Math.abs hash % 12)", () => {
    expect(hashTagColor("tag.todo")).toBe("#8b5cf6");
  });

  it("explicit color prop overrides the hash", () => {
    expect(resolveTagColor("tag.todo", "#112233")).toBe("#112233");
    expect(resolveTagColor("tag.todo", "  #aabbcc  ")).toBe("#aabbcc");
    expect(resolveTagColor("tag.todo", null)).toBe(hashTagColor("tag.todo"));
    expect(resolveTagColor("tag.todo", "")).toBe(hashTagColor("tag.todo"));
  });
});

describe("a node's tag colors (the list, not the first)", () => {
  it("keeps every distinct tag color in tag order", () => {
    expect(
      nodeTagColors({
        tags: [tag("a", "#ef4444"), tag("b", "#22c55e"), tag("c", "#3b82f6")],
      }),
    ).toEqual(["#ef4444", "#22c55e", "#3b82f6"]);
  });

  it("collapses repeats and tolerates a missing node", () => {
    expect(nodeTagColors({ tags: [tag("a", "#ef4444"), tag("b", "#ef4444")] })).toEqual([
      "#ef4444",
    ]);
    expect(nodeTagColors({ tags: [] })).toEqual([]);
    expect(nodeTagColors(null)).toEqual([]);
    expect(nodeTagColors(undefined)).toEqual([]);
  });
});

describe("tag color as a paint value", () => {
  it("weakens any CSS color, not just a 6-digit hex", () => {
    // The bug this replaces: `"red" + "20"` is not a color.
    expect(tagColorAlpha("red", 12.5)).toBe("color-mix(in oklab, red 12.5%, transparent)");
    expect(tagColorAlpha("#ef4444", 25)).toBe("color-mix(in oklab, #ef4444 25%, transparent)");
  });

  it("paints one color solid and no colors at all", () => {
    expect(tagColorFill(["#ef4444"])).toBe("#ef4444");
    expect(tagColorFill([])).toBeNull();
    expect(tagColorFill([], 12.5)).toBeNull();
  });

  it("divides many colors into equal wedges from the center", () => {
    expect(tagColorFill(["#ef4444", "#22c55e"])).toBe(
      "conic-gradient(from 0deg, #ef4444 0% 50%, #22c55e 50% 100%)",
    );
    expect(tagColorFill(["#ef4444", "#22c55e", "#3b82f6"])).toBe(
      "conic-gradient(from 0deg, #ef4444 0% 33.333%," +
        " #22c55e 33.333% 66.667%, #3b82f6 66.667% 100%)",
    );
  });

  it("tints each wedge when the surface is a tint", () => {
    expect(tagColorFill(["#ef4444"], 12.5)).toBe("color-mix(in oklab, #ef4444 12.5%, transparent)");
    expect(tagColorFill(["#ef4444", "#22c55e"], 12.5)).toBe(
      "conic-gradient(from 0deg," +
        " color-mix(in oklab, #ef4444 12.5%, transparent) 0% 50%," +
        " color-mix(in oklab, #22c55e 12.5%, transparent) 50% 100%)",
    );
  });
});
