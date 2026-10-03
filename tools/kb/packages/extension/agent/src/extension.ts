/**
 * The agent family's declaration (DESIGN.md → Extension families): the one
 * home of its name. The bridge plugin, the channel the page opens and the
 * page's agent plugin all read it, and its `family:` tag is checked against
 * it.
 */
import { defineExtension } from "@kb/contracts";

export const agentExtension = defineExtension({ name: "agent", label: "Agent" });
