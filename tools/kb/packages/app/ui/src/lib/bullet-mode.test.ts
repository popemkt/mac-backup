import { describe, expect, it } from "vitest";
import { bulletAppearance, resolveBulletKind, type BulletModeInput } from "@/lib/bullet-mode";
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
