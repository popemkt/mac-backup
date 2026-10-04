/**
 * The extensions `kb ui` hosts: the sidebar agent, over the person's local
 * Claude. This file is the CLI's composition root for extensions, the one
 * file of this package that may import an extension package
 * (`EXTENSION_ROOTS` in `harness/src/constraints.ts`); the server names none
 * (DESIGN.md → Plugin channels). Each is handed over with its declaration:
 * the server composes it while its store has it on (`familyOn`, the switch
 * every family has, written by `extension.switch`) and reports it in
 * `kb.manifest` beside the registry's, and the page offers the agent only
 * while it is reported on. They load on demand, so no other command pays
 * for the agent packages.
 */
import { Effect } from "effect";
import type { ExtensionEntry } from "@kb/contracts";

export const hostExtensions = Effect.fn("kb.cli.hostExtensions")(function* (
  root: string,
): Effect.fn.Return<readonly ExtensionEntry[]> {
  const [{ agentExtension, agentPlugin }, { claudeRuntime }] = yield* Effect.promise(() =>
    Promise.all([import("@kb/agent"), import("@kb/agent-claude")]),
  );
  return [
    {
      declaration: agentExtension,
      entry: agentPlugin({ runtime: claudeRuntime({ cwd: root }) }),
    },
  ];
});
