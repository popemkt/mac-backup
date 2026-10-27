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
  /** The start of a failed call's output: the error message is what a continuation most often needs again. */
  error?: string;
}

/**
 * `notice`: something Claude Code injected as a user message that the person did not type, such as a background
 * task's completion. Rendered as a line in Claude's turn, never as `## User` (Codex's importer gets this wrong).
 */
export type Block = { kind: "text"; text: string } | { kind: "tool"; call: ToolCall } | { kind: "notice"; text: string };

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

export interface Todo {
  content: string;
  status: string;
}

/**
 * Where the session stood, built from the records alone (no model call) and placed above the transcript, so no cut
 * removes it. Summaries lose the file trail most often; this keeps it.
 */
export interface Brief {
  /** Paths written by Edit, MultiEdit, Write or NotebookEdit, oldest first. */
  filesChanged: string[];
  /** Paths only read (Read), oldest first. */
  filesRead: string[];
  /** The last TodoWrite list, or null if the session never wrote one. */
  todos: Todo[] | null;
  /** The last tool call, when it has no result: the session ended (or is) mid-tool. */
  endedMidTool: ToolCall | null;
  lastUser: string | null;
  lastClaude: string | null;
}

export interface Transcript {
  sessionId: string;
  title: string | null;
  cwd: string | null;
  gitBranch: string | null;
  model: string | null;
  version: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** The record the conversation ends at: a later sync continues after it. */
  leafUuid: string | null;
  brief: Brief;
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

/** Background-task notifications Claude Code put in a user message, one line each: `<summary> (<status>)`. */
export function notices(raw: string): string[] {
  const out: string[] = [];
  for (const m of raw.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
    const body = m[1]!;
    const summary = /<summary>([\s\S]*?)<\/summary>/.exec(body)?.[1]?.trim() ?? "a background task reported back";
    const status = /<status>([\s\S]*?)<\/status>/.exec(body)?.[1]?.trim();
    out.push(oneLine(`${summary}${status === undefined || summary.toLowerCase().includes(status.toLowerCase()) ? "" : ` (${status})`}`, 200));
  }
  return out;
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
  | { kind: "user"; text: string; images: number; notices: string[] }
  | { kind: "assistant"; blocks: Block[] }
  | { kind: "boundary"; preTokens: number | null }
  | { kind: "summary"; text: string };

interface Node {
  uuid: string;
  parent: string | null;
  at: string | null;
  content: Content | null;
}

/** What the brief needs from a tool call's input; the rest of the input is dropped as it is read. */
interface ToolFacts {
  path?: string;
  todos?: Todo[];
}

/** The brief's last words travel at most this long; briefMarkdown shows less. */
const BRIEF_KEEP_CHARS = 20_000;
const CHANGES_FILES = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const ERROR_CHARS = 200;

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(p => (isObject(p) && typeof p.text === "string" ? p.text : "")).join("\n");
  return "";
}

function toolFacts(name: string, input: unknown): ToolFacts | null {
  const i = isObject(input) ? input : {};
  if (name === "TodoWrite" && Array.isArray(i.todos)) {
    return { todos: i.todos.filter(isObject).map(t => ({ content: oneLine(String(t.content ?? ""), 200), status: String(t.status ?? "pending") })) };
  }
  if (CHANGES_FILES.has(name) || name === "Read") {
    const path = str(i.file_path) ?? str(i.notebook_path);
    return path === null ? null : { path };
  }
  return null;
}

/**
 * Feed it a session's records in file order (`add`), then `finish()`. Keeps per record only the link to its parent
 * and, for main-chain messages, their text and tool lines.
 */
export class SessionReader {
  private readonly nodes = new Map<string, Node>();
  private readonly results = new Map<string, { failed: boolean; chars: number; error?: string }>();
  private readonly facts = new Map<string, ToolFacts>();
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
    const node: Node = { uuid, parent: str(record.parentUuid) ?? str(record.logicalParentUuid), at, content: null };
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
      node.content = this.assistantContent(content);
    }
  }

  private userContent(record: Json, content: unknown): Content | null {
    if (Array.isArray(content)) {
      for (const part of content) {
        if (isObject(part) && part.type === "tool_result" && typeof part.tool_use_id === "string") {
          const failed = part.is_error === true;
          const text = resultText(part.content);
          this.results.set(part.tool_use_id, { failed, chars: text.length, ...(failed ? { error: oneLine(text, ERROR_CHARS) } : {}) });
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
    const found = notices(raw);
    return text.length > 0 || images > 0 || found.length > 0 ? { kind: "user", text, images, notices: found } : null;
  }

  private assistantContent(content: unknown): Content | null {
    if (typeof content === "string") return content.trim().length > 0 ? { kind: "assistant", blocks: [{ kind: "text", text: content.trim() }] } : null;
    if (!Array.isArray(content)) return null;
    const blocks: Block[] = [];
    for (const p of content) {
      if (!isObject(p)) continue;
      if (p.type === "text" && typeof p.text === "string" && p.text.trim().length > 0) blocks.push({ kind: "text", text: p.text.trim() });
      else if (p.type === "tool_use" && typeof p.name === "string") {
        const id = str(p.id) ?? "";
        const facts = toolFacts(p.name, p.input);
        if (facts !== null && id.length > 0) this.facts.set(id, facts);
        blocks.push({ kind: "tool", call: { id, name: p.name, summary: toolSummary(p.name, p.input), failed: false, outputChars: 0 } });
      }
    }
    return blocks.length > 0 ? { kind: "assistant", blocks } : null;
  }

  /** The main chain, oldest first: from the last message back through parents, across compaction boundaries. */
  private chain(): Node[] {
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
    return chain.reverse();
  }

  /**
   * The transcript. With `after` (a record uuid a previous import ended at), only the turns after it, or null when
   * that record is no longer on the main chain (the session was rewound or rewritten since).
   */
  finish(sessionId: string): Transcript;
  finish(sessionId: string, after: string): Transcript | null;
  finish(sessionId: string, after?: string): Transcript | null {
    const all = this.chain();
    let chain = all;
    if (after !== undefined) {
      const i = all.findIndex(n => n.uuid === after);
      if (i < 0) return null;
      chain = all.slice(i + 1);
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
      leafUuid: this.leaf,
      brief: this.brief(all),
      turns: this.turns(chain),
    };
  }

  private turns(chain: Node[]): Turn[] {
    const turns: Turn[] = [];
    let id = 0;
    const uuid = () => `t${id++}`;
    for (const node of chain) {
      const c = node.content;
      if (c === null) continue;
      const prev = turns.at(-1);
      switch (c.kind) {
        case "user": {
          const noticeBlocks = c.notices.map(text => ({ kind: "notice" as const, text }));
          if (c.text.length === 0 && c.images === 0) {
            if (prev?.kind === "turn") prev.blocks.push(...noticeBlocks);
            else turns.push({ kind: "turn", uuid: uuid(), at: node.at, user: null, blocks: noticeBlocks });
          } else turns.push({ kind: "turn", uuid: uuid(), at: node.at, user: { text: c.text, images: c.images }, blocks: noticeBlocks });
          break;
        }
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
    return turns.filter(t => t.kind === "compaction" || t.user !== null || t.blocks.length > 0);
  }

  private brief(chain: Node[]): Brief {
    const changed = new Map<string, true>();
    const read = new Map<string, true>();
    let todos: Todo[] | null = null;
    let lastTool: ToolCall | null = null;
    let lastUser: string | null = null;
    let lastClaude: string | null = null;
    const touch = (m: Map<string, true>, path: string) => {
      m.delete(path);
      m.set(path, true);
    };
    for (const node of chain) {
      const c = node.content;
      if (c?.kind === "user" && c.text.length > 0) lastUser = c.text;
      if (c?.kind !== "assistant") continue;
      for (const b of c.blocks) {
        if (b.kind === "text") lastClaude = b.text;
        if (b.kind !== "tool") continue;
        lastTool = b.call;
        const f = this.facts.get(b.call.id);
        if (f?.todos !== undefined) todos = f.todos;
        if (f?.path !== undefined) touch(CHANGES_FILES.has(b.call.name) ? changed : read, f.path);
      }
    }
    return {
      filesChanged: [...changed.keys()],
      filesRead: [...read.keys()].filter(p => !changed.has(p)),
      todos,
      endedMidTool: lastTool !== null && !this.results.has(lastTool.id) ? lastTool : null,
      lastUser: lastUser?.slice(0, BRIEF_KEEP_CHARS) ?? null,
      lastClaude: lastClaude?.slice(0, BRIEF_KEEP_CHARS) ?? null,
    };
  }

  private resolve(call: ToolCall): ToolCall {
    const r = this.results.get(call.id);
    if (r === undefined) return call;
    return { ...call, failed: r.failed, outputChars: r.chars, ...(r.error === undefined ? {} : { error: r.error }) };
  }
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
  const failed = call.failed ? (call.error === undefined || call.error.length === 0 ? " (failed)" : ` (failed: ${call.error})`) : "";
  return `- ${call.name}${call.summary.length > 0 ? `: ${call.summary}` : ""}${failed}`;
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
      } else if (b.kind === "notice") {
        flush();
        parts.push(`_[notification, not from the person: ${b.text}]_`);
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

const BRIEF_CHANGED = 40;
const BRIEF_READ = 15;
const BRIEF_LAST_CHARS = 3_000;

const pathList = (paths: string[], max: number) => {
  const shown = paths.slice(-max).map(p => `\`${p}\``);
  return `${paths.length > max ? `${paths.length - max} earlier, then ` : ""}${shown.join(", ")}`;
};
const clipText = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}… [${text.length - max} more characters in the transcript]` : text);

/** "Where it stood": files, todos, an unfinished tool call and the last words, from the records alone. */
export function briefMarkdown(t: Transcript): string {
  const b = t.brief;
  const lines = ["## Where the session stood", ""];
  if (b.filesChanged.length > 0) lines.push(`- Files changed (${b.filesChanged.length}, most recent last): ${pathList(b.filesChanged, BRIEF_CHANGED)}`);
  if (b.filesRead.length > 0) lines.push(`- Files only read (${b.filesRead.length}): ${pathList(b.filesRead, BRIEF_READ)}`);
  if (b.filesChanged.length === 0 && b.filesRead.length === 0) lines.push("- No file was read or changed through Claude Code's file tools.");
  if (b.todos !== null) {
    const open = b.todos.filter(x => x.status !== "completed");
    lines.push(
      open.length === 0
        ? `- Todos: all ${b.todos.length} done.`
        : `- Open todos (${open.length} of ${b.todos.length}): ${open.map(x => `[${x.status}] ${x.content}`).join("; ")}`,
    );
  }
  if (b.endedMidTool !== null) {
    lines.push(`- The session ended mid-tool: \`${toolLine(b.endedMidTool).slice(2)}\` has no result. Check whether it took effect before repeating it.`);
  }
  if (b.lastUser !== null) lines.push("", "### The person's last message", "", clipText(b.lastUser, BRIEF_LAST_CHARS));
  if (b.lastClaude !== null) lines.push("", "### Claude's last words", "", clipText(b.lastClaude, BRIEF_LAST_CHARS));
  return lines.join("\n");
}

/** The whole transcript: header, brief, every turn, every tool line. */
export function fullMarkdown(t: Transcript, origin: Origin): string {
  return [headerMarkdown(t, origin), briefMarkdown(t), "## Transcript", ...t.turns.map(turn => turnMarkdown(turn))].join("\n\n") + "\n";
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
  // The brief rides with the header: every cut below keeps it.
  const header = [headerMarkdown(t, origin), briefMarkdown(t), "## Transcript"].join("\n\n");
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
