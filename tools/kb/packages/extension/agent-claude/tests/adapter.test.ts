/**
 * What a provider's settings become for Claude Code: its model and binary as
 * options, its endpoint as `ANTHROPIC_BASE_URL`, and its credential resolved
 * when the turn starts and handed over as `ANTHROPIC_API_KEY`. A provider
 * with nothing written leaves Claude Code's environment alone, so it runs
 * under the person's own login.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Stream } from "effect";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { DEFAULT_PROVIDER, type ProviderConfig } from "@kb/agent";
import { NO_SECRETS, SecretError, type SecretSource } from "@kb/contracts";
import { claudeAdapter, type ClaudeQuery } from "../src/index.ts";

const SECRETS: SecretSource = {
  resolve: (ref) =>
    ref.kind === "env" && ref.name === "PROXY_KEY"
      ? Effect.succeed("sk-proxy")
      : Effect.fail(new SecretError({ message: "the environment variable is not set" })),
};

/**
 * Run one turn of `provider`: the options Claude Code was started with, if it
 * was, and the turn's failure, if it failed.
 */
function startedWith(provider: ProviderConfig, secrets: SecretSource = SECRETS) {
  const seen: Options[] = [];
  const query: ClaudeQuery = ({ options }) => {
    seen.push(options);
    return (async function* () {})();
  };
  const runtime = claudeAdapter({ cwd: "/kb", query }).runtime(provider, secrets);
  const turn = runtime.turn({
    system: "",
    message: { text: "hi", screen: null },
    tools: [],
    resume: undefined,
    call: () => Effect.die("no calls"),
  });
  return Effect.runPromise(
    Stream.runDrain(turn).pipe(
      Effect.match({ onSuccess: () => undefined, onFailure: ({ message }) => message }),
    ),
  ).then((failure) => ({ failure, options: seen[0] }));
}

describe("the claude-agent-sdk adapter", () => {
  test("a provider with nothing written leaves the environment and the model to Claude Code", async () => {
    const { options } = await startedWith({ ...DEFAULT_PROVIDER, executable: "claude" });
    expect(options?.env).toBeUndefined();
    expect(options?.model).toBeUndefined();
    expect(options?.pathToClaudeCodeExecutable).toBe("claude");
  });

  test("its model, binary, endpoint and resolved key reach Claude Code", async () => {
    const { options } = await startedWith({
      adapter: "claude-agent-sdk",
      model: "sonnet",
      executable: "/opt/claude",
      endpoint: "http://127.0.0.1:8317",
      credential: "env:PROXY_KEY",
    });
    expect(options?.model).toBe("sonnet");
    expect(options?.pathToClaudeCodeExecutable).toBe("/opt/claude");
    expect(options?.env).toMatchObject({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:8317",
      ANTHROPIC_API_KEY: "sk-proxy",
    });
    // Laid over this process's environment, which the SDK would otherwise replace.
    expect(options?.env?.["PATH"]).toBe(Bun.env["PATH"]);
  });

  test("a credential that does not resolve fails the turn before Claude Code starts", async () => {
    const { failure, options } = await startedWith(
      { ...DEFAULT_PROVIDER, credential: "env:PROXY_KEY" },
      NO_SECRETS,
    );
    expect(options).toBeUndefined();
    expect(failure).toBe("the environment variable PROXY_KEY: this process reads no keys");
  });
});
