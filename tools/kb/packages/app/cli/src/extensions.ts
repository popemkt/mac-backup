/**
 * `kb ext`: the extensions this root composes. `list` prints each one on or
 * off with the actions it registered, and `sdk` prints or writes the
 * ambient types a repository extension compiles against.
 */
import type { Command } from "commander";
import { Effect } from "effect";
import { ensureDomainError } from "@kb/model";
import { KB_SDK_VERSION, readEmbeddedSdkDts, writeSdkDts } from "@kb/ext-sdk";
import { resolveRootEffect, sessionRegistry, writeOut } from "@kb/runtime";
import { EXIT_OK, cliAction, kbAction } from "./command.ts";
import { formatMode } from "./format.ts";

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
          // What kb.manifest reports, each with the actions it registered when loaded.
          const listed = registry.families.map((family) => ({
            ...family,
            actions: registry.extensions.find(({ name }) => name === family.name)?.actions ?? [],
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
            lines.push(`${e.name} (${e.source}${e.enabled ? "" : ", off"})`);
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
