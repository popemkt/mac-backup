/**
 * What a provider's settings become for Claude Code: its model and binary as
 * options, its endpoint as `ANTHROPIC_BASE_URL`, and its credential resolved
 * when the turn starts and handed over as `ANTHROPIC_API_KEY`. Claude Code's
 * environment is explicit: the one kb gives an agent runtime (what it holds
 * is `childProcessEnv("agent")`'s, tested with it), with the person's own
 * Claude login only while the provider names neither an endpoint nor a key.
 */
import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
/** The environment kb gives an agent runtime: a runtime path and the person's login. */
const INHERITED = {
  PATH: "/usr/bin",
  HOME: "/home/me",
  ANTHROPIC_API_KEY: "sk-login",
  ANTHROPIC_BASE_URL: "https://gateway.example",
};

function startedWith(
  provider: ProviderConfig,
  secrets: SecretSource = SECRETS,
  { cwd = "/kb", env = INHERITED }: { cwd?: string; env?: typeof INHERITED } = {},
) {
  const seen: Options[] = [];
  const query: ClaudeQuery = ({ options }) => {
    seen.push(options);
    return (async function* () {})();
  };
  const runtime = claudeAdapter({ cwd, query, env }).runtime(provider, secrets);
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
  test("a provider with nothing written runs the person's own login", async () => {
    const { options } = await startedWith({ ...DEFAULT_PROVIDER, executable: "claude" });
    expect(options?.env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/me",
      ANTHROPIC_API_KEY: "sk-login",
      ANTHROPIC_BASE_URL: "https://gateway.example",
    });
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
    // Exactly what the provider names: none of the person's login.
    expect(options?.env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/me",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:8317",
      ANTHROPIC_API_KEY: "sk-proxy",
    });
  });

  test("an endpoint without a key never carries the person's login there", async () => {
    const { options } = await startedWith({ ...DEFAULT_PROVIDER, endpoint: "https://elsewhere" });
    expect(options?.env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/me",
      ANTHROPIC_BASE_URL: "https://elsewhere",
    });
  });

  test("a key without an endpoint goes to Claude's own default, not the inherited gateway", async () => {
    const { options } = await startedWith({ ...DEFAULT_PROVIDER, credential: "env:PROXY_KEY" });
    expect(options?.env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/me",
      ANTHROPIC_API_KEY: "sk-proxy",
    });
  });

  test("a credential that does not resolve fails the turn before Claude Code starts", async () => {
    const { failure, options } = await startedWith(
      { ...DEFAULT_PROVIDER, credential: "env:PROXY_KEY" },
      NO_SECRETS,
    );
    expect(options).toBeUndefined();
    expect(failure).toBe("the environment variable PROXY_KEY: this process reads no keys");
  });

  test("a claude the person's PATH finds inside the root never runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-claude-root-"));
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "claude"), "#!/bin/sh\n");
    await chmod(join(bin, "claude"), 0o755);
    try {
      const env = { ...INHERITED, PATH: `${bin}:/usr/bin` };
      const { failure, options } = await startedWith(DEFAULT_PROVIDER, SECRETS, { cwd: root, env });
      expect(options).toBeUndefined();
      expect(failure).toContain("The claude on PATH is inside this root");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
