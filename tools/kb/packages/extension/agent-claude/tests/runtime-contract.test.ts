/**
 * The Claude adapter keeps the agent runtime contract, over a fake `query`
 * that plays the model through the adapter's own tool server.
 */
import { describe, expect, test } from "bun:test";
import { agentRuntimeContract } from "@kb/agent";
import { claudeRuntime } from "../src/claude.ts";
import { fakeClaude } from "./fake-query.ts";

agentRuntimeContract(
  {
    name: "claude-agent-sdk",
    runtime: (model) => claudeRuntime({ cwd: "/", executable: "claude", query: fakeClaude(model) }),
  },
  { describe, test, same: (observed, expected) => expect(observed).toEqual(expected) },
);
