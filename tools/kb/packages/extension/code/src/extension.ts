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
import { Effect } from "effect";
import { declarationPlugin, defineExtension, extensionPlugin, viewDef } from "@kb/contracts";
import { definePlugin, type Plugin } from "@kb/plugin";
import { SCRIPT_LIST } from "./list.ts";
import { SCRIPT_RUN } from "./run.ts";
import { codeSeedNodes } from "./seed.ts";
import { codeText } from "./text.ts";
import { CodeView } from "./view.ts";

export const codeExtension = defineExtension({
  name: "code",
  label: "Code",
  optional: { byDefault: "on" },
  seed: codeSeedNodes,
  views: [viewDef(CodeView, codeText)],
  // A run is a person's act or an agent's: code never starts one, so it
  // cannot chain runs that each ask the person again.
  policies: [
    {
      id: "approval.script-run",
      text: "Sandboxed code never starts a script run",
      match: "ext.code.script.run",
      actor: "script",
      decision: "deny",
    },
  ],
});

/** The family's actions, `ext.code.*`: running a script once. */
const codeActions = extensionPlugin({
  name: codeExtension.name,
  actions: [SCRIPT_LIST, SCRIPT_RUN],
  templates: [],
});

/**
 * The code family's shared plugin: its actions, and its declaration's
 * views, text included. It is the server's entry as it is, and the page's
 * entry loads it as a child; the page sends its actions to the server,
 * where code runs.
 */
export function codePlugin(): Plugin {
  return definePlugin({
    ...codeActions,
    apply: (ctx) =>
      Effect.all([codeActions.apply(ctx), ctx.plugin(declarationPlugin(codeExtension))], {
        discard: true,
      }),
  });
}
