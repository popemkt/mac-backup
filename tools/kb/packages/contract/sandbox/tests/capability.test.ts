import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { succeeded, type ActionInvocation } from "@kb/contracts";
import type { KbNode } from "@kb/model";
import {
  ENGINE_LIMITS,
  SANDBOX_FRAME_CSP,
  answerToolCall,
  codeDigest,
  isCodeDigest,
  type CapabilityHost,
} from "../src/index.ts";

const LIMITS = ENGINE_LIMITS.quickjs;

function hostRecording(output: unknown = { ok: true }) {
  const calls: ActionInvocation[] = [];
  const nodes = new Map<string, KbNode>([
    ["s", { id: "s", text: "s", props: {}, children: [], createdAt: "", updatedAt: "" }],
  ]);
  const host: CapabilityHost = {
    invoke: (invocation) =>
      Effect.sync(() => {
        calls.push(invocation);
        return succeeded(invocation.id, output);
      }),
    node: (id) => nodes.get(id),
  };
  return { host, calls };
}

describe("a guest's tool call", () => {
  test("is made as the script's, with no approval, whatever the guest sends", async () => {
    const { host, calls } = hostRecording();
    const scope = { grant: { reads: "subject" as const, actions: ["node.update"] }, subject: "s" };
    const result = await Effect.runPromise(
      answerToolCall(host, scope, LIMITS, {
        name: "node.update",
        arguments: { id: "s", approved: true, actor: "human" },
      }),
    );
    expect(result.isError).toBeUndefined();
    expect(calls).toEqual([
      { id: "node.update", input: { id: "s", approved: true, actor: "human" }, actor: "script" },
    ]);
    expect(calls[0]?.approved).toBeUndefined();
  });

  test("outside its grant never reaches the invoke core", async () => {
    const { host, calls } = hostRecording();
    const scope = { grant: { reads: "subject" as const, actions: [] }, subject: "s" };
    const result = await Effect.runPromise(
      answerToolCall(host, scope, LIMITS, { name: "node.delete", arguments: { id: "s" } }),
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "")).toMatchObject({ code: "forbidden" });
    expect(calls).toEqual([]);
  });

  test("answers a result larger than its bound as a failure", async () => {
    const { host } = hostRecording({ rows: "x".repeat(LIMITS.maxResultChars + 1) });
    const scope = { grant: { reads: "graph" as const, actions: [] }, subject: null };
    const result = await Effect.runPromise(
      answerToolCall(host, scope, LIMITS, { name: "graph.query", arguments: { query: "[]" } }),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("ask for less");
  });
});

describe("a code digest", () => {
  test("covers every character of the code and the grant", async () => {
    const grant = { reads: "subject" as const, actions: [] };
    const base = await Effect.runPromise(codeDigest("kb.draw('a')", grant));
    expect(isCodeDigest(base)).toBe(true);
    expect(await Effect.runPromise(codeDigest("kb.draw('a')", grant))).toBe(base);
    expect(await Effect.runPromise(codeDigest("kb.draw('a') ", grant))).not.toBe(base);
    expect(
      await Effect.runPromise(codeDigest("kb.draw('a')", { ...grant, actions: ["node.add"] })),
    ).not.toBe(base);
    expect(
      await Effect.runPromise(codeDigest("kb.draw('a')", { reads: "graph", actions: [] })),
    ).not.toBe(base);
  });
});

describe("the frame's policy", () => {
  test("connects nowhere, loads nothing, and runs only kb's script and WebAssembly", () => {
    const directives = new Map(
      SANDBOX_FRAME_CSP.split(";").map((part) => {
        const [name = "", ...values] = part.trim().split(/\s+/);
        return [name, values.join(" ")];
      }),
    );
    expect(directives.get("sandbox")).toBe("allow-scripts");
    expect(directives.get("default-src")).toBe("'none'");
    expect(directives.get("connect-src")).toBe("'none'");
    expect(directives.get("img-src")).toBe("'none'");
    expect(directives.get("font-src")).toBe("'none'");
    expect(directives.get("form-action")).toBe("'none'");
    expect(directives.get("script-src")).toBe("'self' 'wasm-unsafe-eval'");
    expect(directives.get("worker-src")).toBe("blob:");
    expect(SANDBOX_FRAME_CSP).not.toContain(" 'unsafe-eval'");
    expect(SANDBOX_FRAME_CSP.match(/'unsafe-inline'/g)).toHaveLength(1);
  });
});
