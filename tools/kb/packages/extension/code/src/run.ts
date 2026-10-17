/**
 * Running a script once (DESIGN.md → Sandbox → Scripts, tldraw's exec):
 * `ext.code.script.run` runs a `#script` against a node — a canvas, say —
 * until it is quiet, on the host's engine, its calls answered by the invoke
 * core as writes, each as the `script` actor within its grant. Only a script
 * a person trusts runs, by the digest of exactly its code and grant. The
 * run itself asks approval as configuration does: a person's runs it, an
 * agent's only with approval, a script's never on its own.
 */
import { Effect } from "effect";
import { z } from "zod";
import { CodeTrust, CoreInvoke, KbCtx, type ExtensionAction } from "@kb/contracts";
import { domainError, type DomainError } from "@kb/model";
import { UntrustedEngine, codeDigest, snapshotRun } from "@kb/sandbox";
import { scriptOf } from "./script.ts";

/** How long a run once may take to go quiet: longer than a snapshot, since it writes. */
const RUN_BUDGET_MS = 10_000;

const runInput = z.object({
  script: z.string().min(1).describe("the #script node to run"),
  subject: z
    .string()
    .min(1)
    .describe("the node it runs for, its kb.subject: the canvas it acts on, say"),
});

const runOutput = z.object({
  script: z.string(),
  subject: z.string(),
  ended: z
    .object({ reason: z.string(), message: z.string() })
    .nullable()
    .describe("why the run ended, or null when it went quiet still running"),
});

const scriptRunEffect = Effect.fn("ext.code.script.run")(function* (
  input: z.infer<typeof runInput>,
): Effect.fn.Return<z.infer<typeof runOutput>, DomainError, KbCtx | CodeTrust> {
  const ctx = yield* KbCtx;
  const node = ctx.index.getNode(input.script);
  if (node === undefined) return yield* domainError("not_found", `no node ${input.script}`);
  const script = scriptOf(node);
  if (script === null) {
    return yield* domainError("invalid_input", `${input.script} is no #script kb can run`);
  }
  if (ctx.index.getNode(input.subject) === undefined) {
    return yield* domainError("not_found", `no node ${input.subject}`);
  }
  const digest = yield* codeDigest(script.code, script.grant);
  const trusted = yield* (yield* CodeTrust).trusted([digest]);
  if (!trusted.includes(digest)) {
    return yield* domainError(
      "forbidden",
      `script ${script.label} is not trusted on this machine: a person reads and trusts it first`,
    );
  }
  const engine = yield* UntrustedEngine;
  const invoke = yield* CoreInvoke;
  if (engine === null || invoke === null) {
    return yield* domainError("internal", "this host runs no code: run the script where kb runs");
  }
  const { end } = yield* snapshotRun(
    engine,
    { invoke: (invocation) => invoke(invocation, "write") },
    { code: script.code, grant: script.grant, subject: input.subject },
    RUN_BUDGET_MS,
  );
  return { script: input.script, subject: input.subject, ended: end };
});

export const SCRIPT_RUN: ExtensionAction = {
  id: "script.run",
  title: "Run a script once",
  description:
    "Run a #script node once against a node (a canvas, say), until it is quiet: its code runs sandboxed with that node as kb.subject, and each call it makes is decided as the script's, within its grant (a canvas script writes with the ext.canvas verbs). Only a script a person has trusted on this machine runs. A run asks for approval: an agent's runs only once the person approves it.",
  mode: { kind: "write", approval: "required" },
  targets: ["subject", "script"],
  inputSchema: runInput,
  outputSchema: runOutput,
  effect: scriptRunEffect,
};
