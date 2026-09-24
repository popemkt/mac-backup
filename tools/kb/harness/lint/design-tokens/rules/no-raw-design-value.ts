import { defineRule, type ESTree } from "@oxlint/plugins";

/**
 * A component names a design-system step, never a value.
 *
 * kb's UI tokens have three layers (`tools/kb/DESIGN-UI.md` → Design tokens):
 * the design system declares values, a Tailwind `@theme` bridge exposes them as
 * utilities, and components use those utilities. This rule rejects, in any
 * string a UI module writes, the class and colour forms that bypass the bridge:
 *
 * - an arbitrary font size, `text-[11px]` / `text-[length:0.8rem]` /
 *   `text-(length:--x)`, or one of Tailwind's default steps (`text-sm`),
 *   which the bridge resets so it compiles to nothing: use a type step;
 * - a Tailwind shadow outside the elevation scale (`shadow`, `shadow-xl`,
 *   `shadow-[…]`): use an elevation level;
 * - bare `rounded` (Tailwind's fixed 4px) or an arbitrary radius
 *   (`rounded-[5px]`, `rounded-t-[2px]`): use a radius step;
 * - a Tailwind palette colour (`bg-amber-500`, `text-white`): use a palette
 *   token;
 * - a hex colour literal (`#fff`, `bg-[#123456]`), in component modules only —
 *   `lib/` legitimately holds colour data such as the tag-colour hash.
 *
 * Tailwind's own text and shadow namespaces are reset in the bridge, so most
 * of these forms would not even compile; the rule is what makes that failure
 * loud instead of a silently missing style.
 */

const MESSAGES = {
  arbitraryTextSize:
    "`{{cls}}` is not a type step (an arbitrary size, or a Tailwind default the bridge resets). Use a type step (`text-label`, `text-meta`, …) — DESIGN-UI.md → Design tokens → Type scale.",
  rawShadow:
    "`{{cls}}` is not an elevation level. Use `shadow-<level>` (`edge`, `raised`, `lifted`, `floating`, `overlay`, `modal`) — DESIGN-UI.md → Design tokens → Elevation.",
  rawRadius:
    "`{{cls}}` is outside the radius scale (bare `rounded` is a fixed 4px). Use a step: `rounded-xs`, `rounded-sm`, `rounded-md`, … — DESIGN-UI.md → Design tokens.",
  paletteColor:
    "`{{cls}}` is a Tailwind palette colour, outside the design system. Use a palette token (`text-warning`, `bg-scrim/30`, …).",
  hexColor:
    "`{{hex}}` is a raw colour. Components read colour from the design system: a palette utility, or `readTokenColor` on canvas.",
} as const;

type MessageId = keyof typeof MESSAGES;

const HUES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const COLOR_UTILITIES =
  "bg|text|border|border-[xytrblse]|ring|ring-offset|outline|fill|stroke|from|via|to|decoration|divide|accent|caret|placeholder|shadow";

// An arbitrary value that is a length: untyped (`[11px]`, `[calc(…)]`) or
// typed with the `length:` hint, in brackets or the v4 parenthesis form.
const ARBITRARY_TEXT_SIZE = /^text-(?:\[(?:length:|\d|\.\d|calc\(|clamp\(|min\(|max\()|\(length:)/;
// Tailwind's default type steps: reset in the bridge, so they emit nothing.
const DEFAULT_TEXT_STEP = /^text-(?:xs|sm|base|lg|xl|[2-9]xl)$/;
// Bare `rounded` (per side too) and any arbitrary radius.
const RAW_RADIUS = /^rounded(?:-(?:[trblse]|tl|tr|bl|br|ss|se|es|ee))?(?:-\[.*\]|-\(.*\))?$/;
const RAW_SHADOW = /^shadow(?:-(?:2xs|xs|sm|md|lg|xl|2xl|inner)|-\[.*\])?$/;
const PALETTE_COLOR = new RegExp(
  `^(?:${COLOR_UTILITIES})-(?:white|black|(?:${HUES})-\\d{2,3})(?:/.*)?$`,
);
const HEX = /(?:^|[\s[(,:"'])(#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{3,4}))(?=$|[\s\]),;"'])/gi;

/** The utility a class names, without its variants (`dark:hover:`) or `!`. */
function utilityOf(token: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (ch === ":" && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^!|!$/g, "");
}

function classProblem(utility: string): MessageId | null {
  if (ARBITRARY_TEXT_SIZE.test(utility) || DEFAULT_TEXT_STEP.test(utility)) {
    return "arbitraryTextSize";
  }
  if (RAW_SHADOW.test(utility)) return "rawShadow";
  if (RAW_RADIUS.test(utility)) return "rawRadius";
  if (PALETTE_COLOR.test(utility)) return "paletteColor";
  return null;
}

function isComponentModule(filename: string): boolean {
  return /[\\/]components[\\/]/.test(filename);
}

export const noRawDesignValueRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw font sizes, shadows, radii and colours in UI code; use the design-system tokens.",
    },
    messages: MESSAGES,
  },
  createOnce(context) {
    const check = (node: ESTree.Node, text: string) => {
      for (const token of text.split(/\s+/)) {
        if (token.length === 0) continue;
        const utility = utilityOf(token);
        const messageId = classProblem(utility);
        if (messageId !== null) context.report({ node, messageId, data: { cls: token } });
      }
      if (!isComponentModule(context.filename)) return;
      for (const match of text.matchAll(HEX)) {
        context.report({ node, messageId: "hexColor", data: { hex: match[1] ?? match[0] } });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
});
