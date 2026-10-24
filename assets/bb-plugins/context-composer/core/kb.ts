// A composition as kb nodes, so kb's outline, graph and canvas views render it: a Tana-Paste outline for
// `kb add --outline` (or the kb_call `node.addTree` action), and the schema it needs, defined once per store.
import { isIncluded, isRemovable, KIND_LABELS, type Composition, type Manifest } from "./model.ts";
import { compile, itemLever, type Target } from "./targets.ts";

/** Tags and fields the outline uses. Prefixed so they do not collide with a store's own `source` or `kind`. */
export const KB_SCHEMA = {
  tags: { composition: "ctx-composition", source: "ctx-source", artifact: "ctx-artifact" },
  fields: { kind: "ctx-kind", tokens: "ctx-tokens", source: "ctx-source-of", decision: "ctx-decision", lever: "ctx-lever" },
} as const;

/** The kb commands that define the schema, safe to run again. `kb --root <store>` selects another store. */
export function kbSchemaCommands(kb = "kb"): string[] {
  const { tags, fields } = KB_SCHEMA;
  return [
    `${kb} tag define ${tags.composition}`,
    `${kb} tag define ${tags.source}`,
    ...Object.values(fields).map(f => `${kb} field define ${f}`),
    `${kb} field type ${fields.tokens} number`,
    `${kb} field type ${fields.source} ref`,
    `${kb} field target ${fields.source} ${tags.source}`,
    `${kb} tag define ${tags.artifact} ${Object.values(fields).map(f => `--field ${f}`).join(" ")}`,
  ];
}

/** Outline items must not start a tag or a ref by accident, and refs resolve by exact text. */
const text = (s: string) => s.replace(/[\n\r]+/g, " ").replace(/(^|\s)#/g, "$1＃").replace(/\[\[/g, "[ [").trim();

/** The composition under one #ctx-composition node, sources as #ctx-source nodes the artifacts reference. */
export function kbOutline(c: Composition, m: Manifest, t: Target, title: string): string {
  const { tags, fields } = KB_SCHEMA;
  const plan = compile(t, c, m);
  const planned = new Map(plan.steps.map(s => [s.artifact.id, s.lever]));
  const sources = new Map(c.sources.map(s => [s.id, s]));
  const used = c.sources.filter(s => c.artifacts.some(a => a.sourceId === s.id && (a.active || m.decisions[a.id] !== undefined)));
  const label = (id: string) => `${text(sources.get(id)?.label ?? id)} (${t.label})`;
  const lines = ["%%tana%%", `- ${text(title)} #${tags.composition}`];
  lines.push("  - Sources");
  for (const s of used) lines.push(`    - ${label(s.id)} #${tags.source}`);
  const names = new Map<string, number>();
  for (const a of c.artifacts) names.set(a.name, (names.get(a.name) ?? 0) + 1);
  for (const [kind, title] of Object.entries(KIND_LABELS)) {
    const items = c.artifacts.filter(a => a.kind === kind && (a.active || m.decisions[a.id] !== undefined));
    if (items.length === 0) continue;
    lines.push(`  - ${title}`);
    for (const a of items) {
      const name = (names.get(a.name) ?? 0) > 1 ? `${a.name} (${sources.get(a.sourceId)?.label ?? a.sourceId})` : a.name;
      const lever = planned.get(a.id) ?? itemLever(t, a, sources.get(a.sourceId) ?? { id: a.sourceId, label: a.sourceId, injector: "provider", scope: "user" });
      lines.push(`    - ${text(name)} #${tags.artifact}`);
      lines.push(`      - ${fields.kind}:: ${a.kind}`);
      if (a.tokens.value !== null) lines.push(`      - ${fields.tokens}:: ${a.tokens.value}`);
      lines.push(`      - ${fields.source}:: [[${label(a.sourceId)}]]`);
      lines.push(`      - ${fields.decision}:: ${isIncluded(a, m) ? "include" : "exclude"}`);
      if (isRemovable(a)) lines.push(`      - ${fields.lever}:: ${lever.enforcement}`);
    }
  }
  return lines.join("\n");
}
