import { describe, expect, it } from "vitest";
import {
  BULLET_GEOMETRY,
  BULLET_INK,
  BULLET_QUERY_ICON,
  bulletAppearance,
  bulletRingDash,
  queryHandleStart,
  queryIconPath,
  bulletPaintCss,
  resolveBulletKind,
  type BulletModeInput,
} from "@/lib/bullet-mode";
import { SYSTEM_IDS } from "@/lib/types";

function base(partial: Partial<BulletModeInput> = {}): BulletModeInput {
  return {
    hasChildren: false,
    typeRefs: [],
    tagNames: [],
    isSys: false,
    ...partial,
  };
}

describe("resolveBulletKind", () => {
  it("maps plain leaf and parent", () => {
    expect(resolveBulletKind(base())).toBe("plain");
    expect(resolveBulletKind(base({ hasChildren: true }))).toBe("parent");
  });

  it("maps tag and field from type refs", () => {
    expect(resolveBulletKind(base({ typeRefs: [SYSTEM_IDS.tag] }))).toBe("tag");
    expect(resolveBulletKind(base({ typeRefs: [SYSTEM_IDS.field] }))).toBe("field");
  });

  it("maps query from the sys.f.query field and command from sys.command type", () => {
    expect(resolveBulletKind(base({ fieldIds: [SYSTEM_IDS.queryField] }))).toBe("query");
    expect(resolveBulletKind(base({ typeRefs: [SYSTEM_IDS.command] }))).toBe("command");
  });

  it("a tag NAMED query does not get the query glyph — the field is the kind", () => {
    // The glyph reads the same carrier `isQueryNode` does, so a user tag
    // called `query` cannot make a row look like a live subscription.
    expect(resolveBulletKind(base({ tagNames: ["query"] }))).toBe("plain");
    expect(resolveBulletKind(base({ tagNames: ["Query"] }))).toBe("plain");
  });

  it("maps canvas from #canvas tag or sys.tag.canvas type ref", () => {
    expect(resolveBulletKind(base({ tagNames: ["canvas"] }))).toBe("canvas");
    expect(resolveBulletKind(base({ typeRefs: [SYSTEM_IDS.canvasTag] }))).toBe("canvas");
  });

  it("prefers type ref over parent/query", () => {
    expect(
      resolveBulletKind(
        base({
          hasChildren: true,
          typeRefs: [SYSTEM_IDS.tag],
          fieldIds: [SYSTEM_IDS.queryField],
        }),
      ),
    ).toBe("tag");
  });

  it("accepts media/canvas kind overrides (W6 stubs)", () => {
    expect(resolveBulletKind(base({ kindOverride: "media", hasChildren: true }))).toBe("media");
    expect(resolveBulletKind(base({ kindOverride: "canvas", typeRefs: [SYSTEM_IDS.tag] }))).toBe(
      "canvas",
    );
  });

  it("uses media kind when text embeds ![…](assets/…)", () => {
    expect(
      resolveBulletKind(base({ text: "note ![shot](assets/01HABC.png)", hasChildren: true })),
    ).toBe("media");
    expect(resolveBulletKind(base({ text: "no asset here" }))).toBe("plain");
  });
});

describe("bulletAppearance states", () => {
  it("composes collapsed halo inputs and sys/ref flags", () => {
    const mode = bulletAppearance({
      ...base({ hasChildren: true, isSys: true }),
      collapsed: true,
      childCount: 3,
      isRef: true,
    });
    expect(mode.kind).toBe("parent");
    expect(mode.collapsed).toBe(true);
    expect(mode.childCount).toBe(3);
    expect(mode.isSys).toBe(true);
    expect(mode.isRef).toBe(true);
  });
});

describe("bulletAppearance paints and sizes (the one definition every renderer draws)", () => {
  const appear = (partial: Partial<BulletModeInput>, tagColors: string[] = [], collapsed = true) =>
    bulletAppearance({ ...base(partial), collapsed, childCount: 2, tagColors });

  it("an untinted bullet is the ink, stronger on a parent", () => {
    const leaf = appear({});
    const parent = appear({ hasChildren: true });
    expect(leaf.dot).toEqual({ colors: [BULLET_INK], percent: 40 });
    expect(parent.dot).toEqual({ colors: [BULLET_INK], percent: 50 });
    expect(parent.halo).toEqual({ colors: [BULLET_INK], percent: 8 });
    expect(leaf.dotSize).toBe(BULLET_GEOMETRY.dot.leaf);
    expect(parent.dotSize).toBe(BULLET_GEOMETRY.dot.parent);
  });

  it("a tinted bullet fills with every tag colour and strokes with the first", () => {
    const a = appear({ hasChildren: true }, ["red", "blue"]);
    expect(a.dot).toEqual({ colors: ["red", "blue"], percent: 100 });
    expect(a.halo).toEqual({ colors: ["red", "blue"], percent: 12.5 });
    expect(a.ring).toEqual({ colors: ["red"], percent: 25 });
    expect(bulletPaintCss(a.halo)).toContain("conic-gradient");
  });

  it("a kind glyph is the ink whatever its tags; a supertag takes its first tag", () => {
    expect(appear({ typeRefs: [SYSTEM_IDS.field] }, ["red"]).ink.colors).toEqual([BULLET_INK]);
    expect(appear({ typeRefs: [SYSTEM_IDS.tag] }, ["red"]).ink.colors).toEqual(["red"]);
  });

  it("the halo sits inside the box, and the ring is the halo's size", () => {
    const { box, haloInset, ring } = BULLET_GEOMETRY;
    expect(box - 2 * haloInset).toBe(ring.size);
  });

  it("the ring's dashes close on themselves, near the stated dash and gap", () => {
    const { radius, count, dash, gap } = bulletRingDash();
    const { size, stroke } = BULLET_GEOMETRY.ring;
    expect(radius).toBe(size / 2 - stroke / 2);
    expect(count * (dash + gap)).toBeCloseTo(2 * Math.PI * radius, 9);
    expect(dash / gap).toBeCloseTo(BULLET_GEOMETRY.ring.dash / BULLET_GEOMETRY.ring.gap, 9);
  });

  it("the magnifier's handle leaves the lens on its rim", () => {
    const { lens } = BULLET_QUERY_ICON;
    const from = queryHandleStart();
    expect(Math.hypot(from.x - lens.x, from.y - lens.y)).toBeCloseTo(lens.radius, 9);
    expect(queryIconPath()).toContain(
      `L${BULLET_QUERY_ICON.handle.x},${BULLET_QUERY_ICON.handle.y}`,
    );
  });
});
