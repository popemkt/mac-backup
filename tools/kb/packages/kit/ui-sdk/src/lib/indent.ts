/**
 * Outline indent geometry — the single owner of `--kb-indent`.
 *
 * Two rules, and they are the same rule:
 *
 * 1. **Indentation is space BEFORE a row, not space inside it.** Padding lives
 *    inside the border box, so a row that indents with padding paints every
 *    box-level decoration — border, background, focus ring, rounded corners —
 *    across the indent gutter. That is what made an inline field row's hover
 *    separators run leftward to the container edge, over the tree guide lines.
 *    Expressed as margin, the decorated box starts at the content edge by
 *    construction, for every row kind, permanently. The gutter belongs to the
 *    guide line, which carries its own click strip (collapse) in node-block —
 *    no row needs a hit area there.
 *
 * 2. **One place computes the step.** `--kb-indent` (DESIGN-REFINE §2 W1) is
 *    the declared indent, so nothing else may multiply 24 or read the var:
 *    a token no code path reads is worse than no token. Enforced by
 *    `lib/tokens.test.ts`.
 */
import type { CSSProperties } from "react";

/** `depth` indent steps as a CSS length. */
function steps(depth: number): string {
  return `calc(${depth} * var(--kb-indent))`;
}

/**
 * Space before a row (or a row container) at `depth` steps of indentation.
 * Field rows sit one step deeper than their node, so they pass `depth + 1`.
 */
export function indentStyle(depth: number): CSSProperties {
  return { marginLeft: steps(depth) };
}

/**
 * Absolute offset of the guide-line click strip owning the gutter under a row
 * at `depth`. The strip is `w-5` with its 1px line at `left-[9px]`, putting the
 * line at `depth * indent + 11px` (DESIGN-RESKIN §1.3).
 */
export function guideLineStyle(depth: number): CSSProperties {
  return { left: `calc(${steps(depth)} + 2px)` };
}
