import { describe, expect, it } from "vitest";
import {
  TAG_PALETTE,
  djb2Hash,
  hashTagColor,
  nodeTagColors,
  UNTAGGED_COLOR,
  tagColorOf,
  tagPalette,
  type TagPalette,
  tagColorAlpha,
  tagColorFill,
} from "./tag-color";
import type { WireNode } from "@kb/contracts";
import { wireToOutlineMap } from "./graph-view";
import { SYSTEM_IDS, type TagBadge } from "./types";

function tagNode(
  id: string,
  props: WireNode["props"] = {},
  createdAt = "2026-01-01T00:00:00.000Z",
): WireNode {
  return {
    id,
    text: id,
    children: [],
    props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }], ...props },
    createdAt,
    updatedAt: createdAt,
  };
}

function at(day: number): string {
  return `2026-01-0${day}T00:00:00.000Z`;
}

/** The palette of a workspace holding exactly `nodes`. */
function graph(...nodes: WireNode[]): TagPalette {
  return tagPalette(nodes);
}

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
    const withColor = (color?: string) =>
      graph(
        tagNode(
          "tag.todo",
          color === undefined ? {} : { [SYSTEM_IDS.colorField]: [{ t: "str", v: color }] },
        ),
      );
    expect(tagColorOf("tag.todo", withColor("#112233"))).toBe("#112233");
    expect(tagColorOf("tag.todo", withColor("  #aabbcc  "))).toBe("#aabbcc");
    expect(tagColorOf("tag.todo", withColor())).toBe(hashTagColor("tag.todo"));
    expect(tagColorOf("tag.todo", withColor(""))).toBe(hashTagColor("tag.todo"));
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

describe("tag colours in one graph do not collide (P2-3)", () => {
  // The first two `t<i>` ids that hash onto the same palette slot.
  const [first, second] = ((): [string, string] => {
    const seen = new Map<string, string>();
    for (let i = 0; ; i++) {
      const id = `t${i}`;
      const other = seen.get(hashTagColor(id));
      if (other !== undefined) return [other, id];
      seen.set(hashTagColor(id), id);
    }
  })();

  it("gives the second tag on a taken slot the next free one, and keeps the older one's", () => {
    const byId = graph(tagNode(first, {}, at(1)), tagNode(second, {}, at(2)));
    expect(tagColorOf(first, byId)).toBe(hashTagColor(first));
    const slot = TAG_PALETTE.findIndex((entry) => entry === hashTagColor(second));
    expect(tagColorOf(second, byId)).toBe(TAG_PALETTE[(slot + 1) % TAG_PALETTE.length]);
  });

  it("lets an explicit palette colour hold its slot", () => {
    const explicit = { [SYSTEM_IDS.colorField]: [{ t: "str" as const, v: hashTagColor(first) }] };
    const byId = graph(tagNode("tag.explicit", explicit, at(2)), tagNode(first, {}, at(1)));
    expect(tagColorOf("tag.explicit", byId)).toBe(hashTagColor(first));
    expect(tagColorOf(first, byId)).not.toBe(hashTagColor(first));
  });

  it("uses every slot once before any slot twice", () => {
    const tags = Array.from({ length: TAG_PALETTE.length + 1 }, (_, i) =>
      tagNode(`tag.${i}`, {}, `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`),
    );
    const byId = graph(...tags);
    const colors = tags.map((t) => tagColorOf(t.id, byId));
    expect(new Set(colors.slice(0, TAG_PALETTE.length)).size).toBe(TAG_PALETTE.length);
  });

  it("paints untagged grey, outside the palette", () => {
    expect(TAG_PALETTE).not.toContain(UNTAGGED_COLOR);
  });
});

describe("one palette for the whole workspace (review: scoped projections)", () => {
  it("a projection of a subset keeps every tag's colour, because it reads the full graph's palette", () => {
    const [older, newer] = (() => {
      const seen = new Map<string, string>();
      for (let i = 0; ; i++) {
        const id = `s${i}`;
        const other = seen.get(hashTagColor(id));
        if (other !== undefined) return [other, id];
        seen.set(hashTagColor(id), id);
      }
    })();
    const tagged: WireNode = {
      id: "n.member",
      text: "member",
      children: [],
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: newer }] },
      createdAt: at(3),
      updatedAt: at(3),
    };
    const full = [tagNode(older, {}, at(1)), tagNode(newer, {}, at(2)), tagged];
    const workspaceColor = tagColorOf(newer, tagPalette(full));
    expect(workspaceColor).not.toBe(hashTagColor(newer));

    // A scope that drops the older tag: a palette of the subset would give
    // `newer` its hash slot back, i.e. repaint it.
    const scoped = [tagNode(newer, {}, at(2)), tagged];
    expect(tagColorOf(newer, tagPalette(scoped))).toBe(hashTagColor(newer));
    // The projection is handed the whole graph, and colours its chips from it.
    const projected = wireToOutlineMap(scoped, new Set(), full);
    expect(projected.get("n.member")?.tags[0]?.color).toBe(workspaceColor);
  });
});
