/**
 * The `openai-chat` adapter keeps the agent runtime contract, over a fake
 * Chat Completions endpoint that plays the model through the adapter's own
 * request bodies and server-sent events.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_PROVIDER, agentRuntimeContract } from "@kb/agent";
import { NO_SECRETS } from "@kb/contracts";
import { openAiChatAdapter } from "../src/index.ts";
import { fakeChat } from "./fake-chat.ts";

agentRuntimeContract(
  {
    name: "openai-chat",
    runtime: (model) =>
      openAiChatAdapter({ fetch: fakeChat(model).fetch }).runtime(
        {
          ...DEFAULT_PROVIDER,
          adapter: "openai-chat",
          endpoint: "http://127.0.0.1:8317/v1",
          model: "fake-model",
        },
        NO_SECRETS,
      ),
  },
  { describe, test, same: (observed, expected) => expect(observed).toEqual(expected) },
);
