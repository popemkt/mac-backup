import { defineRule, type ESTree } from "@oxlint/plugins";

/**
 * Policy: a component names a design-system step, never a value.
 *
 * kb's UI tokens have three layers (`tools/kb/DESIGN-UI.md` → Design tokens):
 * the design system declares values, a Tailwind `@theme` bridge exposes them as
 * utilities, and components use those utilities. This rule rejects, in any
 * string a UI module writes, the forms that compile but skip the bridge:
 *
 * - an arbitrary font size, in any data type Tailwind reads as a size —
 *   length, percentage, absolute-size, relative-size — untyped or typed, in
 *   `[…]` or `(…)` form (`text-[11px]`, `text-[large]`,
 *   `text-(percentage:--x)`); an arbitrary colour (`text-[color:…]`) is not
 *   a size and passes;
 * - an arbitrary shadow (`shadow-[…]`), and the shadow families the bridge
 *   does not own (`drop-shadow-*`, `inset-shadow-*`, `text-shadow-*`);
 * - an arbitrary radius (`rounded-[5px]`, `rounded-t-[2px]`);
 * - a Tailwind palette colour (`bg-amber-500`, `text-white`);
 * - a hex colour literal (`#fff`, `bg-[#123456]`), in component modules only —
 *   `lib/` legitimately holds colour data such as the tag-colour hash.
 *
 * It does not ask whether a class emits CSS at all. A Tailwind default step
 * the bridge resets (`text-sm`, `shadow-xl`, `rounded-3xl`, bare `rounded`)
 * compiles to nothing; that is liveness, and Tailwind answers it in the
 * harness (`harness/tests/ui-utilities-live.test.ts`). One owner per question.
 */

const MESSAGES = {
  arbitraryTextSize:
    "`{{cls}}` is an arbitrary font size. Use a type step (`text-label`, `text-meta`, …) — DESIGN-UI.md → Design tokens → Type scale.",
  rawShadow:
    "`{{cls}}` bypasses the elevation levels. Use `shadow-<level>` (`edge`, `raised`, `lifted`, `floating`, `overlay`, `modal`) — DESIGN-UI.md → Design tokens → Elevation.",
  rawRadius:
    "`{{cls}}` is an arbitrary radius. Use a step: `rounded-xs`, `rounded-sm`, `rounded-md`, … — DESIGN-UI.md → Design tokens.",
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

/** The CSS keywords Tailwind reads as a font size (absolute- and relative-size). */
const SIZE_KEYWORDS =
  "xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller";
const ARBITRARY_TEXT_SIZE = new RegExp(
  [
    // typed, either form: text-[length:…], text-(percentage:--x), …
    String.raw`^text-[[(](?:length|percentage|absolute-size|relative-size):`,
    // untyped bracket value that is a number, a function of lengths, or a keyword
    String.raw`^text-\[(?:[-+]?[\d.]|calc\(|clamp\(|min\(|max\(|(?:${SIZE_KEYWORDS})\]$)`,
  ].join("|"),
);
const RAW_SHADOW = /^(?:shadow-[[(]|(?:drop|inset|text)-shadow(?:-|$))/;
const RAW_RADIUS = /^rounded(?:-(?:[trblse]|tl|tr|bl|br|ss|se|es|ee))?-[[(]/;
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
  if (ARBITRARY_TEXT_SIZE.test(utility)) return "arbitraryTextSize";
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
