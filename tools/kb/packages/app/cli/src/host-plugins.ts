/**
 * The extensions `kb ui` hosts: the sidebar agent, over the person's local
 * Claude. This file is the CLI's composition root for extensions, the one
 * file of this package that may import an extension package
 * (`EXTENSION_ROOTS` in `harness/src/constraints.ts`); the server names none
 * (DESIGN.md → Plugin channels). Each is handed over with its declaration,
 * so the server reports it in `kb.manifest` beside the registry's. They load
 * on demand, so no other command pays for the agent packages.
 *
 * A second switch beside the browser's preference: GAP [[01M41H30N0SV4QE5R8VQQ1K4ZA]]
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
