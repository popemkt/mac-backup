// The composer's pi adapter, first slice (experimental). A pi extension that enforces a compiled manifest and reports
// what pi really sends. Install it by linking this file into ~/.pi/agent/extensions/ on the machine that runs pi; bb's
// pi provider does not pass --no-extensions, so pi loads it for bb threads too.
//
// In:  PI_COMPOSER_MANIFEST, JSON {"skills": [names], "tools": [names], "mcpServers": [names], "contextFiles": [paths]},
//      set per thread by the context-composer bb plugin through contributed env (core/targets.ts, bb:pi). Skills,
//      tools and MCP servers match by exact name, context files by exact path; the plugin sends a name only when no
//      kept artifact shares it, so a filter never removes something the manifest keeps.
// Out: $PI_COMPOSER_REPORT_DIR (default ~/.pi/agent/composer-reports)/<BB_THREAD_ID or pid>.json, the exact system
//      prompt size, skills and tools before and after filtering, and the serialized payload's size per request.
//
// Measured on pi 1.4.0 outside bb (docs/research/2026-10-25-context-composer-v1.md, spike 2): the skill filter took
// a listing from 104 skills to 1 and the payload from 43.6 KB to 4.0 KB. Not yet run inside a bb thread.
// GAP [[01M5QKD8SDR9TX6Y5G2DM220HP]] measured in a local pi run only; not yet loaded by a bb pi thread.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The slice of pi's ExtensionAPI this file uses, so it needs no pi types to typecheck. */
type Named = { name?: string; path?: string };
type Pi = {
  on(event: "session_start" | "before_agent_start" | "before_provider_request", handler: (event: any, ctx: any) => unknown): void;
  getActiveTools(): string[];
  setActiveTools(names: string[]): void;
  unregisterMcpServer(name: string): void;
};

type Filters = { skills: string[]; tools: string[]; mcpServers: string[]; contextFiles: string[] };

function filters(raw: string | undefined): Filters | null {
  if (raw === undefined || raw === "") return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const list = (k: string) => (Array.isArray(v[k]) ? (v[k] as unknown[]).filter((x): x is string => typeof x === "string") : []);
    return { skills: list("skills"), tools: list("tools"), mcpServers: list("mcpServers"), contextFiles: list("contextFiles") };
  } catch {
    return null;
  }
}

const byName = (item: Named, names: Set<string>) => item.name !== undefined && names.has(item.name);
const byPath = (item: Named, paths: Set<string>) => item.path !== undefined && paths.has(item.path);

/** A thread id safe to use as a file name; anything else reports under the process id. */
export const reportName = (threadId: string | undefined, pid: number): string =>
  threadId !== undefined && /^[A-Za-z0-9_-]{1,128}$/.test(threadId) ? threadId : `pid-${pid}`;

export default function composer(pi: Pi) {
  const f = filters(process.env.PI_COMPOSER_MANIFEST);
  const dir = process.env.PI_COMPOSER_REPORT_DIR ?? join(homedir(), ".pi", "agent", "composer-reports");
  const threadId = process.env.BB_THREAD_ID;
  const file = join(dir, `${reportName(threadId, process.pid)}.json`);
  const report: Record<string, unknown> = { threadId: threadId !== undefined && reportName(threadId, 0) === threadId ? threadId : null, filters: f, requests: [] as unknown[] };
  const save = () => {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(report, null, 2));
    } catch {
      // reporting is best effort; enforcement does not depend on it
    }
  };

  pi.on("session_start", () => {
    const kept: string[] = [];
    for (const name of f?.mcpServers ?? []) {
      try {
        pi.unregisterMcpServer(name);
      } catch {
        // Registered by another extension or by mcp.json: pi refuses, so it stays, and the report says so.
        kept.push(name);
      }
    }
    report.mcpKept = kept;
  });

  pi.on("before_agent_start", (event, ctx) => {
    const o = event.systemPromptOptions ?? {};
    const skillsBefore = (o.skills ?? []) as Named[];
    const filesBefore = (o.contextFiles ?? []) as Named[];
    if (f !== null) {
      const skills = new Set(f.skills);
      const files = new Set(f.contextFiles);
      o.skills = skillsBefore.filter(s => !byName(s, skills));
      o.contextFiles = filesBefore.filter(c => !byPath(c, files));
      const tools = new Set(f.tools);
      if (tools.size > 0) pi.setActiveTools(pi.getActiveTools().filter(t => !tools.has(t)));
    }
    report.start = {
      at: Date.now(),
      skills: { before: skillsBefore.length, after: (o.skills ?? []).length },
      contextFiles: { before: filesBefore.map(c => c.path ?? c.name), after: ((o.contextFiles ?? []) as Named[]).map(c => c.path ?? c.name) },
      activeTools: pi.getActiveTools(),
      systemPromptChars: typeof ctx?.getSystemPrompt === "function" ? String(ctx.getSystemPrompt()).length : null,
    };
    save();
  });

  pi.on("before_provider_request", event => {
    const p = (event.payload ?? {}) as Record<string, unknown>;
    const tools = Array.isArray(p.tools) ? (p.tools as { name?: string; function?: { name?: string } }[]).map(t => t.name ?? t.function?.name ?? "?") : [];
    const requests = report.requests as unknown[];
    requests.push({ at: Date.now(), bytes: JSON.stringify(p).length, tools });
    if (requests.length > 20) requests.splice(0, requests.length - 20);
    save();
  });
}
