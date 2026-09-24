import { RuleTester } from "oxlint/plugins-dev";

import { noRawDesignValueRule } from "./no-raw-design-value.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
});
const COMPONENT = "/repo/tools/kb/packages/app/ui/src/components/outline/row.tsx";
const LIB = "/repo/tools/kb/packages/app/ui/src/lib/tag-color.ts";

const at = (messageId: string) => ({ messageId });

tester.run("design-tokens/no-raw-design-value", noRawDesignValueRule, {
  valid: [
    { code: `const c = "text-label font-medium text-foreground/50";`, filename: COMPONENT },
    {
      code: `const c = <div className="text-meta leading-4 shadow-overlay rounded-xs" />;`,
      filename: COMPONENT,
    },
    {
      code: 'const c = `hover:shadow-raised ${open ? "rounded-md" : "rounded-full"}`;',
      filename: COMPONENT,
    },
    {
      code: `const c = "shadow-none transition-shadow bg-scrim/30 bg-knob text-warning";`,
      filename: COMPONENT,
    },
    { code: `const c = "leading-[1.4] min-w-[200px] text-left";`, filename: COMPONENT },
    // An arbitrary colour is not a size.
    { code: `const c = "text-[color:var(--x)] text-(color:--x) text-(--x)";`, filename: COMPONENT },
    // Liveness is not this rule's question: reset defaults are the harness's.
    {
      code: `const c = "text-sm text-sm/6 shadow shadow-xl rounded rounded-3xl";`,
      filename: COMPONENT,
    },
    // Colour data outside components (the tag-colour hash) is not UI styling.
    { code: `const PALETTE = ["#ef4444", "#f97316"];`, filename: LIB },
    // A '#' that is not a colour: tag text, anchors.
    { code: `const t = "#todo and #gap"; const h = "#section-2";`, filename: COMPONENT },
  ],
  invalid: [
    {
      name: "untyped arbitrary font sizes: length, calc, percentage",
      code: `const c = "px-2 text-[11px] text-[0.8rem] text-[calc(1em+2px)] text-[120%]";`,
      filename: COMPONENT,
      errors: Array.from({ length: 4 }, () => at("arbitraryTextSize")),
    },
    {
      name: "arbitrary font size behind variants, in JSX",
      code: `const c = <span className="md:hover:text-[0.8rem]" />;`,
      filename: COMPONENT,
      errors: [at("arbitraryTextSize")],
    },
    {
      name: "size keywords: absolute-size and relative-size",
      code: `const c = "text-[large] text-[smaller] text-[xx-large]";`,
      filename: COMPONENT,
      errors: Array.from({ length: 3 }, () => at("arbitraryTextSize")),
    },
    {
      name: "arbitrary font sizes carrying a leading modifier",
      code: `const c = "text-[large]/5 text-[xx-large]/6 text-[large]/[1.4] text-[medium]/none text-[11px]/5 text-[length:11px]/6";`,
      filename: COMPONENT,
      errors: Array.from({ length: 6 }, () => at("arbitraryTextSize")),
    },
    {
      name: "shadow families carrying an opacity modifier",
      code: `const c = "drop-shadow/50 shadow-[0_1px_red]/20";`,
      filename: COMPONENT,
      errors: [at("rawShadow"), at("rawShadow")],
    },
    {
      name: "typed arbitrary font sizes, bracket and paren forms",
      code: `const c = "text-[length:11px] text-(length:--size) text-[absolute-size:large] text-(percentage:--x) text-[relative-size:larger]";`,
      filename: COMPONENT,
      errors: Array.from({ length: 5 }, () => at("arbitraryTextSize")),
    },
    {
      name: "arbitrary shadows and the shadow families the bridge does not own",
      code: "const c = `shadow-[0_0_2px_red] dark:shadow-(--x) drop-shadow-lg inset-shadow-sm text-shadow-xs`;",
      filename: COMPONENT,
      errors: Array.from({ length: 5 }, () => at("rawShadow")),
    },
    {
      name: "arbitrary radii",
      code: `const c = "rounded-[5px] rounded-t-[2px] rounded-(--r)";`,
      filename: COMPONENT,
      errors: Array.from({ length: 3 }, () => at("rawRadius")),
    },
    {
      name: "Tailwind palette colours",
      code: `const c = "bg-amber-500/10 text-white dark:text-amber-400";`,
      filename: COMPONENT,
      errors: [at("paletteColor"), at("paletteColor"), at("paletteColor")],
    },
    {
      name: "palette colours are not UI styling anywhere, including lib",
      code: `const c = "bg-black/30";`,
      filename: LIB,
      errors: [at("paletteColor")],
    },
    {
      name: "hex colour literal and arbitrary hex class in a component",
      code: `const f = "#222"; const c = "bg-[#123456]";`,
      filename: COMPONENT,
      errors: [at("hexColor"), at("hexColor")],
    },
  ],
});
