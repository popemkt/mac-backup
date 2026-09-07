/**
 * Mode A editing keymap (r1 §3.2) — chord to intent, as data.
 *
 * The pure half of the outline's editing contract: given a chord and what the
 * row looks like right now, which intent does it mean. Nothing here touches
 * the store or the DOM, so the merge/split/indent rules are readable and
 * testable without a live editor; {@link ./editing-intents} carries them out.
 *
 * Chords resolve through `lib/keychord`, the same helper the selection keymap
 * reads — one answer to "does this event match this chord", not two. The
 * keymap sits on the outline surface rather than in `lib/` because its context
 * is caret geometry: {@link VerticalNavDecision} belongs to `./caret`, and a
 * leaf module may not reach up here for it.
 */
import { lookupChord, type Chord, type KeyChordEvent } from "@/lib/keychord";
import type { VisibleInstance } from "@/lib/visible-instances";
import type { VerticalNavDecision } from "./caret";

/** What the row looks like to the keymap. Offsets are SERIALIZED offsets. */
export interface EditingKeyContext {
  /** A reference instance: its text is the target's, so it edits nothing. */
  readonly isRef: boolean;
  readonly nodeId: string;
  readonly instanceKey: string;
  readonly cursor: number;
  readonly text: string;
  readonly childCount: number;
  readonly collapsed: boolean;
  readonly tagCount: number;
  readonly parentId: string | null;
  /** Index among the parent's children; -1 when no parent row holds this one. */
  readonly siblingIndex: number;
  readonly previousInstance: VisibleInstance | null;
  readonly nextInstance: VisibleInstance | null;
  readonly textLengthOf: (nodeId: string) => number;
  /**
   * Visual-line decision for the pressed arrow (D10/D11).
   *
   * A function, not a value: reading caret geometry costs a layout probe, and
   * only the two bare-arrow chords ask for one.
   */
  readonly readVerticalDecision: (key: string) => VerticalNavDecision;
}

export type EditingIntent =
  /** Claimed and deliberately inert — the key must not reach the browser. */
  | { type: "claim" }
  | { type: "softBreak"; nodeId: string; instanceKey: string; cursor: number }
  | { type: "split"; nodeId: string; cursor: number }
  | { type: "indent"; nodeId: string; cursor: number }
  | { type: "outdent"; nodeId: string; cursor: number }
  | { type: "deleteSubtree"; nodeId: string; instanceKey: string }
  | { type: "deleteEmptyRow"; nodeId: string; instanceKey: string }
  | { type: "mergeIntoPrevious"; nodeId: string; instanceKey: string }
  | {
      type: "mergeNextIn";
      nodeId: string;
      instanceKey: string;
      nextNodeId: string;
      caret: number;
    }
  | { type: "moveUp"; nodeId: string }
  | { type: "moveDown"; nodeId: string }
  | { type: "toggleCollapse"; nodeId: string }
  | { type: "zoomToParent"; parentId: string }
  | {
      type: "moveCaretToRow";
      nodeId: string;
      instanceKey: string;
      cursor: number;
      x: number | null;
    }
  | { type: "select"; nodeId: string; instanceKey: string };

interface EditingBinding {
  readonly chord: Chord;
  readonly toIntent: (ctx: EditingKeyContext, key: string) => EditingIntent | null;
}

interface RefGuardBinding {
  readonly chord: Chord;
  /** Second half of the row's condition, for rows that read the caret. */
  readonly when?: (ctx: EditingKeyContext) => boolean;
}

const ARROWS = ["ArrowUp", "ArrowDown"] as const;

/**
 * The chords a reference instance swallows.
 *
 * A reference displays the target's text, so a structural edit on it would
 * either edit an invisible second string or restructure the wrong row. Note
 * the modifier: ⌘⇧↑ is listed while ⌃⇧↑ is not, because only the Command
 * spelling reorders — the Control spelling means "collapse", which a
 * reference may do.
 */
const REF_STRUCTURAL: readonly RefGuardBinding[] = [
  { chord: { key: "Tab" } },
  { chord: { key: "Enter", shift: false } },
  { chord: { key: ["Backspace", "Delete"], mod: true } },
  { chord: { key: "Backspace" }, when: (ctx) => ctx.cursor === 0 },
  { chord: { key: ARROWS, meta: true, shift: true } },
];

/** Delete the subtree and hand focus to a surviving neighbour. */
function deleteSubtree(ctx: EditingKeyContext): EditingIntent {
  return { type: "deleteSubtree", nodeId: ctx.nodeId, instanceKey: ctx.instanceKey };
}

/**
 * Unmodified Backspace, in the order the row's shape decides it.
 *
 * Mid-text is the browser's; at offset 0 an empty leaf deletes itself, a first
 * child outdents rather than swallowing its parent (D08), and anything deeper
 * merges into the VISIBLE predecessor (D09). The forest's top edge has nothing
 * above it, so the key stays native.
 */
function backspaceIntent(ctx: EditingKeyContext): EditingIntent | null {
  if (ctx.cursor !== 0) return null;
  if (ctx.text === "" && ctx.childCount === 0) {
    return { type: "deleteEmptyRow", nodeId: ctx.nodeId, instanceKey: ctx.instanceKey };
  }
  if (ctx.siblingIndex === 0) {
    return { type: "outdent", nodeId: ctx.nodeId, cursor: ctx.cursor };
  }
  if (ctx.siblingIndex > 0) {
    return { type: "mergeIntoPrevious", nodeId: ctx.nodeId, instanceKey: ctx.instanceKey };
  }
  return null;
}

/** Unmodified forward delete: at end of text, merge the next visible row in (F13). */
function deleteIntent(ctx: EditingKeyContext): EditingIntent | null {
  if (ctx.cursor !== ctx.text.length) return null;
  const next = ctx.nextInstance;
  if (next === null || next.nodeId === ctx.nodeId) return null;
  return {
    type: "mergeNextIn",
    nodeId: ctx.nodeId,
    instanceKey: ctx.instanceKey,
    nextNodeId: next.nodeId,
    caret: ctx.text.length,
  };
}

/**
 * A modified arrow reveals or hides: up closes an open parent, else leaves for
 * the enclosing page; down opens a closed row that has something to show —
 * children OR tags, since a tagged childless row still has field rows.
 * Neither is ever native, so a row with nothing to reveal still claims the key.
 */
function revealIntent(ctx: EditingKeyContext, key: string): EditingIntent {
  if (key === "ArrowUp") {
    if (ctx.childCount > 0 && !ctx.collapsed) {
      return { type: "toggleCollapse", nodeId: ctx.nodeId };
    }
    return ctx.parentId === null
      ? { type: "claim" }
      : { type: "zoomToParent", parentId: ctx.parentId };
  }
  if (ctx.collapsed && (ctx.childCount > 0 || ctx.tagCount > 0)) {
    return { type: "toggleCollapse", nodeId: ctx.nodeId };
  }
  return { type: "claim" };
}

/** A bare arrow crosses rows only from the outermost visual line (D10/D11). */
function crossRowIntent(ctx: EditingKeyContext, key: string): EditingIntent | null {
  const decision = ctx.readVerticalDecision(key);
  if (decision.kind === "within") return null;
  const neighbour = decision.direction === -1 ? ctx.previousInstance : ctx.nextInstance;
  if (neighbour === null) return null;
  return {
    type: "moveCaretToRow",
    nodeId: neighbour.nodeId,
    instanceKey: neighbour.instanceKey,
    cursor: decision.direction === -1 ? ctx.textLengthOf(neighbour.nodeId) : 0,
    x: decision.x,
  };
}

/**
 * The binding set, first match wins.
 *
 * The three arrow rows are the order that matters: ⌘⇧ reorders, any other
 * command-modified arrow reveals, and the bare arrow navigates. Rows whose
 * outcome depends on the caret or the row's shape name a function rather than
 * splitting into more chords — the chord answers "which key", the function
 * answers "which of this key's meanings".
 */
const EDITING_KEYMAP: readonly EditingBinding[] = [
  {
    // Soft line break inside the node — never a split (§3.2).
    chord: { key: "Enter", shift: true },
    toIntent: (ctx) => ({
      type: "softBreak",
      nodeId: ctx.nodeId,
      instanceKey: ctx.instanceKey,
      cursor: ctx.cursor,
    }),
  },
  {
    // Expanded parent ⇒ first child; otherwise sibling-after (D07).
    chord: { key: "Enter" },
    toIntent: (ctx) => ({ type: "split", nodeId: ctx.nodeId, cursor: ctx.cursor }),
  },
  {
    chord: { key: "Tab", shift: true },
    toIntent: (ctx) => ({ type: "outdent", nodeId: ctx.nodeId, cursor: ctx.cursor }),
  },
  {
    chord: { key: "Tab" },
    toIntent: (ctx) => ({ type: "indent", nodeId: ctx.nodeId, cursor: ctx.cursor }),
  },
  {
    // Delete the subtree — an offset-0 gesture: mid-text the caret check
    // returns first, so the modifier alone never restructures a row.
    chord: { key: "Backspace", mod: true },
    toIntent: (ctx) => (ctx.cursor === 0 ? deleteSubtree(ctx) : null),
  },
  { chord: { key: "Backspace" }, toIntent: backspaceIntent },
  { chord: { key: "Delete", mod: true }, toIntent: deleteSubtree },
  { chord: { key: "Delete" }, toIntent: deleteIntent },
  {
    chord: { key: ARROWS, meta: true, shift: true },
    toIntent: (ctx, key) =>
      key === "ArrowUp"
        ? { type: "moveUp", nodeId: ctx.nodeId }
        : { type: "moveDown", nodeId: ctx.nodeId },
  },
  { chord: { key: ARROWS, mod: true }, toIntent: revealIntent },
  { chord: { key: ARROWS }, toIntent: crossRowIntent },
  {
    // Popups handle Escape before delegating; bare Escape selects.
    chord: { key: "Escape" },
    toIntent: (ctx) => ({ type: "select", nodeId: ctx.nodeId, instanceKey: ctx.instanceKey }),
  },
];

/**
 * The intent a chord means on this row, or null to leave the key to the
 * browser. A non-null intent is always claimed with `preventDefault`.
 */
export function mapEditingKey(ev: KeyChordEvent, ctx: EditingKeyContext): EditingIntent | null {
  if (
    ctx.isRef &&
    lookupChord(ev, REF_STRUCTURAL, (binding) => binding.when?.(ctx) ?? true) !== undefined
  ) {
    return { type: "claim" };
  }
  const binding = lookupChord(ev, EDITING_KEYMAP);
  return binding === undefined ? null : binding.toIntent(ctx, ev.key);
}
