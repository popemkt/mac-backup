// Plain-data fixtures shared by the tests.
import { artifactId, emptyManifest, sourceId, type Artifact, type Composition, type Source } from "../core/model.ts";

export function src(label: string, injector: Source["injector"], scope: Source["scope"]): Source {
  return { id: sourceId(label), label, injector, scope };
}

export function art(kind: Artifact["kind"], source: Source, name: string, tokens: number | null, over: Partial<Artifact> = {}): Artifact {
  return { id: artifactId(kind, source.id, name), kind, name, sourceId: source.id, tokens: { value: tokens, basis: "reported" }, active: true, ...over };
}

export const S = {
  bbPlugin: src("bb plugin kb", "host", "plugin"),
  bbInstr: src("bb instructions", "host", "user"),
  ccUser: src("Claude Code user", "provider", "user"),
  ccProject: src("Claude Code project", "provider", "project"),
  ccBuiltin: src("Claude Code built-in", "provider", "builtin"),
  system: src("Claude Code system", "provider", "builtin"),
};

export function composition(): Composition {
  const artifacts = [
    art("instruction", S.ccUser, "~/.claude/CLAUDE.md", 900, { path: "/h/.claude/CLAUDE.md" }),
    art("instruction", S.ccProject, "CLAUDE.md", 1200, { path: "/w/CLAUDE.md" }),
    art("memory", S.ccUser, "MEMORY.md", 300),
    art("skill", S.ccUser, "tdd", 40, { description: "test first" }),
    art("skill", S.ccBuiltin, "simplify", 30),
    art("skill", S.ccUser, "old-skill", 20, { active: false, path: "/h/.claude/skills/old/SKILL.md" }),
    art("mcp-server", S.ccUser, "kb", 5000, { deferred: true }),
    art("tool", S.bbPlugin, "kb_call", null),
    art("instruction", S.bbInstr, "bb user instructions", 200),
    art("system", S.system, "System prompt", 4000),
  ];
  return {
    basis: { threadId: "thr_1", providerId: "claude-code", providerName: "Claude Code", model: "opus", workspace: "/w" },
    builtAt: 1,
    sources: Object.values(S),
    artifacts,
    context: { usedTokens: 20000, window: 200000 },
    problems: [],
  };
}

export const manifest = () => emptyManifest({ id: "m1", title: "Lean", basisThreadId: "thr_1", now: 1 });
export const byName = (c: Composition, name: string) => c.artifacts.find(a => a.name === name)!;
