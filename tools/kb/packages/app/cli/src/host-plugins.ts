/**
 * The plugins `kb ui` hosts: the sidebar agent, over the person's local
 * Claude. This file is the CLI's composition root for extensions, the one
 * file of this package that may import an extension package
 * (`EXTENSION_ROOTS` in `harness/src/constraints.ts`); the server names none
 * (DESIGN.md → Plugin channels). They load on demand, so no other command
 * pays for the agent packages.
 *
 * A second switch beside the browser's preference: GAP [[01M41H30N0SV4QE5R8VQQ1K4ZA]]
 */
import { Effect } from "effect";

export const hostPlugins = Effect.fn("kb.cli.hostPlugins")(function* (root: string) {
  const [{ agentPlugin }, { claudeRuntime }] = yield* Effect.promise(() =>
    Promise.all([import("@kb/agent"), import("@kb/agent-claude")]),
  );
  return [agentPlugin({ runtime: claudeRuntime({ cwd: root }) })];
});
