import { SYSTEM_IDS } from "@/lib/types";
import type { OutlineNode } from "@/lib/types";

/** Glyph / shape family for the outline bullet (DESIGN-REFINE §2 W1). */
export type BulletKind =
  | "plain"
  | "parent"
  | "tag"
  | "field"
  | "query"
  | "command"
  | "media"
  | "canvas";

/** Optional overrides for W6 stubs (media/canvas) until those tags ship. */
export type BulletKindOverride = "media" | "canvas";

export interface BulletModeInput {
  hasChildren: boolean;
  /** Values of `sys.f.type` ref props. */
  typeRefs: string[];
  /** Resolved tag badge names (lowercase compare). */
  tagNames: string[];
  /** True when node id starts with `sys.`. */
  isSys: boolean;
  /** Stub override for media/canvas kinds. */
  kindOverride?: BulletKindOverride | null;
}

export interface BulletMode {
  kind: BulletKind;
  collapsed: boolean;
  isRef: boolean;
  isSys: boolean;
  childCount: number;
}

/** Collect `sys.f.type` ref targets from a node. */
export function typeRefsOf(
  node: Pick<OutlineNode, "props"> | undefined,
): string[] {
  if (!node) return [];
  const vals = node.props[SYSTEM_IDS.typeField] ?? [];
  return vals.filter((v) => v.t === "ref").map((v) => v.v);
}

/**
 * Map node metadata → bullet kind.
 * Priority: override → tag/field/command/query type → parent → plain.
 */
export function resolveBulletKind(input: BulletModeInput): BulletKind {
  if (input.kindOverride === "media" || input.kindOverride === "canvas") {
    return input.kindOverride;
  }

  const refs = input.typeRefs;
  if (refs.includes(SYSTEM_IDS.tag)) return "tag";
  if (refs.includes(SYSTEM_IDS.field)) return "field";
  // W3: sys.command type node (may not exist in seed yet)
  if (refs.includes("sys.command")) return "command";
  // W4: anything tagged #query
  if (input.tagNames.some((n) => n.toLowerCase() === "query")) return "query";

  if (input.hasChildren) return "parent";
  return "plain";
}

export function resolveBulletMode(
  input: BulletModeInput & {
    collapsed: boolean;
    childCount: number;
    isRef?: boolean;
  },
): BulletMode {
  return {
    kind: resolveBulletKind(input),
    collapsed: input.collapsed,
    isRef: input.isRef ?? false,
    isSys: input.isSys,
    childCount: input.childCount,
  };
}
