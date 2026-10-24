// The composition as Markdown: for `bb composer`, for agents, and for the composer's Copy button.
import { isRemovable, KIND_LABELS, tokensOf, type Artifact, type Composition } from "./model.ts";
import { inline } from "./strings.ts";
import { enforcementLegend, itemLever, targetById, type TargetId } from "./targets.ts";

const n = (x: number) => x.toLocaleString("en-US");
const weight = (a: Artifact) => (a.tokens.value === null ? "?" : `${a.tokens.basis === "estimated" ? "~" : ""}${n(a.tokens.value)}`);

export function compositionMarkdown(c: Composition, targetId: TargetId): string {
  const t = targetById(targetId)!;
  const sources = new Map(c.sources.map(s => [s.id, s]));
  const active = c.artifacts.filter(a => a.active);
  const lines = [`# Composed context: ${c.basis.providerName}${c.basis.model === null ? "" : `, ${c.basis.model}`}`, ""];
  if (c.context !== null) lines.push(`- In use: ${n(c.context.usedTokens)} of ${n(c.context.window)} tokens`);
  lines.push(`- ${active.length} artifacts reach the agent, ${n(active.reduce((s, a) => s + tokensOf(a), 0))} tokens counted (~ estimated, ? unknown)`);
  lines.push(`- Removal levers for ${t.label}: ${enforcementLegend()}`);
  for (const [kind, title] of Object.entries(KIND_LABELS)) {
    const items = active.filter(a => a.kind === kind).sort((x, y) => tokensOf(y) - tokensOf(x));
    if (items.length === 0) continue;
    lines.push("", `## ${title} (${items.length})`);
    for (const a of items) {
      const s = sources.get(a.sourceId);
      const lever = s === undefined || !isRemovable(a) ? "none" : itemLever(t, a, s, { composition: c }).enforcement;
      lines.push(`- ${inline(a.name, 80)} (${inline(s?.label ?? a.sourceId, 80)}) ${weight(a)} tok, ${lever}`);
    }
  }
  if (c.problems.length > 0) lines.push("", "## Problems", ...c.problems.map(p => `- ${p}`));
  return lines.join("\n");
}
