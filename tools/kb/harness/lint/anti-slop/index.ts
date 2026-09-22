import { eslintCompatPlugin } from "@oxlint/plugins";
import { noReduceAccumulatorCopyRule } from "./rules/no-reduce-accumulator-copy.ts";
import { noReflectApplyRule } from "./rules/no-reflect-apply.ts";
import { noReflectGetRule } from "./rules/no-reflect-get.ts";

/** The generic anti-slop rules kb adopted; see UPSTREAM.md for which and why. */
const antiSlopPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-reduce-accumulator-copy": noReduceAccumulatorCopyRule,
    "no-reflect-apply": noReflectApplyRule,
    "no-reflect-get": noReflectGetRule,
  },
});

export default antiSlopPlugin;
