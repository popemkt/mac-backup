import { eslintCompatPlugin } from "@oxlint/plugins";
import { noRawDesignValueRule } from "./rules/no-raw-design-value.ts";

/**
 * kb's own design-token rules: UI code names design-system steps, never raw
 * values. The token architecture they enforce is stated in
 * `tools/kb/DESIGN-UI.md` → Design tokens.
 */
const designTokensPlugin = eslintCompatPlugin({
  meta: { name: "design-tokens" },
  rules: {
    "no-raw-design-value": noRawDesignValueRule,
  },
});

export default designTokensPlugin;
