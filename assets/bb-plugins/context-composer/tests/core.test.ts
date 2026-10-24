// The composition model, targets, trajectory protocol and views, over plain data. Run: npm test
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { kbOutline, kbSchemaCommands } from "../core/kb.ts";
import { decide, decideSource, diff, isIncluded, parseManifest, totals } from "../core/model.ts";
import { bbTargetFor, commandLine, compile, envNames, instructionText, targetById } from "../core/targets.ts";
import { applyProposal, parseProposals, PROPOSAL_FENCE, trajectoryBrief } from "../core/trajectory.ts";
import { squarify, treemap, weightTree } from "../core/views.ts";
import { byName, composition, manifest, S } from "./fixtures.ts";

test("core imports no host: no bb, pi, Claude or Codex package", () => {
  const dir = new URL("../core/", import.meta.url).pathname;
  for (const f of readdirSync(dir)) {
    const text = readFileSync(join(dir, f), "utf8");
    for (const m of text.matchAll(/from\s+"([^"]+)"/g)) assert.match(m[1]!, /^\.\//, `${f} imports ${m[1]}`);
  }
});

test("decide keeps manifests minimal and diff reports changes and drift", () => {
  const c = composition();
  let m = decide(manifest(), byName(c, "tdd"), "exclude", 2);
  m = decide(m, byName(c, "simplify"), "include", 2); // already active: no entry
  m = decide(m, byName(c, "old-skill"), "include", 2);
  m = { ...m, decisions: { ...m.decisions, "skill:gone:x": "exclude" } };
  assert.deepEqual(Object.keys(m.decisions).sort(), ["skill:gone:x", byName(c, "old-skill").id, byName(c, "tdd").id].sort());
  const d = diff(c, m);
  assert.deepEqual(d.removed.map(a => a.name), ["tdd"]);
  assert.deepEqual(d.added.map(a => a.name), ["old-skill"]);
  assert.equal(d.tokensRemoved, 40);
  assert.deepEqual(d.unknown, ["skill:gone:x"]);
  assert.equal(isIncluded(byName(c, "old-skill"), m), true);
});

test("decideSource toggles a whole source, never the system prompt", () => {
  const c = composition();
  const m = decideSource(manifest(), c, S.ccUser.id, 2);
  assert.equal(isIncluded(byName(c, "tdd"), m), false);
  assert.equal(isIncluded(byName(c, "kb"), m), false);
  assert.equal(isIncluded(byName(c, "CLAUDE.md"), m), true);
  const back = decideSource(m, c, S.ccUser.id, 3);
  assert.deepEqual(back.decisions, {});
  assert.deepEqual(decideSource(manifest(), c, S.system.id, 2).decisions, {});
});

test("totals count included and excluded tokens and unknown weights apart", () => {
  const c = composition();
  const m = decide(manifest(), byName(c, "kb"), "exclude", 2);
  const t = totals(c, m);
  assert.equal(t.excluded, 5000);
  assert.equal(totals(c, manifest()).onDemand, 5000, "a kept deferred MCP server loads on demand");
  assert.equal(t.unknownWeight, 1);
  assert.equal(t.included, 900 + 1200 + 300 + 40 + 30 + 200 + 4000);
});

test("parseManifest drops what is not a decision", () => {
  const m = parseManifest({ version: 1, id: "a", title: "t", decisions: { x: "exclude", y: "maybe" }, additions: { instructions: 3 } });
  assert.deepEqual(m?.decisions, { x: "exclude" });
  assert.equal(m?.additions.instructions, "");
  assert.equal(parseManifest({ version: 2, id: "a", title: "t" }), null);
});

test("bb Claude Code: a group env switch applies only when its whole group is excluded", () => {
  const c = composition();
  const t = bbTargetFor("claude-code");
  // Only MEMORY.md: the auto-memory switch.
  let m = decide(manifest(), byName(c, "MEMORY.md"), "exclude", 2);
  let p = compile(t, c, m);
  assert.deepEqual(p.env, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" });
  assert.equal(p.counts.enforced, 1);
  // One CLAUDE.md of two: advisory, and named in the instructions.
  m = decide(manifest(), byName(c, "CLAUDE.md"), "exclude", 2);
  p = compile(t, c, m);
  assert.deepEqual(p.env, {});
  assert.equal(p.steps[0]!.lever.enforcement, "advisory");
  assert.match(p.instructions, /Instructions: CLAUDE\.md/);
  // Every instruction and memory file: one switch covers all three.
  for (const name of ["~/.claude/CLAUDE.md", "MEMORY.md"]) m = decide(m, byName(c, name), "exclude", 2);
  p = compile(t, c, m);
  assert.deepEqual(p.env, { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" });
  assert.equal(p.counts.enforced, 3);
  // A bb plugin's tool cannot be removed by another plugin.
  p = compile(t, c, decide(manifest(), byName(c, "kb_call"), "exclude", 2));
  assert.equal(p.steps[0]!.lever.enforcement, "advisory");
});

test("bb Claude Code: excluding everything the provider loads is safe mode, flagged experimental", () => {
  const c = composition();
  let m = manifest();
  for (const a of c.artifacts) if (S.bbPlugin.id !== a.sourceId && S.bbInstr.id !== a.sourceId && a.kind !== "system" && a.active) m = decide(m, a, "exclude", 2);
  const p = compile(bbTargetFor("claude-code"), c, m);
  assert.deepEqual(p.env, { CLAUDE_CODE_SAFE_MODE: "1" });
  assert.ok(p.warnings.some(w => /experimental/.test(w)));
});

test("bb Codex: every removal is advisory; additions are enforced instructions", () => {
  const c = composition();
  let m = decide(manifest(), byName(c, "kb"), "exclude", 2);
  m = { ...m, additions: { instructions: "Work in small commits." } };
  const t = bbTargetFor("codex");
  const p = compile(t, c, m);
  assert.deepEqual(p.env, {});
  assert.equal(p.counts.advisory, 1);
  assert.match(p.instructions, /^Work in small commits\./);
  assert.equal(t.additions.enforcement, "enforced");
});

test("bb pi: skills, tools and context files become extension filters in one env var", () => {
  const c = composition();
  let m = decide(manifest(), byName(c, "tdd"), "exclude", 2);
  m = decide(m, byName(c, "kb_call"), "exclude", 2);
  m = decide(m, byName(c, "CLAUDE.md"), "exclude", 2);
  const t = bbTargetFor("pi");
  const p = compile(t, c, m);
  assert.deepEqual(JSON.parse(p.env.PI_COMPOSER_MANIFEST!), { skills: ["tdd"], tools: ["kb_call"], contextFiles: ["/w/CLAUDE.md"] });
  assert.equal(p.counts.enforced, 3);
  assert.deepEqual(envNames(t), ["PI_COMPOSER_MANIFEST"]);
  assert.deepEqual(envNames(bbTargetFor("codex")), []);
});

test("unknown providers fall back to advisory, and an inactive skill with a file is pointed at", () => {
  const c = composition();
  const p = compile(bbTargetFor("acp-opencode"), c, decide(manifest(), byName(c, "old-skill"), "include", 2));
  assert.equal(p.targetId, "bb:other");
  assert.equal(p.steps[0]!.change, "add");
  assert.match(p.instructions, /old-skill: \/h\/\.claude\/skills\/old\/SKILL\.md/);
});

test("instruction text stays within the limit by summarising names", () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ ...composition().artifacts[3]!, id: `s${i}`, name: `skill-number-${i}` }));
  const t = instructionText("", many, [], 4096);
  assert.ok(t.text.length <= 4096);
  assert.equal(t.truncated, true);
  assert.match(t.text, /and \d+ more/);
});

test("the claude CLI target denies MCP servers by rule and appends the instructions", () => {
  const c = composition();
  let m = decide(manifest(), byName(c, "kb"), "exclude", 2);
  m = decide(m, byName(c, "tdd"), "exclude", 2);
  const t = targetById("cli:claude-code")!;
  const p = compile(t, c, m);
  assert.deepEqual(p.args.slice(0, 2), ["--disallowedTools", "mcp__kb"]);
  assert.ok(p.args.includes("--append-system-prompt"));
  assert.match(commandLine(t, p, "go")!, /^claude --disallowedTools mcp__kb --append-system-prompt '.*' go$/s);
});

test("the trajectory brief lists ids and levers; proposals parse and apply", () => {
  const c = composition();
  const brief = trajectoryBrief({ composition: c, manifest: manifest(), target: bbTargetFor("claude-code"), messages: [{ role: "user", text: "fix the build" }], goal: "" });
  assert.ok(brief.includes(byName(c, "tdd").id));
  assert.match(brief, /\| advisory \|/);
  assert.match(brief, /fix the build/);
  assert.ok(!brief.includes("old-skill"), "inactive artifacts are left out of the brief");
  const reply = `Drop the kb server.\n\n\`\`\`${PROPOSAL_FENCE}\n{"exclude": ["${byName(c, "kb").id}", "nope", "${byName(c, "System prompt").id}"], "include": [], "instructions": "Stay in the build.", "why": "noise"}\n\`\`\`\n\`\`\`${PROPOSAL_FENCE}\nnot json\n\`\`\``;
  const proposals = parseProposals(reply);
  assert.equal(proposals.length, 1);
  const { manifest: m, ignored } = applyProposal(manifest(), c, proposals[0]!, 2);
  assert.deepEqual(Object.keys(m.decisions), [byName(c, "kb").id]);
  assert.deepEqual(ignored, ["nope", byName(c, "System prompt").id]);
  assert.equal(m.additions.instructions, "Stay in the build.");
  assert.equal(applyProposal(m, c, proposals[0]!, 3).manifest.additions.instructions, "Stay in the build.", "applying twice adds the text once");
});

test("the weight tree groups by source or kind, and the treemap fills its rectangle", () => {
  const c = composition();
  const m = decide(manifest(), byName(c, "kb"), "exclude", 2);
  assert.equal(weightTree(c, m, "source").children[0]!.label, "Claude Code system", "deferred weight is left out at session start");
  const root = weightTree(c, m, "source", { onDemand: true });
  assert.equal(root.children[0]!.label, "Claude Code user");
  assert.equal(root.children[0]!.children.find(x => x.label === "kb")!.included, false);
  assert.ok(!root.children.flatMap(g => g.children).some(x => x.label === "old-skill"));
  assert.ok(weightTree(c, m, "kind").children.some(g => g.label === "Skills"));
  const rects = squarify(root.children, { x: 0, y: 0, w: 300, h: 200 });
  const area = rects.reduce((s, r) => s + r.rect.w * r.rect.h, 0);
  assert.ok(Math.abs(area - 60000) < 1e-6);
  for (const r of rects) assert.ok(r.rect.x >= -1e-9 && r.rect.y >= -1e-9 && r.rect.x + r.rect.w <= 300 + 1e-9 && r.rect.y + r.rect.h <= 200 + 1e-9);
  assert.ok(treemap(root, { x: 0, y: 0, w: 300, h: 200 }).some(t => t.depth === 2));
});

test("the kb outline references only sources it defines, and the schema defines every field it uses", () => {
  const c = composition();
  const outline = kbOutline(c, decide(manifest(), byName(c, "kb"), "exclude", 2), bbTargetFor("claude-code"), "Lean #1");
  assert.match(outline, /^%%tana%%\n- Lean ＃1 #ctx-composition/);
  const defined = new Set([...outline.matchAll(/^\s+- (.+) #ctx-source$/gm)].map(m => m[1]));
  for (const ref of outline.matchAll(/\[\[([^\]]+)\]\]/g)) assert.ok(defined.has(ref[1]), `unresolved ref ${ref[1]}`);
  assert.match(outline, /ctx-decision:: exclude/);
  const schema = kbSchemaCommands().join("\n");
  for (const f of new Set([...outline.matchAll(/(ctx-[a-z-]+)::/g)].map(m => m[1]))) assert.ok(schema.includes(`field define ${f}`), f);
});
