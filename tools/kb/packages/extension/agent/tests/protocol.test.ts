import { expect, test } from "bun:test";
import { AGENT_CHANNEL, agentExtension } from "../src/index.ts";

// The channel id is wire protocol: a page and a server of different builds
// must still meet on it. It is derived from the family's declared name, so a
// rename of the declaration would silently rename the channel; this pins it.
test("the agent's channel is agent.chat on the wire", () => {
  expect(agentExtension.name).toBe("agent");
  expect(AGENT_CHANNEL).toBe("agent.chat");
});
