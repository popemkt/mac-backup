/**
 * The agent family's declaration (DESIGN.md → Extension families): the one
 * home of its name. The bridge plugin, the channel the page opens and the
 * page's agent plugin all read it, and its `family:` tag is checked against
 * it. It is optional and on by default: `kb ui` hosts it while its store has
 * it on, and a person switches it off like any other family.
 */
import { defineExtension } from "@kb/contracts";

export const agentExtension = defineExtension({
  name: "agent",
  label: "Agent",
  optional: { byDefault: "on" },
});
