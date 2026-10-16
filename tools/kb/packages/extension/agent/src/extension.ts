/**
 * The agent family's declaration (DESIGN.md → Extension families): the one
 * home of its name and its seed. The bridge plugin, the channel the page
 * opens and the page's agent plugin all read it, and its `family:` tag is
 * checked against it. It is optional and on by default: `kb ui` hosts it
 * while its store has it on, and a person switches it off like any other
 * family. Its code is composed by `kb ui` alone, but its seed (the provider
 * kind, its fields and the adapter options) is in the bundled fold, so every
 * store holds the nodes a provider is written with, whatever process opens it.
 */
import { defineExtension } from "@kb/contracts";
import { agentSeedNodes } from "./provider.ts";

export const agentExtension = defineExtension({
  name: "agent",
  label: "Agent",
  optional: { byDefault: "on" },
  seed: agentSeedNodes,
});
