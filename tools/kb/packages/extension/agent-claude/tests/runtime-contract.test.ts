/**
 * The Claude adapter keeps the agent runtime contract, over a fake `query`
 * that plays the model through the adapter's own tool server.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_PROVIDER, agentRuntimeContract } from "@kb/agent";
import { NO_SECRETS } from "@kb/contracts";
import { claudeAdapter } from "../src/claude.ts";
import { fakeClaude } from "./fake-query.ts";

agentRuntimeContract(
  {
    name: "claude-agent-sdk",
    runtime: (model) =>
      claudeAdapter({ cwd: "/", query: fakeClaude(model), env: {} }).runtime(
        { ...DEFAULT_PROVIDER, executable: "claude" },
        NO_SECRETS,
      ),
  },
  { describe, test, same: (observed, expected) => expect(observed).toEqual(expected) },
);
