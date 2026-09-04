import { SYSTEM_IDS } from "@/lib/types";
import { textHasAssetRef } from "@/lib/md-inline";
import { hasText } from "@/lib/text";

/** Glyph / shape family for the outline bullet (DESIGN-REFINE §2 W1). */
export type BulletKind =
  | "plain"
  | "parent"
  | "tag"
  | "field"
  | "query"
  | "command"
  | "media"
  | "canvas"
  | "ontology";

/** Optional overrides for canvas (and forced media) until those tags ship. */
export type BulletKindOverride = "media" | "canvas";

export interface BulletModeInput {
  hasChildren: boolean;
  /** Values of `sys.f.type` ref props. */
  typeRefs: string[];
  /** Resolved tag badge names (lowercase compare). */
  tagNames: string[];
  /** True when node id starts with `sys.`. */
  isSys: boolean;
  /** Node text — used to detect `![…](assets/…)` media refs (W6a). */
  text?: string;
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

/**
 * Map node metadata → bullet kind.
 * Priority: override → tag/field/command/query/canvas/ontology type →
 * media asset ref → parent → plain.
 */
export function resolveBulletKind(input: BulletModeInput): BulletKind {
  if (input.kindOverride === "media" || input.kindOverride === "canvas") {
    return input.kindOverride;
  }

  const refs = input.typeRefs;
  if (refs.includes(SYSTEM_IDS.tag)) return "tag";
  if (refs.includes(SYSTEM_IDS.field)) return "field";
  // W3: sys.command type node
  if (refs.includes(SYSTEM_IDS.command)) return "command";
  // W4: anything tagged #query
  if (input.tagNames.some((n) => n.toLowerCase() === "query")) return "query";
  // C1: #canvas tag (or seeded sys.tag.canvas)
  if (
    refs.includes(SYSTEM_IDS.canvasTag) ||
    input.tagNames.some((n) => n.toLowerCase() === "canvas")
  ) {
    return "canvas";
  }
  // r5: #ontology tag — a lens over the graph, not ordinary content
  if (
    refs.includes(SYSTEM_IDS.ontologyTag) ||
    input.tagNames.some((n) => n.toLowerCase() === "ontology")
  ) {
    return "ontology";
  }

  // W6a: ▣ when node text embeds an assets/ markdown image
  if (hasText(input.text) && textHasAssetRef(input.text)) return "media";

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
