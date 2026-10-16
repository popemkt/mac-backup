/**
 * What the `openai-chat` adapter puts on the wire beyond the contract's
 * properties: the request a step sends (the URL under the provider's
 * endpoint, the model, the tools as functions, a bearer token only when a
 * credential resolves), how a call is echoed back in the next step, and how
 * a provider that lacks an endpoint or a model, a failed response and an
 * error event each end the turn.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Stream } from "effect";
import { DEFAULT_PROVIDER, userTurnText, type ModelDouble, type ProviderConfig } from "@kb/agent";
import {
  NO_SECRETS,
  SecretError,
  succeeded,
  type ManifestEntry,
  type SecretSource,
} from "@kb/contracts";
import { openAiChatAdapter, type ChatFetch } from "../src/index.ts";
import { fakeChat } from "./fake-chat.ts";

const GET: ManifestEntry = {
  id: "node.get",
  title: "Get node",
  description: "Read a node.",
  mode: { kind: "read" },
  inputSchema: { type: "object", properties: { id: { type: "string" } } },
  outputSchema: {},
};

const PROVIDER: ProviderConfig = {
  ...DEFAULT_PROVIDER,
  adapter: "openai-chat",
  endpoint: "http://127.0.0.1:8317/v1/",
  model: "deepseek-v4-flash",
};

const SECRETS: SecretSource = {
  resolve: (ref) =>
    ref.kind === "env" && ref.name === "PROXY_KEY"
      ? Effect.succeed("sk-proxy")
      : Effect.fail(new SecretError({ message: "not set" })),
};

/** Run one turn over `fetch`; its text, or the failure's message, and the calls it made. */
function turnOver(
  fetch: ChatFetch,
  provider: ProviderConfig = PROVIDER,
  secrets: SecretSource = NO_SECRETS,
) {
  const calls: { readonly action: string; readonly input: unknown }[] = [];
  const runtime = openAiChatAdapter({ fetch }).runtime(provider, secrets);
  const turn = runtime.turn({
    system: "You are kb's agent.",
    message: { text: "hi", screen: null },
    tools: [GET],
    resume: undefined,
    call: (action, input) =>
      Effect.sync(() => {
        calls.push({ action, input });
        return succeeded(action, { node: { id: "n.a", text: "A" } });
      }),
  });
  return Effect.runPromise(
    Stream.runCollect(turn).pipe(
      Effect.match({
        onSuccess: (outputs) => ({
          text: outputs
            .flatMap((output) => (output.kind === "text" ? [output.delta] : []))
            .join(""),
        }),
        onFailure: ({ message }) => ({ failure: message }),
      }),
    ),
  ).then((ended) => ({ ...ended, calls }));
}

const callsOnce: ModelDouble = ({ step }) =>
  step === 1 ? [{ call: "node_get", input: { id: "n.a" } }] : [{ say: "Done." }];

/** An endpoint that refuses the request. */
const refusing: ChatFetch = () => Promise.resolve(new Response("no such model", { status: 404 }));

/** An endpoint that starts a reply, then reports an error event. */
const erring: ChatFetch = () =>
  Promise.resolve(
    new Response(
      'data: {"choices":[{"delta":{"content":"par"}}]}\n\ndata: {"error":{"message":"quota exhausted"}}\n\n',
      { status: 200 },
    ),
  );

describe("the openai-chat adapter's wire", () => {
  test("a step posts the conversation and the tools, as functions, under the endpoint", async () => {
    const chat = fakeChat(() => [{ say: "Hello." }]);
    expect(await turnOver(chat.fetch)).toMatchObject({ text: "Hello." });
    const [request] = chat.requests;
    expect(request?.url).toBe("http://127.0.0.1:8317/v1/chat/completions");
    expect(request?.init.headers).not.toHaveProperty("authorization");
    expect(request?.body).toMatchObject({
      model: "deepseek-v4-flash",
      stream: true,
      messages: [
        { role: "system", content: "You are kb's agent." },
        // The message as every runtime sends it, its screen block first (`userTurnText`).
        { role: "user", content: userTurnText({ text: "hi", screen: null }) },
      ],
      tools: [
        {
          type: "function",
          function: { name: "node_get", description: "Read a node.", parameters: GET.inputSchema },
        },
      ],
    });
  });

  test("a call is echoed back with its id, and its receipt answers it", async () => {
    const chat = fakeChat(callsOnce);
    expect(await turnOver(chat.fetch)).toMatchObject({
      text: "Done.",
      calls: [{ action: "node.get", input: { id: "n.a" } }],
    });
    expect(chat.requests[1]?.body.messages.slice(2)).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "node_get", arguments: JSON.stringify({ id: "n.a" }) },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: expect.stringContaining("n.a") },
    ]);
  });

  test("a credential that resolves is sent as a bearer token", async () => {
    const chat = fakeChat(() => [{ say: "ok" }]);
    await turnOver(chat.fetch, { ...PROVIDER, credential: "env:PROXY_KEY" }, SECRETS);
    expect(chat.requests[0]?.init.headers).toMatchObject({ authorization: "Bearer sk-proxy" });
  });

  test("a provider with no endpoint, or no model, fails the turn saying which", async () => {
    const chat = fakeChat(() => [{ say: "never" }]);
    expect(await turnOver(chat.fetch, { ...PROVIDER, endpoint: null })).toMatchObject({
      failure: "An OpenAI-compatible provider needs an endpoint; write it on the provider's node.",
    });
    expect(await turnOver(chat.fetch, { ...PROVIDER, model: null })).toMatchObject({
      failure: "An OpenAI-compatible provider needs a model; write it on the provider's node.",
    });
    expect(chat.requests).toEqual([]);
  });

  test("a failed response fails the turn with its status and what it said", async () => {
    expect(await turnOver(refusing)).toMatchObject({
      failure: "http://127.0.0.1:8317/v1/chat/completions answered 404: no such model",
    });
  });

  test("an error event mid-stream fails the turn with its message", async () => {
    expect(await turnOver(erring)).toMatchObject({ failure: "quota exhausted" });
  });
});
