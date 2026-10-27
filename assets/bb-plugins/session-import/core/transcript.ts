// A Claude Code session as a transcript: the reader that turns its JSONL records into turns, and the Markdown a
// handoff seeds a thread with, cut to a token budget. Pure: no host, SDK or file imports (tests/core.test.ts).
//
// Why a reader of our own: the Agent SDK's getSessionMessages() returns only the chain after the latest compaction
// (spike S2, docs/research/2026-10-27-claude-session-import.md), and it loads the whole file. This one is fed one
// record at a time, keeps a condensed copy of each message, and follows `logicalParentUuid` across compaction
// boundaries, so the whole conversation survives and a 160 MB file never sits in memory.

export interface ToolCall {
  id: string;
  /** The tool name as Claude Code calls it, e.g. `Bash`, `Edit`, `mcp__kb__node_get`. */
  name: string;
  /** One key argument: a command, a path, a pattern, a description. Never the whole input. */
  summary: string;
  failed: boolean;
  /** Characters of the tool's result: the output this transcript leaves out. */
  outputChars: number;
}

export type Block = { kind: "text"; text: string } | { kind: "tool"; call: ToolCall };

export interface ConversationTurn {
  kind: "turn";
  uuid: string;
  at: string | null;
  /** Null when Claude spoke first (after a compaction, or a turn whose prompt was only tool results). */
  user: { text: string; images: number } | null;
  blocks: Block[];
}

export interface CompactionTurn {
  kind: "compaction";
  uuid: string;
  at: string | null;
  /** Claude Code's own summary of everything before this point; null if the file lacks it. */
  summary: string | null;
  preTokens: number | null;
}

export type Turn = ConversationTurn | CompactionTurn;

export interface Transcript {
  sessionId: string;
  title: string | null;
  cwd: string | null;
  gitBranch: string | null;
  model: string | null;
  version: string | null;
  startedAt: string | null;
  endedAt: string | null;
  turns: Turn[];
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const oneLine = (s: string, max: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

// ------------------------------------------------------------------ user text

const DROPPED_TAGS = [
  "system-reminder",
  "local-command-stdout",
  "local-command-stderr",
  "local-command-caveat",
  "command-message",
  "task-notification",
  "bash-stdout",
  "bash-stderr",
];

/**
 * What a person typed, without what Claude Code wrapped around it: a slash command becomes `/name args`; reminders,
 * command output and background-task notices are dropped. Empty when nothing the person typed is left.
 */
export function cleanUserText(raw: string): string {
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(raw)?.[1]?.trim();
  if (name !== undefined) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(raw)?.[1]?.trim() ?? "";
    const slash = name.startsWith("/") ? name : `/${name}`;
    return args.length > 0 ? `${slash} ${args}` : slash;
  }
  let text = raw;
  for (const tag of DROPPED_TAGS) text = text.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "g"), "");
  const bash = /<bash-input>([\s\S]*?)<\/bash-input>/.exec(text)?.[1];
  if (bash !== undefined) return `! ${bash.trim()}`;
  return text.trim();
}

// ------------------------------------------------------------------ tool lines

const PATH_KEYS = ["file_path", "notebook_path", "path"];

/** One key argument of a tool call, short enough for one line. */
export function toolSummary(name: string, input: unknown): string {
  const i = isObject(input) ? input : {};
  const s = (k: string) => str(i[k]);
  switch (name) {
    case "Bash":
    case "BashOutput":
      return oneLine(s("command") ?? s("description") ?? s("bash_id") ?? "", 120);
    case "Grep": {
      const pattern = s("pattern");
      const where = s("path") ?? s("glob");
      return oneLine(`${pattern === null ? "" : `"${pattern}"`}${where === null ? "" : ` in ${where}`}`, 140);
    }
    case "Glob":
      return oneLine(`${s("pattern") ?? ""}${s("path") === null ? "" : ` in ${s("path")}`}`, 140);
    case "WebFetch":
      return oneLine(s("url") ?? "", 140);
    case "WebSearch":
      return oneLine(s("query") ?? "", 140);
    case "Agent":
    case "Task":
      return oneLine(`${s("subagent_type") ?? "agent"}: ${s("description") ?? s("prompt") ?? ""}`, 140);
    case "TodoWrite":
      return Array.isArray(i.todos) ? `${i.todos.length} todos` : "";
    case "Skill":
      return oneLine(s("skill") ?? s("command") ?? "", 100);
  }
  for (const k of PATH_KEYS) if (s(k) !== null) return oneLine(s(k)!, 160);
  for (const v of Object.values(i)) if (typeof v === "string" && v.trim().length > 0) return oneLine(v, 100);
  return "";
}

// ------------------------------------------------------------------ the reader

type Content =
  | { kind: "user"; text: string; images: number }
  | { kind: "assistant"; blocks: Block[] }
  | { kind: "boundary"; preTokens: number | null }
  | { kind: "summary"; text: string };

interface Node {
  parent: string | null;
  at: string | null;
  content: Content | null;
}

function resultChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) return content.reduce<number>((n, p) => n + (isObject(p) && typeof p.text === "string" ? p.text.length : 0), 0);
  return 0;
}

/**
 * Feed it a session's records in file order (`add`), then `finish()`. Keeps per record only the link to its parent
 * and, for main-chain messages, their text and tool lines.
 */
export class SessionReader {
  private readonly nodes = new Map<string, Node>();
  private readonly results = new Map<string, { failed: boolean; chars: number }>();
  private leaf: string | null = null;
  private customTitle: string | null = null;
  private aiTitle: string | null = null;
  private cwd: string | null = null;
  private gitBranch: string | null = null;
  private model: string | null = null;
  private version: string | null = null;
  private first: string | null = null;
  private last: string | null = null;
  records = 0;

  add(record: unknown): void {
    if (!isObject(record)) return;
    this.records++;
    if (record.type === "custom-title" && str(record.customTitle) !== null) this.customTitle = str(record.customTitle);
    if (str(record.aiTitle) !== null) this.aiTitle = str(record.aiTitle);
    const uuid = str(record.uuid);
    if (uuid === null) return;
    const sidechain = record.isSidechain === true;
    const at = str(record.timestamp);
    const node: Node = { parent: str(record.parentUuid) ?? str(record.logicalParentUuid), at, content: null };
    this.nodes.set(uuid, node);
    if (sidechain) return;
    if (str(record.cwd) !== null) this.cwd = str(record.cwd);
    if (str(record.gitBranch) !== null) this.gitBranch = str(record.gitBranch);
    if (str(record.version) !== null) this.version = str(record.version);
    if (record.type === "system") {
      if (record.subtype === "compact_boundary") {
        const meta = isObject(record.compactMetadata) ? record.compactMetadata : {};
        node.content = { kind: "boundary", preTokens: typeof meta.preTokens === "number" ? meta.preTokens : null };
      }
      return;
    }
    if (record.type !== "user" && record.type !== "assistant") return;
    this.leaf = uuid;
    if (at !== null) {
      this.first ??= at;
      this.last = at;
    }
    const message = isObject(record.message) ? record.message : {};
    const content = message.content;
    if (record.type === "user") node.content = this.userContent(record, content);
    else {
      const model = str(message.model);
      if (model !== null && model !== "<synthetic>") this.model = model;
      node.content = assistantContent(content);
    }
  }

  private userContent(record: Json, content: unknown): Content | null {
    if (Array.isArray(content)) {
      for (const part of content) {
        if (isObject(part) && part.type === "tool_result" && typeof part.tool_use_id === "string") {
          this.results.set(part.tool_use_id, { failed: part.is_error === true, chars: resultChars(part.content) });
        }
      }
    }
    const raw =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter((p): p is Json => isObject(p) && p.type === "text" && typeof p.text === "string")
              .map(p => p.text as string)
              .join("\n\n")
          : "";
    if (record.isCompactSummary === true) return { kind: "summary", text: raw.trim() };
    if (record.isMeta === true) return null;
    const images = Array.isArray(content) ? content.filter(p => isObject(p) && p.type === "image").length : 0;
    const text = cleanUserText(raw);
    return text.length > 0 || images > 0 ? { kind: "user", text, images } : null;
  }

  finish(sessionId: string): Transcript {
    const chain: Node[] = [];
    const seen = new Set<string>();
    let at = this.leaf;
    while (at !== null && !seen.has(at)) {
      seen.add(at);
      const node = this.nodes.get(at);
      if (node === undefined) break;
      chain.push(node);
      at = node.parent;
    }
    chain.reverse();
    const turns: Turn[] = [];
    let id = 0;
    const uuid = () => `t${id++}`;
    for (const node of chain) {
      const c = node.content;
      if (c === null) continue;
      const prev = turns.at(-1);
      switch (c.kind) {
        case "user":
          turns.push({ kind: "turn", uuid: uuid(), at: node.at, user: { text: c.text, images: c.images }, blocks: [] });
          break;
        case "assistant": {
          const blocks = c.blocks.map(b => (b.kind === "tool" ? { kind: "tool" as const, call: this.resolve(b.call) } : b));
          if (prev?.kind === "turn") prev.blocks.push(...blocks);
          else turns.push({ kind: "turn", uuid: uuid(), at: node.at, user: null, blocks });
          break;
        }
        case "boundary":
          turns.push({ kind: "compaction", uuid: uuid(), at: node.at, summary: null, preTokens: c.preTokens });
          break;
        case "summary":
          if (prev?.kind === "compaction" && prev.summary === null) prev.summary = c.text;
          else turns.push({ kind: "compaction", uuid: uuid(), at: node.at, summary: c.text, preTokens: null });
          break;
      }
    }
    return {
      sessionId,
      title: this.customTitle ?? this.aiTitle,
      cwd: this.cwd,
      gitBranch: this.gitBranch,
      model: this.model,
      version: this.version,
      startedAt: this.first,
      endedAt: this.last,
      turns: turns.filter(t => t.kind === "compaction" || t.user !== null || t.blocks.length > 0),
    };
  }

  private resolve(call: ToolCall): ToolCall {
    const r = this.results.get(call.id);
    return r === undefined ? call : { ...call, failed: r.failed, outputChars: r.chars };
  }
}

function assistantContent(content: unknown): Content | null {
  if (typeof content === "string") return content.trim().length > 0 ? { kind: "assistant", blocks: [{ kind: "text", text: content.trim() }] } : null;
  if (!Array.isArray(content)) return null;
  const blocks: Block[] = [];
  for (const p of content) {
    if (!isObject(p)) continue;
    if (p.type === "text" && typeof p.text === "string" && p.text.trim().length > 0) blocks.push({ kind: "text", text: p.text.trim() });
    else if (p.type === "tool_use" && typeof p.name === "string") {
      blocks.push({
        kind: "tool",
        call: { id: str(p.id) ?? "", name: p.name, summary: toolSummary(p.name, p.input), failed: false, outputChars: 0 },
      });
    }
  }
  return blocks.length > 0 ? { kind: "assistant", blocks } : null;
}

/** Reads a whole JSONL text. For tests and small inputs; the host streams lines into a SessionReader instead. */
export function readSession(sessionId: string, jsonl: string): Transcript {
  const r = new SessionReader();
  for (const line of jsonl.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      r.add(JSON.parse(line));
    } catch {
      // a torn last line while Claude Code is still writing: skip it
    }
  }
  return r.finish(sessionId);
}

// ------------------------------------------------------------------ Markdown

export const tokensOf = (text: string) => Math.ceil(text.length / 4);

const when = (at: string | null) => (at === null ? "" : ` · ${at.replace("T", " ").slice(0, 16)}`);

export function toolLine(call: ToolCall): string {
  return `- ${call.name}${call.summary.length > 0 ? `: ${call.summary}` : ""}${call.failed ? " (failed)" : ""}`;
}

/** One turn as Markdown. `tools: false` replaces its tool lines with a count. */
export function turnMarkdown(turn: Turn, opts: { tools: boolean } = { tools: true }): string {
  if (turn.kind === "compaction") {
    return [`## Earlier context, as compacted by Claude Code${when(turn.at)}`, turn.summary ?? "_(Claude Code's summary is not in the session file.)_"].join("\n\n");
  }
  const out: string[] = [];
  if (turn.user !== null) {
    const images = turn.user.images > 0 ? `${turn.user.text.length > 0 ? "\n\n" : ""}[${turn.user.images} image${turn.user.images > 1 ? "s" : ""}]` : "";
    out.push(`## User${when(turn.at)}\n\n${turn.user.text}${images}`);
  }
  if (turn.blocks.length > 0) {
    const parts: string[] = [];
    let tools: string[] = [];
    let hidden = 0;
    const flush = () => {
      if (tools.length > 0) parts.push(tools.join("\n"));
      tools = [];
    };
    for (const b of turn.blocks) {
      if (b.kind === "text") {
        flush();
        parts.push(b.text);
      } else if (opts.tools) tools.push(toolLine(b.call));
      else hidden++;
    }
    flush();
    if (hidden > 0) parts.push(`_(${hidden} tool call${hidden > 1 ? "s" : ""})_`);
    out.push(`## Claude\n\n${parts.join("\n\n")}`);
  }
  return out.join("\n\n");
}

export interface Origin {
  machine: string;
}

export function headerMarkdown(t: Transcript, origin: Origin): string {
  const lines = [`# Claude Code session${t.title === null ? "" : `: ${t.title}`}`, ""];
  lines.push(`- Session \`${t.sessionId}\` on ${origin.machine}`);
  if (t.cwd !== null) lines.push(`- Directory \`${t.cwd}\`${t.gitBranch === null ? "" : `, branch \`${t.gitBranch}\``}`);
  if (t.model !== null || t.version !== null) lines.push(`- ${[t.model === null ? null : `Model ${t.model}`, t.version === null ? null : `Claude Code ${t.version}`].filter(Boolean).join(", ")}`);
  if (t.startedAt !== null) lines.push(`- From ${t.startedAt.slice(0, 16).replace("T", " ")} to ${(t.endedAt ?? t.startedAt).slice(0, 16).replace("T", " ")} (UTC)`);
  return lines.join("\n");
}

/** The whole transcript: every turn, every tool line. */
export function fullMarkdown(t: Transcript, origin: Origin): string {
  return [headerMarkdown(t, origin), ...t.turns.map(turn => turnMarkdown(turn))].join("\n\n") + "\n";
}

// ------------------------------------------------------------------ the budget

export const DEFAULT_BUDGET_TOKENS = 40_000;
/** Turns that keep their tool lines when the budget forces cut 2. */
export const RECENT_TURNS_WITH_TOOLS = 10;

export interface Plan {
  turns: number;
  /** Turns shown in full. */
  full: number;
  /** Turns shown with their tool lines replaced by a count. */
  condensed: number;
  /** Turns left out (counted before the latest compaction too). */
  omitted: number;
  /** Which cuts applied: 1 = history before the latest compaction, 2 = older tool lines, 3 = older turns, 4 = clipped text. */
  cuts: number[];
  tokens: number;
  fullTokens: number;
}

export interface Seed {
  markdown: string;
  plan: Plan;
}

/**
 * The transcript cut to `budget` tokens, in this order, stopping as soon as it fits:
 * 1. everything before the latest compaction becomes Claude Code's own summary of it;
 * 2. turns older than the last RECENT_TURNS_WITH_TOOLS lose their tool lines (a count stays);
 * 3. the oldest turns go, except the first person's message (the task), with a marker where they were;
 * 4. as a last resort, the text is clipped.
 */
export function seedMarkdown(t: Transcript, origin: Origin, budget = DEFAULT_BUDGET_TOKENS): Seed {
  const header = headerMarkdown(t, origin);
  const total = t.turns.length;
  const full = fullMarkdown(t, origin);
  const fullTokens = tokensOf(full);
  const plan = (p: Omit<Plan, "turns" | "fullTokens" | "tokens">, markdown: string): Seed => ({
    markdown,
    plan: { ...p, turns: total, tokens: tokensOf(markdown), fullTokens },
  });
  if (fullTokens <= budget) return plan({ full: total, condensed: 0, omitted: 0, cuts: [] }, full);

  const cuts: number[] = [];
  const firstTask = t.turns.find((x): x is ConversationTurn => x.kind === "turn" && x.user !== null && x.user.text.length > 0) ?? null;
  let kept: Turn[] = t.turns;
  let omitted = 0;
  let lastCompaction = -1;
  t.turns.forEach((x, i) => {
    if (x.kind === "compaction") lastCompaction = i;
  });
  if (lastCompaction > 0) {
    kept = t.turns.slice(lastCompaction);
    omitted = lastCompaction;
    cuts.push(1);
  }
  const render = (turns: Turn[], withTools: (i: number) => boolean, dropped: number) => {
    const parts = [header];
    const taskKept = firstTask !== null && turns.includes(firstTask);
    if (firstTask !== null && !taskKept) parts.push(turnMarkdown({ ...firstTask, blocks: [] }));
    if (dropped > 0) parts.push(`_[${dropped} earlier turn${dropped > 1 ? "s" : ""} omitted here: see the full transcript.]_`);
    turns.forEach((turn, i) => parts.push(turnMarkdown(turn, { tools: withTools(i) })));
    return parts.join("\n\n") + "\n";
  };
  const allTools = () => true;
  let md = render(kept, allTools, omitted);
  if (tokensOf(md) <= budget) return plan({ full: kept.length, condensed: 0, omitted, cuts }, md);

  cuts.push(2);
  const recent = (turns: Turn[]) => (i: number) => i >= turns.length - RECENT_TURNS_WITH_TOOLS;
  md = render(kept, recent(kept), omitted);
  const condensedOf = (turns: Turn[]) => Math.max(0, turns.length - RECENT_TURNS_WITH_TOOLS);
  if (tokensOf(md) <= budget) return plan({ full: kept.length - condensedOf(kept), condensed: condensedOf(kept), omitted, cuts }, md);

  cuts.push(3);
  // Drop from the oldest end; the first task is re-added by render() on its own.
  let lo = 0;
  let hi = kept.length - 1;
  let best: Turn[] | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const tail = kept.slice(mid);
    if (tokensOf(render(tail, recent(tail), omitted + mid)) <= budget) {
      best = tail;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  if (best !== null) {
    const dropped = kept.length - best.length;
    return plan({ full: best.length - condensedOf(best), condensed: condensedOf(best), omitted: omitted + dropped, cuts }, render(best, recent(best), omitted + dropped));
  }
  cuts.push(4);
  const last = kept.slice(-1);
  const clipped = render(last, allTools, omitted + kept.length - 1);
  const max = budget * 4;
  const markdown = clipped.length > max ? `${clipped.slice(0, max - 80)}\n\n_[clipped here: see the full transcript.]_\n` : clipped;
  return plan({ full: 1, condensed: 0, omitted: omitted + kept.length - 1, cuts }, markdown);
}
