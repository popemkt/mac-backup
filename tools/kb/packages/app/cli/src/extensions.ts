/**
 * `kb ext`: the extensions this root composes. `list` prints each one on or
 * off with the actions it registered and how much it contributes,
 * `footprint` prints what one adds (`extension.footprint`), and `sdk`
 * prints or writes the ambient types a repository extension compiles
 * against.
 */
import type { Command } from "commander";
import { Effect } from "effect";
import { z } from "zod";
import { FootprintRowSchema, onWire, type FootprintRow, type KbContext } from "@kb/contracts";
import { ensureDomainError } from "@kb/model";
import { KB_SDK_VERSION, readEmbeddedSdkDts, writeSdkDts } from "@kb/ext-sdk";
import { invokeReceiptEffect, resolveRootEffect, sessionRegistry, writeOut } from "@kb/runtime";
import { ACTION_INVOKE_WIRE, EXIT_OK, cliAction, kbAction, report } from "./command.ts";
import { formatMode } from "./format.ts";

const FootprintOutput = z.object({ rows: z.array(FootprintRowSchema) });

/** `extension.footprint`'s rows, as the action answers them; none when it answers otherwise. */
function footprintRows(output: unknown): readonly FootprintRow[] {
  const parsed = FootprintOutput.safeParse(output);
  return parsed.success ? parsed.data.rows : [];
}

/** Every extension's footprint, by the CLI's wire. */
const footprint = (ctx: KbContext, name?: string) =>
  invokeReceiptEffect(
    ctx,
    onWire(ACTION_INVOKE_WIRE, {
      id: "extension.footprint",
      input: name === undefined ? {} : { name },
    }),
  );

/** A footprint as lines: one per row, its source, kind and id. */
function footprintLines(output: unknown): readonly string[] {
  const rows = footprintRows(output);
  const [first] = rows;
  if (first === undefined) return ["contributes nothing"];
  return [
    `${first.family}${first.enabled ? "" : " (off)"}: ${rows.length} contributed`,
    ...rows.map((row) => `  ${row.source.padEnd(8)} ${row.kind.padEnd(14)} ${row.id}`),
  ];
}

export function extensionCommands(program: Command): void {
  const ext = program.command("ext").description("Extension operations");
  ext
    .command("list")
    .description(
      "List the extensions (bundled + .kb/extensions), each on or off, and the actions of those loaded",
    )
    .action(
      kbAction((ctx, globals) =>
        Effect.gen(function* () {
          const registry = yield* sessionRegistry(ctx);
          const receipt = yield* footprint(ctx);
          const rows = footprintRows(receipt.status === "succeeded" ? receipt.output : null);
          // What kb.manifest reports, each with the actions it registered when
          // loaded and how many footprint rows it has.
          const listed = registry.families.map((family) => ({
            ...family,
            actions: registry.extensions.find(({ name }) => name === family.name)?.actions ?? [],
            contributes: rows.filter((row) => row.family === family.name).length,
          }));
          if (globals.json === true) {
            writeOut(
              JSON.stringify({
                status: "succeeded",
                id: "ext.list",
                output: {
                  extensions: listed.map((e) => ({
                    name: e.name,
                    source: e.source,
                    optional: e.optional,
                    enabled: e.enabled,
                    contributes: e.contributes,
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
          for (const e of listed) {
            lines.push(
              `${e.name} (${e.source}${e.enabled ? "" : ", off"}) — contributes ${e.contributes}`,
            );
            for (const a of e.actions) {
              const alias = a.aliases.length > 0 ? ` (alias: ${a.aliases.join(", ")})` : "";
              lines.push(`  ${a.def.id}${alias} — ${a.def.title} [${formatMode(a.def.mode)}]`);
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
    .command("footprint")
    .description(
      "What an extension adds: the nodes it seeds and what it contributes to the hosts running now",
    )
    .argument("<name>", "extension name, as `kb ext list` prints it")
    .action(
      kbAction((ctx, globals, [name]: [string]) =>
        footprint(ctx, name).pipe(
          Effect.map((receipt) => report(receipt, globals, footprintLines)),
        ),
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
          const result = yield* writeSdkDts(root).pipe(Effect.mapError(ensureDomainError));
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
}
