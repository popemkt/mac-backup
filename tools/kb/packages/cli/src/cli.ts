#!/usr/bin/env bun
import { Command, CommanderError } from "commander";
import { Cause, Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { text as readStream } from "node:stream/consumers";
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
import {
  type DomainError,
  type FailureCode,
  ResolveError,
  SYSTEM_IDS,
  currentIso,
  ensureDomainError,
  exampleSeedNodes,
  isDomainError,
  isPristine,
  isSysPrefixed,
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
  parsePropType,
  UsageError,
  type PlannedAction,
} from "@kb/operations";

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

interface GlobalOpts {
  json?: boolean;
  root?: string;
}

/**
 * Commander's own `.option()` declarations are the schema for an option bag,
 * and `opts<T>()` is the library's typed accessor for reading one back.
 */
function getGlobals(cmd: Command): GlobalOpts {
  return cmd.optsWithGlobals<GlobalOpts>();
}

/** The one shape of a CLI failure: JSON envelope under --json, else stderr. */
function reportFailure(
  code: FailureCode,
  message: string,
  json: boolean,
  exitCode: number,
): number {
  if (json) {
    writeOut(JSON.stringify({ status: "failed", code, message }));
  } else {
    writeErr(message);
  }
  return exitCode;
}

function handleCliError(err: unknown, json: boolean): number {
  if (err instanceof UsageError || err instanceof RootNotFoundError) {
    return reportFailure("invalid_input", err.message, json, EXIT_USAGE);
  }
  if (err instanceof ResolveError) {
    // Domain lookup/move failures (unknown field/tag, ambiguous, forbidden,
    // invalid move) surface as typed receipts — never `internal`.
    return reportFailure(receiptCodeOf(err), err.message, json, EXIT_FAILED);
  }
  if (isDomainError(err)) {
    return reportFailure(receiptCodeOf(err), err.message, json, EXIT_FAILED);
  }
  if (err instanceof CommanderError) {
    if (err.code === "commander.helpDisplayed") return EXIT_OK;
    if (err.code === "commander.version") return EXIT_OK;
    writeErr(err.message);
    return EXIT_USAGE;
  }
  return reportFailure(
    "internal",
    err instanceof Error ? err.message : String(err),
    json,
    EXIT_FAILED,
  );
}

/**
 * The CLI's one promise edge. Commander wants an action callback that returns
 * a promise; everything behind it is an Effect, and `process.exitCode` is set
 * here and nowhere else. The `.option()`/`.argument()` declarations on the
 * command are what type `A`.
 */
function cliAction<A extends readonly unknown[], E>(
  body: (globals: GlobalOpts, args: A) => Effect.Effect<number, E, FileSystem>,
): (this: Command, ...args: A) => Promise<void> {
  return function (this: Command, ...args: A): Promise<void> {
    const globals = getGlobals(this);
    return Effect.runPromise(
      // `suspend` so a plan built eagerly by the body (a bad `--prop`, say)
      // fails inside the Effect rather than throwing out of Commander.
      Effect.suspend(() => body(globals, args)).pipe(
        Effect.provide(bunFileSystemLayer),
        Effect.catchCause((cause) =>
          Effect.succeed(handleCliError(Cause.squash(cause), globals.json === true)),
        ),
        Effect.tap((code) =>
          Effect.sync(() => {
            process.exitCode = code;
          }),
        ),
        Effect.asVoid,
      ),
    );
  };
}

/**
 * A command that needs an open kb session: resolve the root, open the store,
 * and run `body` under {@link kbRuntimeLayer}.
 */
function kbAction<A extends readonly unknown[], E>(
  body: (
    ctx: KbContext,
    globals: GlobalOpts,
    args: A,
  ) => Effect.Effect<number, E, ActionHandlerEnv>,
  opts: { allowCreateRoot?: boolean } = {},
): (this: Command, ...args: A) => Promise<void> {
  return cliAction((globals, args) =>
    Effect.gen(function* () {
      const root = yield* resolveRootEffect({
        root: globals.root,
        allowCreate: opts.allowCreateRoot === true,
      });
      const ctx = yield* openKbEffect(root);
      return yield* body(ctx, globals, args).pipe(Effect.provide(kbRuntimeLayer(ctx)));
    }),
  );
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

/**
 * Parse action-invoke JSON text with native JSON.parse diagnostics, then leave
 * structural/action Schema validation to mapActionInvoke + invokeReceiptEffect.
 */
function parseActionJson(text: string): Effect.Effect<unknown, UsageError> {
  return Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (err) =>
      new UsageError({
        message: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      }),
  });
}

/**
 * Read action-invoke JSON from an argv blob or stdin ("-").
 * Empty stdin → UsageError (exit 2). Genuine stdin I/O failures fold through
 * the one DomainError mapper and stay exit 1, matching pre-Effect CLI behavior.
 */
function readActionJsonEffect(arg: string): Effect.Effect<unknown, UsageError | DomainError> {
  if (arg === "-") {
    return Effect.gen(function* () {
      const raw = yield* Effect.tryPromise({
        try: () => readStream(process.stdin),
        catch: ensureDomainError,
      });
      const text = raw.trim();
      if (!text) {
        return yield* new UsageError({ message: "action-invoke: empty stdin" });
      }
      return yield* parseActionJson(text);
    });
  }
  return parseActionJson(arg);
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

const toInt = (v: string): number => Number.parseInt(v, 10);

interface ForceOpts {
  force?: boolean;
}
interface IdOpts {
  id?: string;
}
interface TypedPropOpts extends ForceOpts {
  type?: string;
}
interface AddOpts extends IdOpts, ForceOpts {
  parent?: string;
  position?: number;
  tag: string[];
  prop: string[];
  create?: boolean;
}
interface SetOpts extends TypedPropOpts {
  create?: boolean;
}
interface MvOpts extends ForceOpts {
  position?: number;
  rootParent?: boolean;
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
    .action(
      cliAction((globals) =>
        Effect.gen(function* () {
          const { startMcp } = yield* Effect.promise(() => import("@kb/mcp"));
          const root = yield* resolveRootEffect({ root: globals.root });
          yield* Effect.tryPromise({ try: () => startMcp(root), catch: ensureDomainError });
          // keep the process alive; the transport owns stdio from here
          return yield* Effect.never;
        }),
      ),
    );

  program
    .command("ui")
    .description("Serve the kb browser UI + subscription backend")
    .option("--port <n>", "backend listen port (default 4321)", toInt)
    .option("--dev", "spawn the Vite dev server (HMR) and proxy to the backend", false)
    .option("--dev-port <n>", "Vite dev server port (default 5173)", toInt)
    .option("--no-open", "do not open a browser")
    .action(
      cliAction(
        (globals, [opts]: [{ port?: number; dev?: boolean; devPort?: number; open?: boolean }]) =>
          Effect.gen(function* () {
            const { runUiCli } = yield* Effect.promise(() => import("@kb/server"));
            const root = yield* resolveRootEffect({ root: globals.root });
            yield* Effect.tryPromise({
              try: () =>
                runUiCli({
                  root,
                  port: opts.port ?? UI_DEFAULT_PORT,
                  openBrowser: opts.open !== false,
                  dev: opts.dev === true,
                  devPort: opts.devPort,
                }),
              catch: ensureDomainError,
            });
            return EXIT_OK;
          }),
      ),
    );

  program
    .command("init")
    .description("Initialize .kb/ at --root or cwd")
    .option("--bare", "skip the example content (supertags, fields, query, ontologies)")
    .action(
      kbAction(
        (ctx, globals, [opts]: [{ bare?: boolean }]) =>
          Effect.gen(function* () {
            const fs = yield* FileSystem;
            yield* fs
              .makeDirectory(join(ctx.root, ".kb", "queries"), {
                recursive: true,
              })
              .pipe(Effect.mapError(ensureDomainError));

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
        { allowCreateRoot: true },
      ),
    );

  program
    .command("add")
    .description("Create a node")
    .argument("<text>", "node text")
    .option("--parent <id>", "parent node id")
    .option("--position <n>", "child index", toInt)
    .option("--tag <name>", "tag name (repeatable)", collect, [])
    .option("--prop <field=value>", "prop (repeatable)", collect, [])
    .option("--id <id>", "explicit node id")
    .option("--create", "mint missing fields", false)
    .option("--force", "allow minting or parenting under sys.* nodes", false)
    .action(
      kbAction((ctx, globals, [text, opts]: [string, AddOpts]) =>
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
      ),
    );

  program
    .command("set")
    .description("Set a property on a node")
    .argument("<id>", "node id")
    .argument("<field>", "field name or id")
    .argument("<value>", "value")
    .option("--type <t>", "str|num|bool|date|ref")
    .option("--create", "mint missing field", false)
    .option("--force", "allow edits on sys.* nodes", false)
    .action(
      kbAction((ctx, globals, [id, field, value, opts]: [string, string, string, SetOpts]) =>
        runPlanEffect(
          ctx,
          mapSet({
            id,
            field,
            value,
            type: parsePropType(opts.type),
            force: opts.force === true,
          }),
          globals,
          { create: opts.create === true },
        ),
      ),
    );

  program
    .command("unset")
    .description("Unset a property on a node")
    .argument("<id>", "node id")
    .argument("<field>", "field name or id")
    .argument("[value]", "specific value to remove")
    .option("--type <t>", "str|num|bool|date|ref")
    .option("--force", "allow edits on sys.* nodes", false)
    .action(
      kbAction(
        (
          ctx,
          globals,
          [id, field, value, opts]: [string, string, string | undefined, TypedPropOpts],
        ) =>
          runPlanEffect(
            ctx,
            mapUnset({
              id,
              field,
              value,
              type: parsePropType(opts.type),
              force: opts.force === true,
            }),
            globals,
          ),
      ),
    );

  program
    .command("get")
    .description("Pull a node subtree")
    .argument("<id>", "node id")
    .option("--depth <n>", "pull depth", toInt, 1)
    .action(
      kbAction((ctx, globals, [id, opts]: [string, { depth: number }]) =>
        runPlanEffect(ctx, mapGet({ id, depth: opts.depth }), globals),
      ),
    );

  program
    .command("rm")
    .description("Delete a node")
    .argument("<id>", "node id")
    .option("--force", "allow deleting sys.* nodes", false)
    .action(
      kbAction((ctx, globals, [id, opts]: [string, ForceOpts]) =>
        runPlanEffect(ctx, mapRm({ id, force: opts.force === true }), globals),
      ),
    );

  program
    .command("mv")
    .description("Move a node under a new parent (use --root-parent to detach)")
    .argument("<id>", "node id")
    .argument("[parent]", "new parent id")
    .option("--position <n>", "child index", toInt)
    .option("--root-parent", "detach from parent", false)
    .option("--force", "allow moving under sys.* parents", false)
    .action(
      kbAction((ctx, globals, [id, parent, opts]: [string, string | undefined, MvOpts]) =>
        Effect.gen(function* () {
          const parentArg = opts.rootParent === true ? null : parent;
          if (parentArg === undefined) {
            return yield* new UsageError({ message: "mv requires <parent> or --root-parent" });
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
      ),
    );

  const field = program.command("field").description("Field operations");
  field
    .command("define")
    .description("Mint a field node")
    .argument("<name>", "field name")
    .option("--id <id>", "explicit id")
    .action(
      kbAction((ctx, globals, [name, opts]: [string, IdOpts]) =>
        runPlanEffect(ctx, mapFieldDefine({ name, id: opts.id }), globals),
      ),
    );
  field
    .command("list")
    .description("List field nodes")
    .action(kbAction((ctx, globals) => runPlanEffect(ctx, mapFieldList(), globals)));
  field
    .command("type")
    .description("Set sys.f.fieldType on a field (text|number|date|url|checkbox|ref)")
    .argument("<field>", "field name or id")
    .argument("<type>", "field type")
    .action(
      kbAction((ctx, globals, [fieldName, type]: [string, string]) =>
        Effect.gen(function* () {
          const fieldId = resolveFieldId(ctx.nodes, fieldName);
          const node = ctx.nodes.find((n) => n.id === fieldId);
          // Props are multi-valued and set appends, so the prior value has to
          // be unset explicitly — whichever form it was stored in.
          const previous = node?.props[SYSTEM_IDS.fieldTypeField]?.[0];
          return yield* runPlanEffect(ctx, mapFieldType({ fieldId, type, previous }), globals);
        }),
      ),
    );
  field
    .command("target")
    .description("Add sys.f.targetTag constraint (union) on a ref field")
    .argument("<field>", "field name or id")
    .argument("<tag>", "tag name or id")
    .action(
      kbAction((ctx, globals, [fieldName, tag]: [string, string]) =>
        Effect.gen(function* () {
          const fieldId = resolveFieldId(ctx.nodes, fieldName);
          const tagId = resolveTagId(ctx.nodes, tag);
          return yield* runPlanEffect(ctx, mapFieldTarget({ fieldId, tagId }), globals);
        }),
      ),
    );
  field
    .command("target-query")
    .description("Set sys.f.targetQuery EDN constraint (wins over targetTag)")
    .argument("<field>", "field name or id")
    .argument("<edn>", "datalog EDN returning allowed node ids")
    .action(
      kbAction((ctx, globals, [fieldName, edn]: [string, string]) =>
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
      ),
    );

  const tag = program.command("tag").description("Tag operations");
  tag
    .command("define")
    .description("Mint a tag node")
    .argument("<name>", "tag name")
    .option("--id <id>", "explicit id")
    .option("--field <name>", "templated field (repeatable)", collect, [])
    .action(
      kbAction((ctx, globals, [name, opts]: [string, IdOpts & { field: string[] }]) =>
        runPlanEffect(ctx, mapTagDefine({ name, id: opts.id, fields: opts.field }), globals),
      ),
    );
  tag
    .command("list")
    .description("List tag nodes")
    .action(kbAction((ctx, globals) => runPlanEffect(ctx, mapTagList(), globals)));

  const ontology = program.command("ontology").description("Ontology operations (#ontology nodes)");
  ontology
    .command("list")
    .description("List #ontology nodes")
    .action(kbAction((ctx, globals) => runPlanEffect(ctx, mapOntologyList(), globals)));
  ontology
    .command("members")
    .description("Resolve an ontology's members (tags + pins + query + extends)")
    .argument("<id>", "ontology node id")
    .option("--reasons", "include per-member provenance")
    .action(
      kbAction((ctx, globals, [id, opts]: [string, { reasons?: boolean }]) =>
        runPlanEffect(ctx, mapOntologyMembers({ id, reasons: opts.reasons === true }), globals),
      ),
    );

  program
    .command("query")
    .description("Run a raw EDN datalog query")
    .argument("<edn>", "EDN query string")
    .action(
      kbAction((ctx, globals, [edn]: [string]) =>
        runPlanEffect(ctx, mapQuery({ query: edn }), globals),
      ),
    );

  program
    .command("run")
    .description("Execute a saved query from .kb/queries/<name>.edn")
    .argument("<name>", "saved query name (without .edn)")
    .action(
      kbAction((ctx, globals, [name]: [string]) => runPlanEffect(ctx, mapRun(name), globals)),
    );

  program
    .command("search")
    .description("Search node text (case-insensitive substring)")
    .argument("<text>", "search text")
    .action(
      kbAction((ctx, globals, [text]: [string]) =>
        runPlanEffect(ctx, mapSearch(text), globals, { command: "search" }),
      ),
    );

  program
    .command("backlinks")
    .description("Nodes that mention <id>")
    .argument("<id>", "node id")
    .action(
      kbAction((ctx, globals, [id]: [string]) => runPlanEffect(ctx, mapBacklinks(id), globals)),
    );

  program
    .command("children")
    .description("Direct children of a node")
    .argument("<id>", "node id")
    .action(
      kbAction((ctx, globals, [id]: [string]) =>
        runPlanEffect(ctx, mapChildren(id), globals, { command: "children" }),
      ),
    );

  const ext = program.command("ext").description("Extension operations");
  ext
    .command("list")
    .description("List loaded extensions (bundled + .kb/extensions) and their actions")
    .action(
      kbAction((ctx, globals) =>
        Effect.gen(function* () {
          const registry = yield* Effect.tryPromise({
            try: () => registryFor(ctx.root),
            catch: ensureDomainError,
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
      ),
    );
  ext
    .command("sdk")
    .description("Print or write the ambient extension SDK types (kb-ext-sdk) for this binary")
    .option("--write", "write .kb/sdk.d.ts under the resolved root", false)
    .action(
      cliAction((globals, [opts]: [{ write?: boolean }]) =>
        Effect.gen(function* () {
          if (opts.write !== true) {
            writeOut(readEmbeddedSdkDts());
            return EXIT_OK;
          }
          const root = yield* resolveRootEffect({
            root: globals.root,
            allowCreate: true,
          });
          const result = yield* Effect.tryPromise({
            try: () => writeSdkDts(root),
            catch: ensureDomainError,
          });
          writeOut(
            globals.json === true
              ? JSON.stringify({
                  status: "succeeded",
                  id: "ext.sdk",
                  output: {
                    path: result.path,
                    bytes: result.bytes,
                    version: result.version,
                  },
                })
              : `wrote .kb/sdk.d.ts (kb ${KB_SDK_VERSION})`,
          );
          return EXIT_OK;
        }),
      ),
    );

  program
    .command("action-invoke")
    .description('Raw registry invoke: JSON {"id","input"} or "-" for stdin')
    .argument("<json>", 'JSON object or "-"')
    .action(
      kbAction((ctx, globals, [jsonArg]: [string]) =>
        Effect.gen(function* () {
          const raw = yield* readActionJsonEffect(jsonArg);
          const invocation = mapActionInvoke(raw);
          const receipt = yield* invokeReceiptEffect(ctx, invocation);
          writeOut(formatReceipt(receipt, { json: globals.json === true }));
          return receipt.status === "succeeded" ? EXIT_OK : EXIT_FAILED;
        }),
      ),
    );

  return program;
}

/**
 * Process entry. Commander's parse is the promise; the only work after it is
 * turning a thrown parse/usage error into the same exit code every command
 * uses.
 */
export function main(argv: string[] = process.argv): Promise<number> {
  return buildProgram()
    .parseAsync(argv)
    .then(() => (typeof process.exitCode === "number" ? process.exitCode : EXIT_OK))
    .catch((err: unknown) => {
      const code = handleCliError(err, argv.includes("--json"));
      process.exitCode = code;
      return code;
    });
}
