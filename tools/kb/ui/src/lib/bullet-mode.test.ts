import { describe, expect, it } from "vitest";
import {
  resolveBulletKind,
  resolveBulletMode,
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
    expect(
      resolveBulletKind(base({ typeRefs: [SYSTEM_IDS.tag] })),
    ).toBe("tag");
    expect(
      resolveBulletKind(base({ typeRefs: [SYSTEM_IDS.field] })),
    ).toBe("field");
  });

  it("maps query from #query tag and command from sys.command type", () => {
    expect(
      resolveBulletKind(base({ tagNames: ["query"] })),
    ).toBe("query");
    expect(
      resolveBulletKind(base({ tagNames: ["Query"] })),
    ).toBe("query");
    expect(
      resolveBulletKind(base({ typeRefs: [SYSTEM_IDS.command] })),
    ).toBe("command");
  });

  it("prefers type ref over parent/query", () => {
    expect(
      resolveBulletKind(
        base({
          hasChildren: true,
          typeRefs: [SYSTEM_IDS.tag],
          tagNames: ["query"],
        }),
      ),
    ).toBe("tag");
  });

  it("accepts media/canvas kind overrides (W6 stubs)", () => {
    expect(
      resolveBulletKind(base({ kindOverride: "media", hasChildren: true })),
    ).toBe("media");
    expect(
      resolveBulletKind(base({ kindOverride: "canvas", typeRefs: [SYSTEM_IDS.tag] })),
    ).toBe("canvas");
  });
});

describe("resolveBulletMode states", () => {
  it("composes collapsed halo inputs and sys/ref flags", () => {
    const mode = resolveBulletMode({
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
