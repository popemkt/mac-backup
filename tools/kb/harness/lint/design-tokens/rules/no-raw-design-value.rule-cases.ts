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
    // An arbitrary colour is not a size; rounded-full and scale steps are fine.
    {
      code: `const c = "text-[color:var(--x)] rounded-full rounded-t-md rounded-2xl";`,
      filename: COMPONENT,
    },
    // Colour data outside components (the tag-colour hash) is not UI styling.
    { code: `const PALETTE = ["#ef4444", "#f97316"];`, filename: LIB },
    // A '#' that is not a colour: tag text, anchors.
    { code: `const t = "#todo and #gap"; const h = "#section-2";`, filename: COMPONENT },
  ],
  invalid: [
    {
      name: "arbitrary font size",
      code: `const c = "px-2 text-[11px]";`,
      filename: COMPONENT,
      errors: [at("arbitraryTextSize")],
    },
    {
      name: "arbitrary font size behind variants, in JSX",
      code: `const c = <span className="md:hover:text-[0.8rem]" />;`,
      filename: COMPONENT,
      errors: [at("arbitraryTextSize")],
    },
    {
      name: "Tailwind shadow scale and bare shadow",
      code: "const c = `shadow ${x} shadow-xl dark:shadow-[0_0_2px_red]`;",
      filename: COMPONENT,
      errors: [at("rawShadow"), at("rawShadow"), at("rawShadow")],
    },
    {
      name: "typed arbitrary font sizes",
      code: `const c = "text-[length:11px] text-(length:--size)";`,
      filename: COMPONENT,
      errors: [at("arbitraryTextSize"), at("arbitraryTextSize")],
    },
    {
      name: "Tailwind default type steps, reset by the bridge",
      code: `const c = "text-xs sm:text-sm text-base text-lg text-xl text-2xl";`,
      filename: COMPONENT,
      errors: Array.from({ length: 6 }, () => at("arbitraryTextSize")),
    },
    {
      name: "bare rounded and arbitrary radii",
      code: `const c = "rounded border rounded-[5px] rounded-t-[2px] rounded-l";`,
      filename: COMPONENT,
      errors: [at("rawRadius"), at("rawRadius"), at("rawRadius"), at("rawRadius")],
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
