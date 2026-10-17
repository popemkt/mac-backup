/**
 * `kb locations` and `kb open`: the kb roots the person has opened, kept in
 * their home store by the locations family (DESIGN.md → Locations). Each
 * command invokes the family's actions by the aliases every surface calls
 * them by (`location.list`, `location.register`, `location.forget`,
 * `location.open`), so the CLI imports nothing of the family, and prints
 * what they answer.
 */
import { resolve } from "node:path";
import type { Command } from "commander";
import { Effect, Predicate } from "effect";
import { onWire, type ActionReceipt, type KbContext } from "@kb/contracts";
import { invokeReceiptEffect, writeErr, writeOut, type ActionHandlerEnv } from "@kb/runtime";
import { EXIT_FAILED, EXIT_OK, kbAction, ACTION_INVOKE_WIRE, type GlobalOpts } from "./command.ts";
import { formatReceipt } from "./format.ts";

/** One location row as printed: its fields read loosely, since the action's schema is the family's. */
interface PrintedRow {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly status: string;
  readonly current: boolean;
  readonly url?: string;
  readonly reason?: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function printedRow(value: unknown): PrintedRow | null {
  if (!Predicate.isObject(value)) return null;
  return {
    id: text(value.id),
    label: text(value.label),
    path: text(value.path),
    status: text(value.status),
    current: value.current === true,
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
  };
}

function rowsOf(output: unknown): PrintedRow[] {
  if (!Predicate.isObject(output) || !Array.isArray(output.rows)) return [];
  return output.rows.flatMap((row: unknown) => printedRow(row) ?? []);
}

function warningsOf(output: unknown): string[] {
  if (!Predicate.isObject(output) || !Array.isArray(output.warnings)) return [];
  return output.warnings.filter((warning: unknown) => typeof warning === "string");
}

/** A row as one line: `*` on the current root, then label, status, path, and the URL or the reason. */
function rowLine(row: PrintedRow): string {
  const tail = row.url ?? row.reason;
  return [
    `${row.current ? "*" : " "} ${row.label}`,
    row.status,
    row.path,
    ...(tail === undefined ? [] : [tail]),
  ].join("\t");
}

const call = (ctx: KbContext, id: string, input: unknown) =>
  invokeReceiptEffect(ctx, onWire(ACTION_INVOKE_WIRE, { id, input }));

/** Print a receipt: JSON as is under --json; else `lines` of its output, or the failure. */
function report(
  receipt: ActionReceipt,
  globals: GlobalOpts,
  lines: (output: unknown) => readonly string[],
): number {
  if (globals.json === true || receipt.status === "failed") {
    writeOut(formatReceipt(receipt, { json: globals.json === true }));
    return receipt.status === "succeeded" ? EXIT_OK : EXIT_FAILED;
  }
  for (const line of lines(receipt.output)) writeOut(line);
  return EXIT_OK;
}

/**
 * The location `target` names: its id, else its one label, else its path.
 * A refusal is a receipt of `action`, the call the target was for.
 */
const findLocation = Effect.fn("kb.cli.locations.find")(function* (
  ctx: KbContext,
  target: string,
  action: string,
): Effect.fn.Return<{ id: string } | { refused: ActionReceipt }, never, ActionHandlerEnv> {
  const listed = yield* call(ctx, "location.list", {});
  if (listed.status === "failed") return { refused: listed };
  const rows = rowsOf(listed.output);
  const byId = rows.find((row) => row.id === target);
  if (byId !== undefined) return { id: byId.id };
  const byLabel = rows.filter((row) => row.label === target);
  const byPath = rows.filter((row) => row.path !== "" && row.path === resolve(target));
  const found = byLabel.length > 0 ? byLabel : byPath;
  const [only] = found;
  if (only !== undefined && found.length === 1) return { id: only.id };
  return {
    refused: {
      status: "failed",
      id: action,
      code: found.length > 1 ? "ambiguous" : "not_found",
      message:
        found.length > 1
          ? `${target} names ${found.length} locations; give one's id: ${found.map((row) => row.id).join(", ")}`
          : `no location is named ${target}, by id, label or path`,
    },
  };
});

export function locationCommands(program: Command): void {
  const locations = program
    .command("locations")
    .description("The kb roots you have opened, kept in your home store");

  locations
    .command("list", { isDefault: true })
    .description("List them: label, status (served, closed, missing, not-a-store), path, URL")
    .action(
      kbAction((ctx, globals) =>
        Effect.gen(function* () {
          const receipt = yield* call(ctx, "location.list", {});
          if (receipt.status === "succeeded" && globals.json !== true)
            for (const warning of warningsOf(receipt.output)) writeErr(warning);
          return report(receipt, globals, (output) => rowsOf(output).map(rowLine));
        }),
      ),
    );

  locations
    .command("add")
    .description("Add a kb root to them (default: this one) and rank it first")
    .argument("[path]", "the root's directory")
    .option("--label <text>", "what it is listed as (default: its directory's name)")
    .action(
      kbAction((ctx, globals, [path, opts]: [string | undefined, { label?: string }]) =>
        Effect.gen(function* () {
          const input = {
            path: path === undefined ? ctx.root : resolve(path),
            ...(opts.label === undefined ? {} : { label: opts.label }),
          };
          const receipt = yield* call(ctx, "location.register", input);
          return report(receipt, globals, (output) => {
            const row = printedRow(output);
            return row === null ? [] : [rowLine(row)];
          });
        }),
      ),
    );

  locations
    .command("forget")
    .description("Remove one from them; its directory is never touched")
    .argument("<location>", "its id, label or path")
    .action(
      kbAction((ctx, globals, [target]: [string]) =>
        Effect.gen(function* () {
          const found = yield* findLocation(ctx, target, "location.forget");
          if ("refused" in found) return report(found.refused, globals, () => []);
          const receipt = yield* call(ctx, "location.forget", { id: found.id });
          return report(receipt, globals, (output) =>
            Predicate.isObject(output)
              ? [`forgot ${text(output.label)}  ${text(output.path)}`]
              : [],
          );
        }),
      ),
    );

  program
    .command("open")
    .description("Open a location in the browser, starting a kb ui for it when none serves it")
    .argument(
      "[location]",
      "its id, label or path (default: your home store, the picker as a page)",
    )
    .option("--no-browser", "print the URL only")
    .action(
      kbAction((ctx, globals, [target, opts]: [string | undefined, { browser?: boolean }]) =>
        Effect.gen(function* () {
          const input = yield* openInput(ctx, target);
          if ("refused" in input) return report(input.refused, globals, () => []);
          const receipt = yield* call(ctx, "location.open", input);
          const url =
            receipt.status === "succeeded" && Predicate.isObject(receipt.output)
              ? text(receipt.output.url)
              : "";
          if (url !== "" && globals.json !== true && opts.browser !== false) {
            const { openBrowser } = yield* Effect.promise(() => import("@kb/server"));
            openBrowser(url);
          }
          return report(receipt, globals, () => [url]);
        }),
      ),
    );
}

/** What `kb open <target>` asks to open: a location it names, else the path it is; nothing names the home store. */
const openInput = Effect.fn("kb.cli.open.input")(function* (
  ctx: KbContext,
  target: string | undefined,
): Effect.fn.Return<
  | { readonly id: string }
  | { readonly path: string }
  | Record<string, never>
  | { refused: ActionReceipt },
  never,
  ActionHandlerEnv
> {
  if (target === undefined) return {};
  const found = yield* findLocation(ctx, target, "location.open");
  if ("id" in found) return { id: found.id };
  return found.refused.status === "failed" && found.refused.code === "not_found"
    ? { path: resolve(target) }
    : found;
});
