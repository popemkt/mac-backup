// The sandbox plugin (docs/research/2026-10-31-sandboxes.md §9–§10): isolated, resource-capped
// sandboxes behind one provider contract, an admission queue that keeps the host under its budget,
// and AgentSpec runs that fan agent work out through both.
//
// Everything is declared once in core/ops.ts and exposed three ways from it here: `bb sandbox …`
// commands, `sandbox_*` agent tools, and POST /op (token auth) for the SDK in sdk/index.ts. The
// host policy (budget, default provider, images, the cgroup slice) is /etc/bb-sandbox/policy.json,
// written by the `sandboxes` NixOS stack; without it the defaults apply, with no cgroup caps.
//
// The plugin runs in the bb server, and so do the sandboxes it starts: one host (the server's).
import { homedir } from "node:os";
import { join } from "node:path";
import { type BbPluginApi, type PluginCliCommand, PluginCliError, defineCli } from "@get-bb/plugin-sdk";
import { type ThreadsApi, createRunner } from "./core/agent/runner.ts";
import { type CliInput, OPS, type OpContext, invoke, opByName, readInputFlag, toolName } from "./core/ops.ts";
import { psi, readPolicy } from "./core/policy.ts";
import { createProviders } from "./core/providers/index.ts";
import { createService } from "./core/service.ts";

const STATE_ROOT = join(homedir(), ".local/state/bb-sandbox");
const SWEEP_MS = 15_000;

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default function plugin(bb: BbPluginApi): void {
  const settings = bb.settings.define({
    toolsForAllThreads: {
      type: "boolean",
      label: "Offer the sandbox_* tools to every thread (otherwise only to threads an agent run started)",
      default: false,
    },
  });
  let toolsForAll = false;
  void settings.get().then((s) => (toolsForAll = s.toolsForAllThreads));
  settings.onChange((next) => (toolsForAll = next.toolsForAllThreads));

  const policy = readPolicy();
  const service = createService({
    providers: createProviders(policy, STATE_ROOT),
    policy,
    store: bb.storage.kv,
    pressure: () => psi("cpu") > policy.pressure.cpu || psi("memory") > policy.pressure.memory,
  });
  const runner = createRunner({
    service,
    threads: bb.sdk.threads as unknown as ThreadsApi,
    store: bb.storage.kv,
    root: STATE_ROOT,
  });
  const context = (caller: OpContext["caller"], signal?: AbortSignal): OpContext => ({ service, runner, caller, signal });

  // Reconcile once, then sweep lifetimes and give a pressure-held queue another look.
  bb.background.service("sweep", {
    async start(signal) {
      await runner.reconcile();
      await service.reconcile();
      while (!signal.aborted) {
        await service.sweep().catch((error) => console.error(`sandbox sweep: ${message(error)}`));
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, SWEEP_MS);
          signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
        });
      }
    },
  });

  // CLI: one command per op.
  const commands: Record<string, PluginCliCommand> = {};
  for (const o of OPS) {
    commands[o.cli.path] = {
      summary: o.summary,
      options: {
        ...o.cli.options,
        input: { type: "string", description: "The whole input as JSON, or @file; flags override it" },
      },
      positionals: o.cli.positionals ?? [],
      passthrough: o.cli.passthrough ?? false,
      async run(cli, ctx) {
        let result: unknown;
        try {
          const base = await readInputFlag(cli.options.input as string | undefined, ctx.cwd);
          const input = { ...base, ...o.cli.toInput?.(cli as CliInput) };
          result = await invoke(o, input, context({ threadId: ctx.threadId, projectId: ctx.projectId, cwd: ctx.cwd }, ctx.signal));
        } catch (error) {
          throw new PluginCliError(message(error), { code: "sandbox_error" });
        }
        return o.cli.render?.(result) ?? { exitCode: 0, stdout: json(result) };
      },
    };
  }
  bb.cli.register(
    defineCli({
      name: "sandbox",
      summary: "Isolated, resource-capped sandboxes, a queue that keeps the host under budget, and AgentSpec runs",
      description: "Every command also takes its whole input as --input <json|@file>. The same ops are the sandbox_* agent tools and the SDK (sdk/index.ts).",
      commands,
    }),
  );

  // Agent tools: one per op, offered where configure says.
  for (const o of OPS) {
    bb.agents.registerTool({
      name: toolName(o.name),
      description: `${o.summary}. Same as \`bb sandbox ${o.cli.path}\`.`,
      parameters: o.input,
      async execute(params, ctx) {
        try {
          return json(await invoke(o, params, context({ threadId: ctx.threadId, projectId: ctx.projectId }, ctx.signal)));
        } catch (error) {
          return { content: [{ type: "text", text: message(error) }], isError: true };
        }
      },
    });
  }
  const tools = OPS.map((o) => toolName(o.name));
  bb.agents.configure(({ pluginMetadata }) => ({
    tools: toolsForAll || typeof pluginMetadata.sandboxId === "string" ? tools : [],
    skills: ["sandbox"],
  }));

  // HTTP for the SDK: POST /op {op, input, caller}.
  bb.http.route(
    "POST",
    "/op",
    async (c) => {
      let body: { op?: string; input?: unknown; caller?: OpContext["caller"] };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ ok: false, error: "the body is not JSON" }, 400);
      }
      const o = body.op ? opByName(body.op) : undefined;
      if (!o) return c.json({ ok: false, error: `unknown op ${body.op}; known: ${OPS.map((x) => x.name).join(", ")}` }, 404);
      const caller = body.caller ?? {};
      try {
        const result = await invoke(o, body.input, context({ threadId: caller.threadId, projectId: caller.projectId, cwd: caller.cwd }, c.req.raw.signal));
        return c.json({ ok: true, result });
      } catch (error) {
        return c.json({ ok: false, error: message(error) }, 400);
      }
    },
    { auth: "token" },
  );
}
