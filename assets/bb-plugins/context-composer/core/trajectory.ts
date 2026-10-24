// The trajectory side chat's protocol: the brief an advisor agent gets (the composition, the manifest, the levers and
// the thread's recent messages), and the proposals it answers with, which the person applies with one click.
import { isIncluded, isRemovable, KIND_LABELS, tokensOf, type Artifact, type Composition, type Decision, type Manifest, type Source } from "./model.ts";
import { itemLever, type Target } from "./targets.ts";

export type Message = { role: "user" | "assistant"; text: string };

/** The fenced block an advisor ends a proposal with. */
export const PROPOSAL_FENCE = "composer-proposal";

export type Proposal = {
  exclude: string[];
  include: string[];
  /** Text to add to the manifest's instructions. */
  instructions: string;
  why: string;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** One row per artifact: what the advisor needs to name it and weigh it. */
function row(a: Artifact, m: Manifest, t: Target, s: Source): string {
  const state = isIncluded(a, m) ? "in" : "out";
  const tokens = a.tokens.value === null ? "?" : `${a.tokens.basis === "estimated" ? "~" : ""}${a.tokens.value}`;
  const lever = itemLever(t, a, s).enforcement;
  const desc = a.description === undefined ? "" : ` — ${clip(oneLine(a.description), 90)}`;
  return `| ${a.id} | ${state} | ${tokens} | ${lever} | ${clip(oneLine(a.name), 60)}${desc} |`;
}

/** The first message of a trajectory chat. Bounded: descriptions and messages are clipped, inactive artifacts left out. */
export function trajectoryBrief(input: { composition: Composition; manifest: Manifest; target: Target; messages: Message[]; goal: string }): string {
  const { composition: c, manifest: m, target: t } = input;
  const sources = new Map(c.sources.map(s => [s.id, s]));
  const shown = c.artifacts.filter(a => a.active || m.decisions[a.id] !== undefined);
  const byKind = new Map<string, Artifact[]>();
  for (const a of shown) byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a]);
  const table: string[] = [];
  for (const [kind, items] of byKind) {
    table.push("", `### ${KIND_LABELS[kind as Artifact["kind"]]} (${items.length}, ${items.reduce((n, a) => n + tokensOf(a), 0)} tokens)`, "| id | state | tokens | if removed | name |", "|---|---|---|---|---|");
    for (const a of items.sort((x, y) => tokensOf(y) - tokensOf(x))) {
      table.push(row(a, m, t, sources.get(a.sourceId) ?? { id: a.sourceId, label: a.sourceId, injector: "provider", scope: "user" }));
    }
  }
  const recent = input.messages.slice(-12).map(msg => `**${msg.role}:** ${clip(msg.text.trim(), 1500)}`);
  const goal = input.goal.trim();
  return [
    "You are the trajectory advisor of a context composer. Do not edit files, run commands or call tools: answer from what is below.",
    "",
    `The person is composing the context for an agent on ${t.label} (${c.basis.providerName}${c.basis.model === null ? "" : `, ${c.basis.model}`}). Below is every artifact that feeds it, with its id, whether the current manifest keeps it (in/out), its token weight (~ estimated, ? unknown), and what happens on this host if it is removed: \`enforced\` (the host takes it out), \`advisory\` (the agent is only told not to use it) or \`none\`.`,
    "",
    "Answer two kinds of question:",
    "1. What will this context do to the thread's trajectory: which artifacts will pull the agent where, what is noise, what is missing.",
    "2. What to remove or add to steer it toward a trajectory the person describes.",
    "",
    `When you recommend changes, end your answer with one fenced block tagged \`${PROPOSAL_FENCE}\` holding JSON: {"exclude": [ids], "include": [ids], "instructions": "text to add, or empty", "why": "one line"}. Use ids exactly as listed. Prefer enforced removals, and say when a removal is only advisory.`,
    "",
    `## Composition: ${c.artifacts.length} artifacts, ${c.context === null ? "context size unknown" : `${c.context.usedTokens} of ${c.context.window} tokens in use`}`,
    ...table,
    "",
    "## Manifest additions",
    m.additions.instructions.trim() === "" ? "(none)" : m.additions.instructions.trim(),
    "",
    `## The thread's recent messages (${recent.length})`,
    ...(recent.length === 0 ? ["(none)"] : recent),
    "",
    "## The person's question",
    goal === "" ? "What will this context do to the trajectory of the thread, and what would you remove or add?" : goal,
  ].join("\n");
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Every well-formed proposal block in a message, in order. Malformed blocks are skipped. */
export function parseProposals(text: string): Proposal[] {
  const out: Proposal[] = [];
  const fence = new RegExp("```" + PROPOSAL_FENCE + "\\s*\\n([\\s\\S]*?)```", "g");
  for (const match of text.matchAll(fence)) {
    try {
      const v: unknown = JSON.parse(match[1] ?? "");
      if (typeof v !== "object" || v === null) continue;
      const o = v as Record<string, unknown>;
      out.push({
        exclude: strings(o.exclude),
        include: strings(o.include),
        instructions: typeof o.instructions === "string" ? o.instructions : "",
        why: typeof o.why === "string" ? o.why : "",
      });
    } catch {
      // not JSON: skipped
    }
  }
  return out;
}

/** A proposal applied to a manifest. Ids the composition does not have, or cannot change, are reported, not applied. */
export function applyProposal(m: Manifest, c: Composition, p: Proposal, now: number): { manifest: Manifest; ignored: string[] } {
  const byId = new Map(c.artifacts.map(a => [a.id, a]));
  const decisions: Record<string, Decision> = { ...m.decisions };
  const ignored: string[] = [];
  const set = (id: string, d: Decision) => {
    const a = byId.get(id);
    if (a === undefined || !isRemovable(a)) {
      ignored.push(id);
      return;
    }
    if ((d === "include") === a.active) delete decisions[id];
    else decisions[id] = d;
  };
  for (const id of p.exclude) set(id, "exclude");
  for (const id of p.include) set(id, "include");
  const added = p.instructions.trim();
  const current = m.additions.instructions.trim();
  const instructions = added === "" || current.includes(added) ? m.additions.instructions : [current, added].filter(x => x !== "").join("\n\n");
  return { manifest: { ...m, decisions, additions: { instructions }, updatedAt: now }, ignored };
}
