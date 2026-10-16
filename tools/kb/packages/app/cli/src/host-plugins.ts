/**
 * The extensions `kb ui` hosts: the sidebar agent, over the adapters this
 * host implements. This file is the CLI's composition root for extensions,
 * the one file of this package that may import an extension package
 * (`EXTENSION_ROOTS` in `harness/src/constraints.ts`); the server names none
 * (DESIGN.md → Plugin channels). Each is handed over with its declaration:
 * the server composes it while its store has it on (`familyOn`, the switch
 * every family has, written by `extension.switch`) and reports it in
 * `kb.manifest` beside the registry's, and the page offers the agent only
 * while it is reported on. They load on demand, so no other command pays
 * for the agent packages. A key a provider refers to is read from this
 * process's environment or the platform keychain (`systemSecrets`).
 */
import { Effect } from "effect";
import type { AgentAdapter } from "@kb/agent";
import type { ExtensionEntry } from "@kb/contracts";
import { systemSecrets } from "@kb/runtime";

/** The adapter for each of `AGENT_ADAPTERS`, running in `root`; the test holds it to every one. */
export const hostAgentAdapters = Effect.fn("kb.cli.hostAgentAdapters")(function* (
  root: string,
): Effect.fn.Return<readonly AgentAdapter[]> {
  const { claudeAdapter } = yield* Effect.promise(() => import("@kb/agent-claude"));
  return [claudeAdapter({ cwd: root })];
});

export const hostExtensions = Effect.fn("kb.cli.hostExtensions")(function* (
  root: string,
): Effect.fn.Return<readonly ExtensionEntry[]> {
  const { agentExtension, agentPlugin } = yield* Effect.promise(() => import("@kb/agent"));
  const adapters = yield* hostAgentAdapters(root);
  return [
    {
      declaration: agentExtension,
      entry: agentPlugin({ adapters, secrets: systemSecrets() }),
    },
  ];
});
