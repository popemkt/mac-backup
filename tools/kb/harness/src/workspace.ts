/**
 * One reader for the workspace's own shape. Every repo-shape check in this
 * package reads the tree through here, so "what a package is" is stated once.
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
export const WORKSPACE_ROOT = join(import.meta.dir, "..", "..");
export const PACKAGES_ROOT = join(WORKSPACE_ROOT, "packages");
/** The harness itself: root tooling, outside the workspace members. */
export const HARNESS_ROOT = join(WORKSPACE_ROOT, "harness");
export function gitWorkspaceFiles(
  patterns: string[] = ["*.ts", "*.tsx"],
  root: string = WORKSPACE_ROOT,
): string[] {
  const gitEnv = { ...process.env };
  delete gitEnv.GIT_DIR;
  delete gitEnv.GIT_WORK_TREE;
  delete gitEnv.GIT_INDEX_FILE;
  delete gitEnv.GIT_PREFIX;

  const flags = patterns.filter((p) => p.startsWith("-")).join(" ");
  const paths = patterns
    .filter((p) => !p.startsWith("-"))
    .map((p) => `"${p}"`)
    .join(" ");
  const raw = execSync(
    `git ls-files --full-name ${flags} ${paths.length > 0 ? `-- ${paths}` : ""}`,
    {
      cwd: root,
      encoding: "utf8",
      env: gitEnv,
    },
  );
  const repoRoot = execSync("git rev-parse --show-toplevel", {
    cwd: root,
    encoding: "utf8",
    env: gitEnv,
  }).trim();
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((f) => relative(root, join(repoRoot, f)))
    .filter((f) => !f.startsWith("..") && f.length > 0)
    .toSorted();
}

export interface PackageManifest {
  name?: string;
  private?: boolean;
  type?: string;
  exports?: unknown;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  nx?: { tags?: string[] };
  workspaces?: { packages?: string[]; catalog?: Record<string, string> };
  overrides?: Record<string, string>;
  [key: string]: unknown;
}

export interface WorkspacePackage {
  /** Path under packages/, `<layer>/<name>`. */
  dir: string;
  /** The layer folder this package sits in. The folder *is* the layer. */
  layer: string;
  /**
   * The manifest's own `name`. `""` when the manifest declares none — that is
   * a `workspace-shape` failure, and an empty name matches no import specifier
   * and no declared dependency, so every other gate goes red rather than quiet.
   */
  name: string;
  manifestPath: string;
  manifest: PackageManifest;
}

function readJson(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
}

export function rootManifest(): PackageManifest {
  return readJson(join(WORKSPACE_ROOT, "package.json"));
}

function subdirectories(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .toSorted();
}

/**
 * Every directory directly under packages/. Each one names a layer, which is
 * what makes `layer` a property of placement rather than a tag repeating it;
 * `workspace-shape` is where "and it is a layer the matrix knows" is asserted.
 */
export function layerDirs(): string[] {
  return subdirectories(PACKAGES_ROOT);
}

/**
 * Every `<layer>/<name>` directory under packages/, whether or not it is a
 * valid member.
 */
export function packageDirs(): string[] {
  return layerDirs()
    .flatMap((layer) =>
      subdirectories(join(PACKAGES_ROOT, layer)).map((name) => `${layer}/${name}`),
    )
    .toSorted();
}

export function workspacePackages(): WorkspacePackage[] {
  return packageDirs().map((dir) => {
    const manifestPath = join(PACKAGES_ROOT, dir, "package.json");
    const manifest = readJson(manifestPath);
    return {
      dir,
      layer: dir.slice(0, dir.indexOf("/")),
      name: manifest.name ?? "",
      manifestPath,
      manifest,
    };
  });
}

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/** [field, package name, version specifier] for every declared dependency. */
export function dependencyEntries(manifest: PackageManifest): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  for (const field of DEP_FIELDS) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      out.push([field, name, spec]);
    }
  }
  return out;
}

export function tagsOf(manifest: PackageManifest): string[] {
  return manifest.nx?.tags ?? [];
}

/** Tag values on one axis, e.g. axisValues(tags, "layer") -> ["domain"]. */
export function axisValues(tags: string[], axis: "layer" | "scope"): string[] {
  return tags.filter((t) => t.startsWith(`${axis}:`)).map((t) => t.slice(axis.length + 1));
}

/** `bunfig.toml`'s `[install]` table: the supply-chain half of the config. */
export interface BunfigInstall {
  minimumReleaseAge?: number;
  trustedDependencies?: string[];
}

/**
 * `bunfig.toml`, parsed. A pattern over the text would answer a different
 * question than Bun does — it cannot tell `[install]` from any other table,
 * and it reads a commented-out line as a setting.
 */
function table(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function bunfigInstall(): BunfigInstall {
  const parsed: unknown = Bun.TOML.parse(readFileSync(join(WORKSPACE_ROOT, "bunfig.toml"), "utf8"));
  const install = table(table(parsed)["install"]);
  const age = install["minimumReleaseAge"];
  const trusted = install["trustedDependencies"];
  return {
    ...(typeof age === "number" ? { minimumReleaseAge: age } : {}),
    ...(Array.isArray(trusted) ? { trustedDependencies: trusted.map(String) } : {}),
  };
}

export interface Tsconfig {
  extends?: string;
  include?: string[];
  exclude?: string[];
  compilerOptions?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * tsconfig files are JSONC. Comments are stripped outside of string literals,
 * so a `"$schema": "https://…"` value survives the pass.
 */
export function readTsconfig(path: string): Tsconfig {
  const src = readFileSync(path, "utf8");
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src.charAt(i);
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && src.charAt(i + 1) === "/") {
      while (i < src.length && src.charAt(i) !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (ch === "/" && src.charAt(i + 1) === "*") {
      i += 2;
      while (i < src.length && !(src.charAt(i) === "*" && src.charAt(i + 1) === "/")) i += 1;
      i += 1;
      continue;
    }
    out += ch;
  }
  return JSON.parse(out) as Tsconfig;
}

/** One `overrides` entry of the `@effect/language-service` plugin block. */
export interface EffectPluginOverride {
  include?: string[];
  exclude?: string[];
  options?: { diagnosticSeverity?: Record<string, string> };
}

export interface EffectPluginConfig {
  /** Severity that holds everywhere, before any file-scoped override. */
  diagnosticSeverity: Record<string, string>;
  /** Ordered per-file severity overrides. */
  overrides: EffectPluginOverride[];
}

const EFFECT_PLUGIN_NAME = "@effect/language-service";

/**
 * The one authored copy of the Effect language service plugin block. Both the
 * Effect severities and their file scope live there, so every gate that reads
 * them reads this.
 */
export function effectPluginConfig(preset = "tsconfig.bun.json"): EffectPluginConfig {
  const plugins = readTsconfig(join(WORKSPACE_ROOT, preset)).compilerOptions?.plugins;
  if (!Array.isArray(plugins)) {
    throw new Error(`${preset}: compilerOptions.plugins is not an array`);
  }
  for (const plugin of plugins) {
    if (typeof plugin !== "object" || plugin === null) continue;
    const block: Partial<EffectPluginConfig> & { name?: unknown } = plugin;
    if (block.name !== EFFECT_PLUGIN_NAME) continue;
    return {
      diagnosticSeverity: block.diagnosticSeverity ?? {},
      overrides: block.overrides ?? [],
    };
  }
  throw new Error(`${preset}: no ${EFFECT_PLUGIN_NAME} plugin block`);
}
