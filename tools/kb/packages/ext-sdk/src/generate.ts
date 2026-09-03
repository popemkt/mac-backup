/**
 * Generate the embedded extension SDK ambient declaration text from
 * `packages/ext-sdk/src/surface.ts` via `tsc --emitDeclarationOnly`.
 *
 * Run: `bun tools/kb/packages/ext-sdk/src/generate.ts`
 * Writes: `packages/ext-sdk/src/sdk-dts.text.ts`
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

/** Build the ambient `kb-ext-sdk` declaration string (no filesystem write). */
export async function generateExtSdkDts(opts: { version?: string } = {}): Promise<GenExtSdkResult> {
  const pkg = JSON.parse(await readFile(PKG, "utf8")) as { version: string };
  const version = opts.version ?? pkg.version;

  const work = await mkdtemp(join(tmpdir(), "kb-ext-sdk-"));
  try {
    const surfaceSrc = await readFile(SURFACE, "utf8");
    await writeFile(join(work, "surface.ts"), surfaceSrc, "utf8");
    await writeFile(
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
      "utf8",
    );

    const tsc = join(KB_ROOT, "node_modules/.bin/tsc");
    const result = spawnSync(tsc, ["-p", join(work, "tsconfig.json")], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(`tsc emit failed:\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    }

    const emitted = await readFile(join(work, "out/surface.d.ts"), "utf8");
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
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Write `sdk-dts.text.ts` with the regenerated string constant. */
export async function writeExtSdkModule(opts: { version?: string } = {}): Promise<GenExtSdkResult> {
  const { dts, version } = await generateExtSdkDts(opts);
  const moduleSource = [
    "/**",
    " * GENERATED — do not edit by hand.",
    " * Regenerate: bun tools/kb/packages/ext-sdk/src/generate.ts",
    " */",
    `export const KB_SDK_VERSION = ${JSON.stringify(version)} as const;`,
    "export const KB_SDK_DTS: string = " + JSON.stringify(dts) + ";",
    "",
  ].join("\n");
  await mkdir(dirname(OUT_MODULE), { recursive: true });
  await writeFile(OUT_MODULE, moduleSource, "utf8");
  return { dts, version };
}

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
  const { version } = await writeExtSdkModule();
  console.log(`wrote packages/ext-sdk/src/sdk-dts.text.ts (kb ${version})`);
}
