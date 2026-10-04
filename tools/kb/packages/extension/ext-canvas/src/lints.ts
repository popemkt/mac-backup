/** The shape every canvas write's receipt gives its lints in (`lintDiff` in `@kb/canvas`). */
import { z } from "zod";
import { CANVAS_LINT_RULES } from "@kb/canvas";

export const LintSchema = z.object({
  rule: z.enum(CANVAS_LINT_RULES),
  /** The items or edges the lint is about. */
  ids: z.array(z.string()).readonly(),
  message: z.string(),
});

/** What a write did to the canvas's lints: the ones it made, and the ones it cleared. */
export const LintDiffSchema = z.object({
  new: z.array(LintSchema).readonly(),
  resolved: z.array(LintSchema).readonly(),
});
