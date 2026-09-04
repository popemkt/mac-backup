/**
 * Generate the embedded extension SDK ambient declaration text from
 * `packages/ext-sdk/src/surface.ts` via `tsc --emitDeclarationOnly`.
 *
 * Run: `bun tools/kb/packages/ext-sdk/src/generate.ts`
 * Writes: `packages/ext-sdk/src/sdk-dts.text.ts`
 */
import { Effect, Schema } from "effect";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { FileSystem } from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import type { Scope } from "effect/Scope";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const KB_ROOT = join(SCRIPT_DIR, "..", "..", "..");
const SURFACE = join(SCRIPT_DIR, "surface.ts");
const OUT_MODULE = join(SCRIPT_DIR, "sdk-dts.text.ts");
const PKG = join(KB_ROOT, "package.json");

export interface GenExtSdkResult {
  dts: string;
  version: string;
}

/** `tsc` could not emit the surface declaration. */
export class ExtSdkEmitError extends Schema.TaggedError<ExtSdkEmitError>()("Kb/ExtSdkEmitError", {
  message: Schema.String,
}) {}

/** Build the ambient `kb-ext-sdk` declaration string (no filesystem write). */
export const generateExtSdkDts = Effect.fn("kb.generateExtSdkDts")(function* (
  opts: { version?: string } = {},
): Effect.fn.Return<GenExtSdkResult, PlatformError | ExtSdkEmitError, FileSystem | Scope> {
  const fs = yield* FileSystem;
  const pkg = yield* fs.readFileString(PKG).pipe(Effect.map(parsePackageVersion));
  const version = opts.version ?? pkg;

  const work = yield* fs.makeTempDirectoryScoped({ prefix: "kb-ext-sdk-" });
  {
    const surfaceSrc = yield* fs.readFileString(SURFACE);
    yield* fs.writeFileString(join(work, "surface.ts"), surfaceSrc);
    yield* fs.writeFileString(
      join(work, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            declaration: true,
            emitDeclarationOnly: true,
            outDir: "out",
            strict: true,
            skipLibCheck: true,
            module: "ESNext",
            moduleResolution: "bundler",
            target: "ESNext",
          },
          files: ["surface.ts"],
        },
        null,
        2,
      ),
    );

    const tsc = join(KB_ROOT, "node_modules/.bin/tsc");
    const result = spawnSync(tsc, ["-p", join(work, "tsconfig.json")], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      return yield* new ExtSdkEmitError({
        message: `tsc emit failed:\n${result.stdout}\n${result.stderr}`,
      });
    }

    const emitted = yield* fs.readFileString(join(work, "out/surface.d.ts"));
    const body = stripHeaderComments(emitted).trimEnd();
    const dts = [
      "/**",
      ` * kb extension SDK — ambient types for .kb/extensions/*.ts`,
      ` * kb ${version}`,
      " * Regenerate: bun tools/kb/packages/ext-sdk/src/generate.ts",
      " * Emit to a repo: kb ext sdk --write",
      " *",
      " * Usage:",
      ' *   /// <reference path="../sdk.d.ts" />',
      ' *   import type { ExtensionAction } from "kb-ext-sdk";',
      " *",
      " * Helper siblings in .kb/extensions/ must `export default []` so the",
      " * loader does not warn (or wait for a future _-prefix ignore rule).",
      " */",
      "",
      'declare module "kb-ext-sdk" {',
      indent(body, 2),
      "}",
      "",
    ].join("\n");

    return { dts, version };
  }
});

/** The kb version stamped into the generated header. */
function parsePackageVersion(text: string): string {
  return (JSON.parse(text) as { version: string }).version;
}

/** Write `sdk-dts.text.ts` with the regenerated string constant. */
export const writeExtSdkModule = Effect.fn("kb.writeExtSdkModule")(function* (
  opts: { version?: string } = {},
): Effect.fn.Return<GenExtSdkResult, PlatformError | ExtSdkEmitError, FileSystem | Scope> {
  const fs = yield* FileSystem;
  const { dts, version } = yield* generateExtSdkDts(opts);
  const moduleSource = [
    "/**",
    " * GENERATED — do not edit by hand.",
    " * Regenerate: bun tools/kb/packages/ext-sdk/src/generate.ts",
    " */",
    `export const KB_SDK_VERSION = ${JSON.stringify(version)} as const;`,
    "export const KB_SDK_DTS: string = " + JSON.stringify(dts) + ";",
    "",
  ].join("\n");
  yield* fs.makeDirectory(dirname(OUT_MODULE), { recursive: true });
  yield* fs.writeFileString(OUT_MODULE, moduleSource);
  return { dts, version };
});

function stripHeaderComments(src: string): string {
  return src.replace(/^\/\*[\s\S]*?\*\/\s*/u, "").replace(/^\/\/.*\n/gmu, "");
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? line : pad + line))
    .join("\n");
}

if (import.meta.main) {
  // A generator script is its own composition root: it picks the platform
  // here rather than borrowing @kb/store-jsonl's persistence boundary, which
  // `layer:contract` may not reach.
  const { version } = await Effect.runPromise(
    Effect.scoped(writeExtSdkModule()).pipe(Effect.provide(BunFileSystem.layer)),
  );
  console.log(`wrote packages/ext-sdk/src/sdk-dts.text.ts (kb ${version})`);
}
