#!/usr/bin/env bun
import { Command, CommanderError } from "commander";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { openKb, type KbContext } from "../context.ts";
import { ResolveError, resolveFieldId } from "../foundation/resolve.ts";
import { invoke } from "../registry.ts";
import type { ActionReceipt } from "../shared/contracts.ts";
import { filterSearchRows, formatReceipt } from "./format.ts";
import {
  fieldsNeedingCreate,
  mapActionInvoke,
  mapAdd,
  mapBacklinks,
  mapChildren,
  mapFieldDefine,
  mapFieldList,
  mapGet,
  mapMv,
  mapQuery,
  mapRm,
  mapRunQuery,
  mapSearch,
  mapSet,
  mapTagDefine,
  mapTagList,
  mapUnset,
  UsageError,
  type PlannedAction,
  type PropType,
} from "./map.ts";
import { resolveRoot, RootNotFoundError } from "./root.ts";

export {
  mapAdd,
  mapSet,
  mapUnset,
  mapGet,
  mapRm,
  mapMv,
  mapFieldDefine,
  mapTagDefine,
  mapFieldList,
  mapTagList,
  mapQuery,
  mapRunQuery,
  mapSearch,
  mapBacklinks,
  mapChildren,
  mapActionInvoke,
  parsePropArg,
  parsePropValue,
} from "./map.ts";

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

interface GlobalOpts {
  json?: boolean;
  root?: string;
}

function getGlobals(cmd: Command): GlobalOpts {
  const opts = cmd.optsWithGlobals() as GlobalOpts;
  return opts;
}

async function withCtx(
  cmd: Command,
  fn: (ctx: KbContext, globals: GlobalOpts) => Promise<number>,
  allowCreateRoot = false,
): Promise<number> {
  const globals = getGlobals(cmd);
  try {
    const root = await resolveRoot({
      root: globals.root,
      allowCreate: allowCreateRoot,
    });
    const ctx = await openKb(root);
    return await fn(ctx, globals);
  } catch (err) {
    return handleCliError(err, getGlobals(cmd).json === true);
  }
}

async function ensureFields(
  ctx: KbContext,
  plan: PlannedAction,
  create: boolean,
): Promise<ActionReceipt | null> {
  if (!create) return null;
  for (const name of fieldsNeedingCreate(plan)) {
    if (name.startsWith("sys.") || name === "type" || name === "fields") {
      continue;
    }
    try {
      resolveFieldId(ctx.nodes, name);
    } catch (err) {
      if (err instanceof ResolveError && err.code === "not_found") {
        const receipt = await invoke(ctx, {
          id: "field.define",
          input: { name },
        });
        if (receipt.status === "failed") return receipt;
      } else {
        throw err;
      }
    }
  }
  return null;
}

function stripInternalInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const copy = { ...(input as Record<string, unknown>) };
  delete copy._searchFilter;
  return copy;
}

async function runPlan(
  ctx: KbContext,
  plan: PlannedAction,
  globals: GlobalOpts,
  opts: { create?: boolean; command?: string; searchFilter?: string } = {},
): Promise<number> {
  const created = await ensureFields(ctx, plan, opts.create === true);
  if (created && created.status === "failed") {
    writeOut(formatReceipt(created, { json: globals.json === true }));
    return EXIT_FAILED;
  }

  const receipt = await invoke(ctx, {
    id: plan.id,
    input: stripInternalInput(plan.input),
  });

  let toFormat = receipt;
  if (
    receipt.status === "succeeded" &&
    opts.searchFilter !== undefined &&
    receipt.output &&
    typeof receipt.output === "object"
  ) {
    const rows = filterSearchRows(
      (receipt.output as { rows: unknown }).rows,
      opts.searchFilter,
    );
    toFormat = {
      ...receipt,
      output: { rows },
    };
  }

  writeOut(
    formatReceipt(toFormat, {
      json: globals.json === true,
      command: opts.command,
    }),
  );
  return toFormat.status === "succeeded" ? EXIT_OK : EXIT_FAILED;
}

function writeOut(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

function handleCliError(err: unknown, json: boolean): number {
  if (err instanceof UsageError || err instanceof RootNotFoundError) {
    const msg = err.message;
    if (json) {
      writeOut(
        JSON.stringify({
          status: "failed",
          code: "invalid_input",
          message: msg,
        }),
      );
    } else {
      process.stderr.write(`${msg}\n`);
    }
    return EXIT_USAGE;
  }
  if (err instanceof CommanderError) {
    if (err.code === "commander.helpDisplayed") return EXIT_OK;
    if (err.code === "commander.version") return EXIT_OK;
    process.stderr.write(`${err.message}\n`);
    return EXIT_USAGE;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (json) {
    writeOut(
      JSON.stringify({ status: "failed", code: "internal", message }),
    );
  } else {
    process.stderr.write(`${message}\n`);
  }
  return EXIT_FAILED;
}

async function readActionJson(arg: string): Promise<unknown> {
  if (arg === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (!text) throw new UsageError("action-invoke: empty stdin");
    return JSON.parse(text);
  }
  return JSON.parse(arg);
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("kb")
    .description("Repo-native outliner datastore")
    .version("0.1.0")
    .option("--json", "machine-readable JSON output", false)
    .option("--root <path>", "repo root containing .kb/")
    .exitOverride()
    .showHelpAfterError(false);

  program
    .command("mcp")
    .description("Serve the kb MCP server on stdio")
    .action(async function (this: Command) {
      const { startMcp } = await import("./mcp.ts");
      const globals = this.optsWithGlobals() as { root?: string };
      const root = await resolveRoot({ root: globals.root });
      await startMcp(root);
      // keep the process alive; the transport owns stdio from here
      await new Promise(() => {});
    });

  program
    .command("init")
    .description("Initialize .kb/ at --root or cwd")
    .action(async function (this: Command) {
      const code = await withCtx(
        this,
        async (ctx, globals) => {
          await mkdir(join(ctx.root, ".kb", "queries"), { recursive: true });
          const msg = globals.json
            ? JSON.stringify({
                status: "succeeded",
                id: "init",
                output: { root: ctx.root },
              })
            : `initialized ${join(ctx.root, ".kb")}`;
          writeOut(msg);
          return EXIT_OK;
        },
        true,
      );
      process.exitCode = code;
    });

  program
    .command("add")
    .description("Create a node")
    .argument("<text>", "node text")
    .option("--parent <id>", "parent node id")
    .option("--position <n>", "child index", (v) => Number.parseInt(v, 10))
    .option("--tag <name>", "tag name (repeatable)", collect, [])
    .option("--prop <field=value>", "prop (repeatable)", collect, [])
    .option("--id <id>", "explicit node id")
    .option("--create", "mint missing fields", false)
    .action(async function (this: Command, text: string, opts) {
      const code = await withCtx(this, async (ctx, globals) => {
        const plan = mapAdd({
          text,
          parent: opts.parent,
          position: opts.position,
          tags: opts.tag,
          props: opts.prop,
          id: opts.id,
        });
        return runPlan(ctx, plan, globals, { create: opts.create === true });
      });
      process.exitCode = code;
    });

  program
    .command("set")
    .description("Set a property on a node")
    .argument("<id>", "node id")
    .argument("<field>", "field name or id")
    .argument("<value>", "value")
    .option("--type <t>", "str|num|bool|date|ref")
    .option("--create", "mint missing field", false)
    .action(async function (
      this: Command,
      id: string,
      field: string,
      value: string,
      opts,
    ) {
      const code = await withCtx(this, async (ctx, globals) => {
        const plan = mapSet({
          id,
          field,
          value,
          type: opts.type as PropType | undefined,
        });
        return runPlan(ctx, plan, globals, { create: opts.create === true });
      });
      process.exitCode = code;
    });

  program
    .command("unset")
    .description("Unset a property on a node")
    .argument("<id>", "node id")
    .argument("<field>", "field name or id")
    .argument("[value]", "specific value to remove")
    .option("--type <t>", "str|num|bool|date|ref")
    .action(async function (
      this: Command,
      id: string,
      field: string,
      value: string | undefined,
      opts,
    ) {
      const code = await withCtx(this, async (ctx, globals) => {
        const plan = mapUnset({
          id,
          field,
          value,
          type: opts.type as PropType | undefined,
        });
        return runPlan(ctx, plan, globals);
      });
      process.exitCode = code;
    });

  program
    .command("get")
    .description("Pull a node subtree")
    .argument("<id>", "node id")
    .option("--depth <n>", "pull depth", (v) => Number.parseInt(v, 10), 1)
    .action(async function (this: Command, id: string, opts) {
      const code = await withCtx(this, async (ctx, globals) => {
        return runPlan(ctx, mapGet({ id, depth: opts.depth }), globals);
      });
      process.exitCode = code;
    });

  program
    .command("rm")
    .description("Delete a node")
    .argument("<id>", "node id")
    .action(async function (this: Command, id: string) {
      const code = await withCtx(this, async (ctx, globals) => {
        return runPlan(ctx, mapRm({ id }), globals);
      });
      process.exitCode = code;
    });

  program
    .command("mv")
    .description("Move a node under a new parent (use --root-parent to detach)")
    .argument("<id>", "node id")
    .argument("[parent]", "new parent id")
    .option("--position <n>", "child index", (v) => Number.parseInt(v, 10))
    .option("--root-parent", "detach from parent", false)
    .action(async function (this: Command, id: string, parent: string | undefined, opts) {
      const code = await withCtx(this, async (ctx, globals) => {
        if (!opts.rootParent && parent === undefined) {
          throw new UsageError("mv requires <parent> or --root-parent");
        }
        const plan = mapMv({
          id,
          parent: opts.rootParent ? null : parent!,
          position: opts.position,
        });
        return runPlan(ctx, plan, globals);
      });
      process.exitCode = code;
    });

  const field = program.command("field").description("Field operations");
  field
    .command("define")
    .description("Mint a field node")
    .argument("<name>", "field name")
    .option("--id <id>", "explicit id")
    .action(async function (this: Command, name: string, opts) {
      const code = await withCtx(this, async (ctx, globals) => {
        return runPlan(ctx, mapFieldDefine({ name, id: opts.id }), globals);
      });
      process.exitCode = code;
    });
  field
    .command("list")
    .description("List field nodes")
    .action(async function (this: Command) {
      const code = await withCtx(this, async (ctx, globals) => {
        return runPlan(ctx, mapFieldList(), globals);
      });
      process.exitCode = code;
    });

  const tag = program.command("tag").description("Tag operations");
  tag
    .command("define")
    .description("Mint a tag node")
    .argument("<name>", "tag name")
    .option("--id <id>", "explicit id")
    .option("--field <name>", "templated field (repeatable)", collect, [])
    .action(async function (this: Command, name: string, opts) {
      const code = await withCtx(this, async (ctx, globals) => {
        return runPlan(
          ctx,
          mapTagDefine({ name, id: opts.id, fields: opts.field }),
          globals,
        );
      });
      process.exitCode = code;
    });
  tag
    .command("list")
    .description("List tag nodes")
    .action(async function (this: Command) {
      const code = await withCtx(this, async (ctx, globals) => {
        return runPlan(ctx, mapTagList(), globals);
      });
      process.exitCode = code;
    });

  program
    .command("query")
    .description("Run a raw EDN datalog query")
    .argument("<edn>", "EDN query string")
    .action(async function (this: Command, edn: string) {
      const code = await withCtx(this, async (ctx, globals) => {
        return runPlan(ctx, mapQuery({ query: edn }), globals);
      });
      process.exitCode = code;
    });

  program
    .command("run")
    .description("Execute a saved query from .kb/queries/<name>.edn")
    .argument("<name>", "saved query name (without .edn)")
    .action(async function (this: Command, name: string) {
      const code = await withCtx(this, async (ctx, globals) => {
        if (!/^[\w][\w.-]*$/.test(name)) {
          throw new UsageError(
            `invalid saved query name: ${name} (letters, digits, ., _, - only)`,
          );
        }
        const path = join(ctx.root, ".kb", "queries", `${name}.edn`);
        let edn: string;
        try {
          edn = await readFile(path, "utf8");
        } catch {
          throw new UsageError(`saved query not found: ${path}`);
        }
        return runPlan(ctx, mapRunQuery(edn), globals);
      });
      process.exitCode = code;
    });

  program
    .command("search")
    .description("Search node text (substring)")
    .argument("<text>", "search text")
    .action(async function (this: Command, text: string) {
      const code = await withCtx(this, async (ctx, globals) => {
        return runPlan(ctx, mapSearch(text), globals, {
          command: "search",
          searchFilter: text,
        });
      });
      process.exitCode = code;
    });

  program
    .command("backlinks")
    .description("Nodes that mention <id>")
    .argument("<id>", "node id")
    .action(async function (this: Command, id: string) {
      const code = await withCtx(this, async (ctx, globals) => {
        return runPlan(ctx, mapBacklinks(id), globals);
      });
      process.exitCode = code;
    });

  program
    .command("children")
    .description("Direct children of a node")
    .argument("<id>", "node id")
    .action(async function (this: Command, id: string) {
      const code = await withCtx(this, async (ctx, globals) => {
        return runPlan(ctx, mapChildren(id), globals, { command: "children" });
      });
      process.exitCode = code;
    });

  program
    .command("action-invoke")
    .description('Raw registry invoke: JSON {"id","input"} or "-" for stdin')
    .argument("<json>", 'JSON object or "-"')
    .action(async function (this: Command, jsonArg: string) {
      const code = await withCtx(this, async (ctx, globals) => {
        let raw: unknown;
        try {
          raw = await readActionJson(jsonArg);
        } catch (err) {
          if (err instanceof SyntaxError) {
            throw new UsageError(`invalid JSON: ${err.message}`);
          }
          throw err;
        }
        const invocation = mapActionInvoke(raw);
        const receipt = await invoke(ctx, invocation);
        writeOut(
          formatReceipt(receipt, { json: globals.json === true }),
        );
        return receipt.status === "succeeded" ? EXIT_OK : EXIT_FAILED;
      });
      process.exitCode = code;
    });

  return program;
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export async function main(argv: string[] = process.argv): Promise<number> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
    return process.exitCode ?? EXIT_OK;
  } catch (err) {
    const json = argv.includes("--json");
    const code = handleCliError(err, json);
    process.exitCode = code;
    return code;
  }
}

if (import.meta.main) {
  const code = await main();
  process.exit(code);
}
