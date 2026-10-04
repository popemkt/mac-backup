/**
 * The code family's declaration and its shared plugin (DESIGN.md →
 * Extension families). The declaration is the one home of the family's
 * name, seed and views; the bundled seed folds it, and both hosts load
 * {@link codePlugin}, so the key, the seed and the text cannot differ
 * between them. The family has no server-only package: its figure asks the
 * host's core references for an engine and an invoke core, and only the
 * runtime binds them, so on the page it draws the text alone. It is optional
 * and on by default.
 */
import { declarationPlugin, defineExtension, viewDef } from "@kb/contracts";
import type { Plugin } from "@kb/plugin";
import { codeSeedNodes } from "./seed.ts";
import { codeText } from "./text.ts";
import { CodeView } from "./view.ts";

export const codeExtension = defineExtension({
  name: "code",
  label: "Code",
  optional: { byDefault: "on" },
  seed: codeSeedNodes,
  views: [viewDef(CodeView, codeText)],
});

/**
 * The code family's shared plugin: its declaration's views, text included.
 * It is the server's entry as it is, and the page's entry loads it as a
 * child.
 */
export function codePlugin(): Plugin {
  return declarationPlugin(codeExtension);
}
