// The bb adapter's mapping from agent-artifacts' inventory, and the thread record's parsing. Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { compositionFrom } from "../adapter/inventory.ts";
import { parseThreadRecord } from "../adapter/records.ts";
import { claude, inventory } from "./bb-fixtures.ts";

test("a Codex thread: bb's and the provider's own artifacts, with the system prompt and conversation unremovable", () => {
  const c = compositionFrom(inventory("codex"), null, 2);
  const names = c.artifacts.map(a => `${a.kind}:${a.name}:${a.active}`);
  assert.deepEqual(names.sort(), [
    "conversation:Messages:true",
    "instruction:Codex project instructions:true",
    "instruction:bb user instructions:true",
    "skill:dup:false",
    "skill:tdd:true",
    "skill:workflows:true",
    "system:System prompt:true",
    "tool:kb_call:true",
  ]);
  const injector = (name: string) => c.sources.find(s => s.id === c.artifacts.find(a => a.name === name)!.sourceId)!.injector;
  assert.equal(injector("workflows"), "host");
  assert.equal(injector("tdd"), "provider");
  assert.equal(injector("kb_call"), "host");
  assert.equal(c.basis.providerId, "codex");
});

test("a Claude Code thread: Claude Code's own listing replaces bb's guesses, and bb's injected skills stay bb's", () => {
  const c = compositionFrom(inventory("claude-code"), claude(), 2);
  const skills = c.artifacts.filter(a => a.kind === "skill");
  assert.deepEqual(skills.map(a => a.name).sort(), ["bb-global-skills:kb", "simplify", "tdd"]);
  const sourceOf = (name: string) => c.sources.find(s => s.id === c.artifacts.find(a => a.name === name)!.sourceId)!;
  assert.equal(sourceOf("bb-global-skills:kb").injector, "host");
  assert.equal(sourceOf("simplify").scope, "builtin");
  assert.equal(c.artifacts.find(a => a.name === "tdd")!.tokens.basis, "reported");
  assert.ok(!c.artifacts.some(a => a.name === "Codex project instructions"), "bb's provider-file guesses are dropped");
  assert.equal(c.artifacts.find(a => a.name === "github")!.active, false);
  assert.equal(c.artifacts.find(a => a.name === "notes.md")!.active, false);
  assert.ok(!c.artifacts.some(a => a.name === "explain"), "unused output styles are not part of the context");
  assert.ok(!c.artifacts.some(a => a.name === "X"), "env vars are not context");
});

test("thread records: unknown roles and malformed env names are dropped", () => {
  assert.equal(parseThreadRecord({ role: "other", basisThreadId: "t" }), null);
  assert.deepEqual(parseThreadRecord({ role: "advisor", basisThreadId: "t" }), { role: "advisor", basisThreadId: "t" });
  const r = parseThreadRecord({ role: "composed", basisThreadId: "t", manifestId: "m", targetId: "bb:claude-code", env: { CLAUDE_CODE_SAFE_MODE: "1", "bad name": "x", N: 3 } });
  assert.equal(r?.role, "composed");
  assert.deepEqual(r?.role === "composed" ? r.env : null, { CLAUDE_CODE_SAFE_MODE: "1" });
});
