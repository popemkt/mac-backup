#!/usr/bin/env bun
import { Command, CommanderError } from "commander";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import { UI_DEFAULT_PORT, type KbContext, type ActionReceipt } from "@kb/contracts";
import {
  kbRuntimeLayer,
  openKbEffect,
  invokeReceiptEffect,
  registryFor,
  type ActionHandlerEnv,
  resolveRootEffect,
  RootNotFoundError,
  writeOut,
  writeErr,
} from "@kb/runtime";
import { bunFileSystemLayer } from "@kb/store-jsonl";
import { exampleSeedNodes, isPristine } from "@kb/model";
import { SYSTEM_IDS, currentIso, isSysPrefixed } from "@kb/model";
import {
  type DomainError,
  ResolveError,
  ensureDomainError,
  isDomainError,
  receiptCodeOf,
  resolveFieldId,
  resolveTagId,
} from "@kb/model";
import { KB_SDK_VERSION, readEmbeddedSdkDts, writeSdkDts } from "@kb/ext-sdk";
import { formatReceipt } from "./format.ts";
import {
  fieldsNeedingCreate,
  mapActionInvoke,
  mapAdd,
  mapBacklinks,
  mapChildren,
  mapFieldDefine,
  mapFieldList,
  mapFieldTarget,
  mapFieldTargetQuery,
  mapFieldType,
  mapGet,
  mapMv,
  mapOntologyList,
  mapOntologyMembers,
  mapQuery,
  mapRm,
  mapRun,
  mapSearch,
  mapSet,
  mapTagDefine,
  mapTagList,
  mapUnset,
  UsageError,
  type PlannedAction,
  type PropType,
} from "@kb/operations";

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

/**
 * Open a kb session and run a command Effect with {@link kbRuntimeLayer}.
 * Single `Effect.runPromise` boundary for Commander actions.
 */
function withCtx(
  cmd: Command,
  body: (ctx: KbContext, globals: GlobalOpts) => Effect.Effect<number, unknown, ActionHandlerEnv>,
  allowCreateRoot = false,
): Promise<number> {
  const globals = getGlobals(cmd);
  return Effect.runPromise(
    Effect.gen(function* () {
      const root = yield* resolveRootEffect({
        root: globals.root,
        allowCreate: allowCreateRoot,
      });
      const ctx = yield* openKbEffect(root);
      return yield* body(ctx, globals).pipe(Effect.provide(kbRuntimeLayer(ctx)));
    }).pipe(Effect.provide(bunFileSystemLayer)),
  ).catch((err) => handleCliError(err, globals.json === true));
}

function ensureFieldsEffect(
  ctx: KbContext,
  plan: PlannedAction,
  create: boolean,
): Effect.Effect<ActionReceipt | null, DomainError, ActionHandlerEnv> {
  return Effect.gen(function* () {
    if (!create) return null;
    for (const name of fieldsNeedingCreate(plan)) {
      if (isSysPrefixed(name) || name === "type" || name === "fields") {
        continue;
      }
      const outcome = yield* Effect.try({
        try: () => {
          resolveFieldId(ctx.nodes, name);
          return "ok" as const;
        },
        catch: (err) => ensureDomainError(err),
      }).pipe(
        Effect.catchIf(
          (err) => err.code === "not_found",
          () => Effect.succeed("missing" as const),
        ),
      );
      if (outcome !== "missing") continue;
      const receipt = yield* invokeReceiptEffect(ctx, {
        id: "field.define",
        input: { name },
      });
      if (receipt.status === "failed") return receipt;
    }
    return null;
  });
}

/** Run a planned registry action and write formatted stdout. */
export function runPlanEffect(
  ctx: KbContext,
  plan: PlannedAction,
  globals: GlobalOpts,
  opts: { create?: boolean; command?: string } = {},
): Effect.Effect<number, Error, ActionHandlerEnv> {
  return Effect.gen(function* () {
    const created = yield* ensureFieldsEffect(ctx, plan, opts.create === true);
    if (created && created.status === "failed") {
      writeOut(formatReceipt(created, { json: globals.json === true }));
      return EXIT_FAILED;
    }

    const receipt = yield* invokeReceiptEffect(ctx, {
      id: plan.id,
      input: plan.input,
    });

    writeOut(
      formatReceipt(receipt, {
        json: globals.json === true,
        command: opts.command,
      }),
    );
    return receipt.status === "succeeded" ? EXIT_OK : EXIT_FAILED;
  });
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
      writeErr(msg);
    }
    return EXIT_USAGE;
  }
  if (err instanceof ResolveError) {
    // Domain lookup/move failures (unknown field/tag, ambiguous, forbidden,
    // invalid move) surface as typed receipts — never `internal`.
    const msg = err.message;
    if (json) {
      writeOut(
        JSON.stringify({
          status: "failed",
          code: receiptCodeOf(err),
          message: msg,
        }),
      );
    } else {
      writeErr(msg);
    }
    return EXIT_FAILED;
  }
  if (isDomainError(err)) {
    const msg = err.message;
    if (json) {
      writeOut(
        JSON.stringify({
          status: "failed",
          code: receiptCodeOf(err),
          message: msg,
        }),
      );
    } else {
      writeErr(msg);
    }
    return EXIT_FAILED;
  }
  if (err instanceof CommanderError) {
    if (err.code === "commander.helpDisplayed") return EXIT_OK;
    if (err.code === "commander.version") return EXIT_OK;
    writeErr(err.message);
    return EXIT_USAGE;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (json) {
    writeOut(JSON.stringify({ status: "failed", code: "internal", message }));
  } else {
    writeErr(message);
  }
  return EXIT_FAILED;
}

/**
 * Parse action-invoke JSON text with native JSON.parse diagnostics, then leave
 * structural/action Schema validation to mapActionInvoke + invokeReceiptEffect.
 */
function parseActionJson(text: string): Effect.Effect<unknown, UsageError> {
  return Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (err) =>
      err instanceof SyntaxError
        ? new UsageError(`invalid JSON: ${err.message}`)
        : new UsageError(`invalid JSON: ${err instanceof Error ? err.message : String(err)}`),
  });
}

/**
 * Read action-invoke JSON from an argv blob or stdin ("-").
 * Empty stdin → UsageError (exit 2). Genuine stdin I/O failures stay plain
 * Error (exit 1), matching pre-Effect CLI behavior.
 */
function readActionJsonEffect(arg: string): Effect.Effect<unknown, UsageError | Error> {
  if (arg === "-") {
    return Effect.gen(function* () {
      const text = yield* Effect.tryPromise({
        try: async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          return Buffer.concat(chunks).toString("utf8").trim();
        },
        catch: (err) => (err instanceof Error ? err : new Error(String(err))),
      });
      if (!text) {
        return yield* Effect.fail(new UsageError("action-invoke: empty stdin"));
      }
      return yield* parseActionJson(text);
    });
  }
  return parseActionJson(arg);
}

function buildProgram(): Command {
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
      const { startMcp } = await import("@kb/mcp");
      const globals = this.optsWithGlobals() as { root?: string };
      const root = await Effect.runPromise(
        resolveRootEffect({ root: globals.root }).pipe(Effect.provide(bunFileSystemLayer)),
      );
      await startMcp(root);
      // keep the process alive; the transport owns stdio from here
      await new Promise(() => {});
    });

  program
    .command("ui")
    .description("Serve the kb browser UI + subscription backend")
    .option("--port <n>", "backend listen port (default 4321)", (v) => Number.parseInt(v, 10))
    .option("--dev", "spawn the Vite dev server (HMR) and proxy to the backend", false)
    .option("--dev-port <n>", "Vite dev server port (default 5173)", (v) => Number.parseInt(v, 10))
    .option("--no-open", "do not open a browser")
    .action(async function (this: Command) {
      const { runUiCli } = await import("@kb/server");
      const globals = this.optsWithGlobals() as { root?: string };
      const opts = this.opts() as {
        port?: number;
        dev?: boolean;
        devPort?: number;
        open?: boolean;
      };
      const root = await Effect.runPromise(
        resolveRootEffect({ root: globals.root }).pipe(Effect.provide(bunFileSystemLayer)),
      );
      await runUiCli({
        root,
        port: opts.port ?? UI_DEFAULT_PORT,
        openBrowser: opts.open !== false,
        dev: opts.dev === true,
        devPort: opts.devPort,
      });
    });

  program
    .command("init")
    .description("Initialize .kb/ at --root or cwd")
    .option("--bare", "skip the example content (supertags, fields, query, ontologies)")
    .action(async function (this: Command, opts: { bare?: boolean }) {
      const code = await withCtx(
        this,
        (ctx, globals) =>
          Effect.gen(function* () {
            const fs = yield* FileSystem;
            yield* fs
              .makeDirectory(join(ctx.root, ".kb", "queries"), {
                recursive: true,
              })
              .pipe(
                Effect.mapError(
                  (err) => new Error(err instanceof Error ? err.message : String(err)),
                ),
              );

            /*
             * Example content lands here rather than in the system seed on
             * purpose: the seed runs on every open and is write-guarded, so
             * demo nodes there would come back after you deleted them and no
             * test fixture could avoid them. Init runs once, by choice, and
             * only fills a store nobody has put anything into yet.
             */
            let examples = 0;
            if (opts.bare !== true && isPristine(ctx.nodes)) {
              const nodes = exampleSeedNodes(yield* currentIso);
              yield* ctx.effectStore.commitEffect({
                upserts: nodes,
                deletes: [],
              });
              ctx.nodes = [...ctx.nodes, ...nodes];
              examples = nodes.length;
            }

            const msg =
              globals.json === true
                ? JSON.stringify({
                    status: "succeeded",
                    id: "init",
                    output: { root: ctx.root, exampleNodes: examples },
                  })
                : examples > 0
                  ? `initialized ${join(ctx.root, ".kb")} with ${examples} example nodes (ordinary nodes — delete any of them)`
                  : `initialized ${join(ctx.root, ".kb")}`;
            writeOut(msg);
            return EXIT_OK;
          }),
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
    .option("--force", "allow minting or parenting under sys.* nodes", false)
    .action(async function (this: Command, text: string, opts) {
      const code = await withCtx(this, (ctx, globals) =>
        runPlanEffect(
          ctx,
          mapAdd({
            text,
            parent: opts.parent,
            position: opts.position,
            tags: opts.tag,
            props: opts.prop,
            id: opts.id,
            force: opts.force === true,
          }),
          globals,
          { create: opts.create === true },
        ),
      );
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
    .option("--force", "allow edits on sys.* nodes", false)
    .action(async function (this: Command, id: string, field: string, value: string, opts) {
      const code = await withCtx(this, (ctx, globals) =>
        runPlanEffect(
          ctx,
          mapSet({
            id,
            field,
            value,
            type: opts.type as PropType | undefined,
            force: opts.force === true,
          }),
          globals,
          { create: opts.create === true },
        ),
      );
      process.exitCode = code;
    });

  program
    .command("unset")
    .description("Unset a property on a node")
    .argument("<id>", "node id")
    .argument("<field>", "field name or id")
    .argument("[value]", "specific value to remove")
    .option("--type <t>", "str|num|bool|date|ref")
    .option("--force", "allow edits on sys.* nodes", false)
    .action(async function (
      this: Command,
      id: string,
      field: string,
      value: string | undefined,
      opts,
    ) {
      const code = await withCtx(this, (ctx, globals) =>
        runPlanEffect(
          ctx,
          mapUnset({
            id,
            field,
            value,
            type: opts.type as PropType | undefined,
            force: opts.force === true,
          }),
          globals,
        ),
      );
      process.exitCode = code;
    });

  program
    .command("get")
    .description("Pull a node subtree")
    .argument("<id>", "node id")
    .option("--depth <n>", "pull depth", (v) => Number.parseInt(v, 10), 1)
    .action(async function (this: Command, id: string, opts) {
      const code = await withCtx(this, (ctx, globals) =>
        runPlanEffect(ctx, mapGet({ id, depth: opts.depth }), globals),
      );
      process.exitCode = code;
    });

  program
    .command("rm")
    .description("Delete a node")
    .argument("<id>", "node id")
    .option("--force", "allow deleting sys.* nodes", false)
    .action(async function (this: Command, id: string, opts) {
      const code = await withCtx(this, (ctx, globals) =>
        runPlanEffect(ctx, mapRm({ id, force: opts.force === true }), globals),
      );
      process.exitCode = code;
    });

  program
    .command("mv")
    .description("Move a node under a new parent (use --root-parent to detach)")
    .argument("<id>", "node id")
    .argument("[parent]", "new parent id")
    .option("--position <n>", "child index", (v) => Number.parseInt(v, 10))
    .option("--root-parent", "detach from parent", false)
    .option("--force", "allow moving under sys.* parents", false)
    .action(async function (this: Command, id: string, parent: string | undefined, opts) {
      const code = await withCtx(this, (ctx, globals) =>
        Effect.gen(function* () {
          const parentArg = opts.rootParent === true ? null : parent;
          if (parentArg === undefined) {
            return yield* Effect.fail(new UsageError("mv requires <parent> or --root-parent"));
          }
          return yield* runPlanEffect(
            ctx,
            mapMv({
              id,
              parent: parentArg,
              position: opts.position,
              force: opts.force === true,
            }),
            globals,
          );
        }),
      );
      process.exitCode = code;
    });

  const field = program.command("field").description("Field operations");
  field
    .command("define")
    .description("Mint a field node")
    .argument("<name>", "field name")
    .option("--id <id>", "explicit id")
    .action(async function (this: Command, name: string, opts) {
      const code = await withCtx(this, (ctx, globals) =>
        runPlanEffect(ctx, mapFieldDefine({ name, id: opts.id }), globals),
      );
      process.exitCode = code;
    });
  field
    .command("list")
    .description("List field nodes")
    .action(async function (this: Command) {
      const code = await withCtx(this, (ctx, globals) =>
        runPlanEffect(ctx, mapFieldList(), globals),
      );
      process.exitCode = code;
    });
  field
    .command("type")
    .description("Set sys.f.fieldType on a field (text|number|date|url|checkbox|ref)")
    .argument("<field>", "field name or id")
    .argument("<type>", "field type")
    .action(async function (this: Command, fieldName: string, type: string) {
      const code = await withCtx(this, (ctx, globals) =>
        Effect.gen(function* () {
          const fieldId = resolveFieldId(ctx.nodes, fieldName);
          const node = ctx.nodes.find((n) => n.id === fieldId);
          // Props are multi-valued and set appends, so the prior value has to
          // be unset explicitly — whichever form it was stored in.
          const previous = node?.props[SYSTEM_IDS.fieldTypeField]?.[0];
          return yield* runPlanEffect(ctx, mapFieldType({ fieldId, type, previous }), globals);
        }),
      );
      process.exitCode = code;
    });
  field
    .command("target")
    .description("Add sys.f.targetTag constraint (union) on a ref field")
    .argument("<field>", "field name or id")
    .argument("<tag>", "tag name or id")
    .action(async function (this: Command, fieldName: string, tag: string) {
      const code = await withCtx(this, (ctx, globals) =>
        Effect.gen(function* () {
          const fieldId = resolveFieldId(ctx.nodes, fieldName);
          const tagId = resolveTagId(ctx.nodes, tag);
          return yield* runPlanEffect(ctx, mapFieldTarget({ fieldId, tagId }), globals);
        }),
      );
      process.exitCode = code;
    });
  field
    .command("target-query")
    .description("Set sys.f.targetQuery EDN constraint (wins over targetTag)")
    .argument("<field>", "field name or id")
    .argument("<edn>", "datalog EDN returning allowed node ids")
    .action(async function (this: Command, fieldName: string, edn: string) {
      const code = await withCtx(this, (ctx, globals) =>
        Effect.gen(function* () {
          const fieldId = resolveFieldId(ctx.nodes, fieldName);
          const node = ctx.nodes.find((n) => n.id === fieldId);
          const prev = node?.props[SYSTEM_IDS.targetQueryField]?.[0];
          const previous = prev?.t === "str" ? { t: "str" as const, v: prev.v } : undefined;
          return yield* runPlanEffect(
            ctx,
            mapFieldTargetQuery({ fieldId, edn, previous }),
            globals,
          );
        }),
      );
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
      const code = await withCtx(this, (ctx, globals) =>
        runPlanEffect(ctx, mapTagDefine({ name, id: opts.id, fields: opts.field }), globals),
      );
      process.exitCode = code;
    });
  tag
    .command("list")
    .description("List tag nodes")
    .action(async function (this: Command) {
      const code = await withCtx(this, (ctx, globals) => runPlanEffect(ctx, mapTagList(), globals));
      process.exitCode = code;
    });

  const ontology = program.command("ontology").description("Ontology operations (#ontology nodes)");
  ontology
    .command("list")
    .description("List #ontology nodes")
    .action(async function (this: Command) {
      const code = await withCtx(this, (ctx, globals) =>
        runPlanEffect(ctx, mapOntologyList(), globals),
      );
      process.exitCode = code;
    });
  ontology
    .command("members")
    .description("Resolve an ontology's members (tags + pins + query + extends)")
    .argument("<id>", "ontology node id")
    .option("--reasons", "include per-member provenance")
    .action(async function (this: Command, id: string, opts) {
      const code = await withCtx(this, (ctx, globals) =>
        runPlanEffect(ctx, mapOntologyMembers({ id, reasons: opts.reasons === true }), globals),
      );
      process.exitCode = code;
    });

  program
    .command("query")
    .description("Run a raw EDN datalog query")
    .argument("<edn>", "EDN query string")
    .action(async function (this: Command, edn: string) {
      const code = await withCtx(this, (ctx, globals) =>
        runPlanEffect(ctx, mapQuery({ query: edn }), globals),
      );
      process.exitCode = code;
    });

  program
    .command("run")
    .description("Execute a saved query from .kb/queries/<name>.edn")
    .argument("<name>", "saved query name (without .edn)")
    .action(async function (this: Command, name: string) {
      const code = await withCtx(this, (ctx, globals) => runPlanEffect(ctx, mapRun(name), globals));
      process.exitCode = code;
    });

  program
    .command("search")
    .description("Search node text (case-insensitive substring)")
    .argument("<text>", "search text")
    .action(async function (this: Command, text: string) {
      const code = await withCtx(this, (ctx, globals) =>
        runPlanEffect(ctx, mapSearch(text), globals, { command: "search" }),
      );
      process.exitCode = code;
    });

  program
    .command("backlinks")
    .description("Nodes that mention <id>")
    .argument("<id>", "node id")
    .action(async function (this: Command, id: string) {
      const code = await withCtx(this, (ctx, globals) =>
        runPlanEffect(ctx, mapBacklinks(id), globals),
      );
      process.exitCode = code;
    });

  program
    .command("children")
    .description("Direct children of a node")
    .argument("<id>", "node id")
    .action(async function (this: Command, id: string) {
      const code = await withCtx(this, (ctx, globals) =>
        runPlanEffect(ctx, mapChildren(id), globals, { command: "children" }),
      );
      process.exitCode = code;
    });

  const ext = program.command("ext").description("Extension operations");
  ext
    .command("list")
    .description("List loaded extensions (bundled + .kb/extensions) and their actions")
    .action(async function (this: Command) {
      const code = await withCtx(this, (ctx, globals) =>
        Effect.gen(function* () {
          const registry = yield* Effect.tryPromise({
            try: () => registryFor(ctx.root),
            catch: (err) => (err instanceof Error ? err : new Error(String(err))),
          });
          if (globals.json === true) {
            writeOut(
              JSON.stringify({
                status: "succeeded",
                id: "ext.list",
                output: {
                  extensions: registry.extensions.map((e) => ({
                    name: e.name,
                    source: e.source,
                    actions: e.actions.map((a) => ({
                      id: a.def.id,
                      title: a.def.title,
                      mode: a.def.mode,
                      aliases: a.aliases,
                    })),
                  })),
                  failures: registry.failures,
                },
              }),
            );
            return EXIT_OK;
          }
          const lines: string[] = [];
          for (const e of registry.extensions) {
            lines.push(`${e.name} (${e.source})`);
            for (const a of e.actions) {
              const alias = a.aliases.length > 0 ? ` (alias: ${a.aliases.join(", ")})` : "";
              lines.push(`  ${a.def.id}${alias} — ${a.def.title} [${a.def.mode}]`);
            }
          }
          for (const f of registry.failures) {
            lines.push(`! ${f.file}: ${f.error} (skipped)`);
          }
          writeOut(lines.length > 0 ? lines.join("\n") : "no extensions loaded");
          return EXIT_OK;
        }),
      );
      process.exitCode = code;
    });
  ext
    .command("sdk")
    .description("Print or write the ambient extension SDK types (kb-ext-sdk) for this binary")
    .option("--write", "write .kb/sdk.d.ts under the resolved root", false)
    .action(async function (this: Command) {
      const globals = getGlobals(this);
      const write = this.opts().write === true;
      const code = await Effect.runPromise(
        Effect.gen(function* () {
          if (!write) {
            writeOut(readEmbeddedSdkDts());
            return EXIT_OK;
          }
          const root = yield* resolveRootEffect({
            root: globals.root,
            allowCreate: true,
          });
          const result = yield* Effect.tryPromise({
            try: () => writeSdkDts(root),
            catch: (err) => (err instanceof Error ? err : new Error(String(err))),
          });
          if (globals.json === true) {
            writeOut(
              JSON.stringify({
                status: "succeeded",
                id: "ext.sdk",
                output: {
                  path: result.path,
                  bytes: result.bytes,
                  version: result.version,
                },
              }),
            );
          } else {
            writeOut(`wrote .kb/sdk.d.ts (kb ${KB_SDK_VERSION})`);
          }
          return EXIT_OK;
        }).pipe(Effect.provide(bunFileSystemLayer)),
      ).catch((err) => handleCliError(err, globals.json === true));
      process.exitCode = code;
    });

  program
    .command("action-invoke")
    .description('Raw registry invoke: JSON {"id","input"} or "-" for stdin')
    .argument("<json>", 'JSON object or "-"')
    .action(async function (this: Command, jsonArg: string) {
      const code = await withCtx(this, (ctx, globals) =>
        Effect.gen(function* () {
          const raw = yield* readActionJsonEffect(jsonArg);
          const invocation = mapActionInvoke(raw);
          const receipt = yield* invokeReceiptEffect(ctx, invocation);
          writeOut(formatReceipt(receipt, { json: globals.json === true }));
          return receipt.status === "succeeded" ? EXIT_OK : EXIT_FAILED;
        }),
      );
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
    const exitCode = process.exitCode;
    return typeof exitCode === "number" ? exitCode : EXIT_OK;
  } catch (err) {
    const json = argv.includes("--json");
    const code = handleCliError(err, json);
    process.exitCode = code;
    return code;
  }
}
