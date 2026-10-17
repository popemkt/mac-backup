/**
 * `kb trace`, `kb suggest` and `kb relate`: the graph family's connection
 * reads and its typing write (DESIGN.md → Trace and suggest), as sugar over
 * the actions by the aliases every surface calls them by (`graph.trace`,
 * `graph.suggest`, `graph.relation.type`), as `kb backlinks` is over
 * `graph.query`. The CLI imports nothing of the family; it prints what the
 * actions answer.
 */
import type { Command } from "commander";
import { Effect, Predicate } from "effect";
import { onWire, type KbContext } from "@kb/contracts";
import { invokeReceiptEffect, writeErr } from "@kb/runtime";
import { toInt } from "./arguments.ts";
import { ACTION_INVOKE_WIRE, kbAction, report, type GlobalOpts } from "./command.ts";

const call = (ctx: KbContext, id: string, input: unknown) =>
  invokeReceiptEffect(ctx, onWire(ACTION_INVOKE_WIRE, { id, input }));

/** `--kinds mention,prop:<field>`: the comma list as the action's kinds; the action holds each to an edge kind. */
function kindsInput(kinds: string | undefined): { kinds?: string[] } {
  if (kinds === undefined) return {};
  return { kinds: kinds.split(",").flatMap((kind) => (kind.trim() === "" ? [] : [kind.trim()])) };
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function listOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(Predicate.isObject) : [];
}

/** Each path numbered, its hops one sentence a line; the reason when there is none. */
function traceLines(output: unknown): string[] {
  if (!Predicate.isObject(output)) return [];
  const paths = listOf(output.paths);
  if (paths.length === 0 && Predicate.isObject(output.reason))
    return [String(output.reason.message)];
  return paths.flatMap((path, i) => {
    const hops = listOf(path.hops);
    return [
      `${i + 1}. ${hops.length} hop${hops.length === 1 ? "" : "s"}`,
      ...hops.map((hop) => `   ${String(hop.sentence)}`),
    ];
  });
}

/** One suggestion a line: score, text and id, then the evidence. */
function suggestLines(output: unknown): string[] {
  if (!Predicate.isObject(output)) return [];
  const suggestions = listOf(output.suggestions);
  if (suggestions.length === 0) return ["(no suggestions)"];
  return suggestions.map((s) => {
    const reasons = Predicate.isObject(s.reasons) ? s.reasons : {};
    const evidence = [
      ["shared", strings(reasons.shared).length],
      ["tags", strings(reasons.tags).length],
      ["cited by", strings(reasons.citedBy).length],
    ].flatMap(([label, count]) => (count === 0 ? [] : [`${count} ${label}`]));
    const score = typeof s.score === "number" ? s.score.toFixed(2) : "?";
    return `${score}\t${String(s.text)}  [${String(s.id)}]\t${evidence.join(", ")}`;
  });
}

function relateLines(output: unknown): string[] {
  if (!Predicate.isObject(output)) return [];
  const what = `${String(output.source)} —${String(output.field)}→ ${String(output.target)}`;
  return [output.written === true ? `typed ${what}` : `already typed ${what}`];
}

const run = (
  ctx: KbContext,
  globals: GlobalOpts,
  id: string,
  input: unknown,
  lines: (output: unknown) => readonly string[],
) => Effect.map(call(ctx, id, input), (receipt) => report(receipt, globals, lines));

const KINDS_HELP = "comma list: mention, child, ref-prop, prop:<field id>";

export function relationCommands(program: Command): void {
  program
    .command("trace")
    .description("The shortest paths between <a> and <b>, each hop explained")
    .argument("<a>", "node id")
    .argument("<b>", "node id")
    .option("--kinds <kinds>", KINDS_HELP)
    .option("--k <n>", "how many paths (default 3)", toInt)
    .action(
      kbAction((ctx, globals, [from, to, opts]: [string, string, { kinds?: string; k?: number }]) =>
        Effect.gen(function* () {
          const input = {
            from,
            to,
            ...kindsInput(opts.kinds),
            ...(opts.k === undefined ? {} : { k: opts.k }),
          };
          const receipt = yield* call(ctx, "graph.trace", input);
          // What cut the walk short goes to stderr, as kb locations' warnings do.
          if (
            receipt.status === "succeeded" &&
            globals.json !== true &&
            Predicate.isObject(receipt.output)
          )
            for (const warning of strings(receipt.output.warnings)) writeErr(warning);
          return report(receipt, globals, traceLines);
        }),
      ),
    );

  program
    .command("suggest")
    .description("Nodes related to <id> by structure that nothing connects it to")
    .argument("<id>", "node id")
    .option("--kinds <kinds>", KINDS_HELP)
    .action(
      kbAction((ctx, globals, [id, opts]: [string, { kinds?: string }]) =>
        run(ctx, globals, "graph.suggest", { id, ...kindsInput(opts.kinds) }, suggestLines),
      ),
    );

  program
    .command("relate")
    .description("Type the relation <source> → <target> as the ref field <field>; the text stays")
    .argument("<source>", "node id")
    .argument("<target>", "node id")
    .argument("<field>", "ref field id")
    .action(
      kbAction((ctx, globals, [source, target, field]: [string, string, string]) =>
        run(ctx, globals, "graph.relation.type", { source, target, field }, relateLines),
      ),
    );
}
