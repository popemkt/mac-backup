// The composer's pi extension against a fake pi: what it filters, what it reports, where. Run: npm test
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import composer, { reportName } from "../pi/extension.ts";

type Handler = (event: any, ctx: any) => unknown;

function fakePi(tools: string[], mcp: string[] = []) {
  const handlers = new Map<string, Handler>();
  let active = [...tools];
  const unregistered: string[] = [];
  return {
    pi: {
      on: (event: string, h: Handler) => void handlers.set(event, h),
      getActiveTools: () => active,
      setActiveTools: (names: string[]) => void (active = names),
      unregisterMcpServer: (name: string) => {
        if (!mcp.includes(name)) throw new Error("not mine");
        unregistered.push(name);
      },
    },
    fire: (event: string, e: unknown, ctx?: unknown) => handlers.get(event)?.(e, ctx),
    unregistered,
    active: () => active,
  };
}

function withEnv(env: Record<string, string | undefined>, run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "composer-pi-"));
  const saved = { ...process.env };
  Object.assign(process.env, { PI_COMPOSER_REPORT_DIR: dir });
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
  try {
    run(dir);
  } finally {
    process.env = saved;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("filters skills by name, context files by exact path, tools and MCP servers; reports per thread", () => {
  const manifest = { skills: ["tdd"], tools: ["bash"], mcpServers: ["notion", "elsewhere"], contextFiles: ["/w/AGENTS.md"] };
  withEnv({ PI_COMPOSER_MANIFEST: JSON.stringify(manifest), BB_THREAD_ID: "thr_abc-1" }, dir => {
    const f = fakePi(["read", "bash", "edit"], ["notion"]);
    composer(f.pi);
    f.fire("session_start", {});
    assert.deepEqual(f.unregistered, ["notion"]);
    const options = {
      skills: [{ name: "tdd" }, { name: "simplify" }],
      // Same file name in another directory: kept, because paths match exactly.
      contextFiles: [{ path: "/w/AGENTS.md" }, { path: "/w/sub/AGENTS.md" }],
    };
    f.fire("before_agent_start", { systemPromptOptions: options }, { getSystemPrompt: () => "abc" });
    assert.deepEqual(options.skills, [{ name: "simplify" }]);
    assert.deepEqual(options.contextFiles, [{ path: "/w/sub/AGENTS.md" }]);
    assert.deepEqual(f.active(), ["read", "edit"]);
    f.fire("before_provider_request", { payload: { tools: [{ name: "read" }, { function: { name: "edit" } }] } });
    const report = JSON.parse(readFileSync(join(dir, "thr_abc-1.json"), "utf8"));
    assert.equal(report.threadId, "thr_abc-1");
    assert.deepEqual(report.mcpKept, ["elsewhere"]);
    assert.equal(report.start.systemPromptChars, 3);
    assert.deepEqual(report.requests[0].tools, ["read", "edit"]);
  });
});

test("no manifest: nothing is filtered, and a report is still written", () => {
  withEnv({ PI_COMPOSER_MANIFEST: undefined, BB_THREAD_ID: "thr_1" }, dir => {
    const f = fakePi(["read"]);
    composer(f.pi);
    const options = { skills: [{ name: "tdd" }] };
    f.fire("before_agent_start", { systemPromptOptions: options });
    assert.deepEqual(options.skills, [{ name: "tdd" }]);
    assert.deepEqual(readdirSync(dir), ["thr_1.json"]);
  });
});

test("a thread id that is not a plain id never becomes part of the report path", () => {
  assert.equal(reportName("thr_5kgr5arqw3", 7), "thr_5kgr5arqw3");
  for (const bad of ["../../etc/x", "a/b", "", "a b", "x".repeat(200)]) assert.equal(reportName(bad, 7), "pid-7", bad);
  assert.equal(reportName(undefined, 7), "pid-7");
  withEnv({ PI_COMPOSER_MANIFEST: undefined, BB_THREAD_ID: "../escape" }, dir => {
    const f = fakePi([]);
    composer(f.pi);
    f.fire("before_agent_start", { systemPromptOptions: {} });
    assert.deepEqual(readdirSync(dir), [`pid-${process.pid}.json`]);
    assert.equal(JSON.parse(readFileSync(join(dir, `pid-${process.pid}.json`), "utf8")).threadId, null);
  });
});
