/**
 * The scripts nodes name (DESIGN.md → Sandbox → Scripts): `ext.code.script.list`
 * tells, for each subject in order, the `#script` nodes it names
 * (`sys.f.scripts`) that kb can run, with what each may ask and whether a
 * person trusts it on this machine — so a view that runs scripts can say
 * which it runs without knowing what a script is (`ext.canvas.describe`).
 */
import { Effect } from "effect";
import { z } from "zod";
import { CodeTrust, KbCtx, type ExtensionAction } from "@kb/contracts";
import type { DomainError } from "@kb/model";
import { codeDigest } from "@kb/sandbox";
import { scriptIdsOf, scriptOf } from "./script.ts";

const listInput = z.object({
  subjects: z
    .array(z.string().min(1))
    .describe("the nodes whose scripts to list: a canvas's board and the page itself, say"),
});

/** One script as listed: which, for which node, what it may ask, and whether it runs. */
const ListedScriptSchema = z.object({
  id: z.string(),
  label: z.string(),
  subject: z.string().describe("the node that names it, its kb.subject when it runs"),
  reads: z.string().describe("what it may read: none, its subject, or the graph"),
  actions: z.array(z.string()).describe("the actions it may call"),
  trusted: z.boolean().describe("whether a person trusts it here: an untrusted script never runs"),
});

const listOutput = z.object({ scripts: z.array(ListedScriptSchema) });

const scriptListEffect = Effect.fn("ext.code.script.list")(function* (
  input: z.infer<typeof listInput>,
): Effect.fn.Return<z.infer<typeof listOutput>, DomainError, KbCtx | CodeTrust> {
  const ctx = yield* KbCtx;
  const named = input.subjects.flatMap((subject) =>
    scriptIdsOf(ctx.index.getNode(subject)).flatMap((id) => {
      const node = ctx.index.getNode(id);
      const script = node === undefined ? null : scriptOf(node);
      return script === null ? [] : [{ subject, script }];
    }),
  );
  const digests = yield* Effect.forEach(named, ({ script }) =>
    codeDigest(script.code, script.grant),
  );
  const trusted = new Set(yield* (yield* CodeTrust).trusted(digests));
  return {
    scripts: named.map(({ subject, script }, i) => ({
      id: script.id,
      label: script.label,
      subject,
      reads: script.grant.reads,
      actions: [...script.grant.actions],
      trusted: trusted.has(digests[i] ?? ""),
    })),
  };
});

export const SCRIPT_LIST: ExtensionAction = {
  id: "script.list",
  title: "List the scripts nodes name",
  description:
    "For each subject node in order, the #script nodes it names (sys.f.scripts) that kb can run: each one's id, name, grant (what it may read and call) and whether a person trusts it on this machine. An untrusted script never runs; trusting one is a person's act.",
  mode: { kind: "read" },
  inputSchema: listInput,
  outputSchema: listOutput,
  effect: scriptListEffect,
};
