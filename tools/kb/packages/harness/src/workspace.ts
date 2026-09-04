/**
 * One reader for the workspace's own shape. Every repo-shape check in this
 * package reads the tree through here, so "what a package is" is stated once.
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
export const WORKSPACE_ROOT = join(import.meta.dir, "..", "..", "..");
export const PACKAGES_ROOT = join(WORKSPACE_ROOT, "packages");
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
  /** Directory name under packages/. */
  dir: string;
  manifestPath: string;
  manifest: PackageManifest;
}

function readJson(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
}

export function rootManifest(): PackageManifest {
  return readJson(join(WORKSPACE_ROOT, "package.json"));
}

/** Every directory under packages/, whether or not it is a valid member. */
export function packageDirs(): string[] {
  return readdirSync(PACKAGES_ROOT)
    .filter((name) => statSync(join(PACKAGES_ROOT, name)).isDirectory())
    .toSorted();
}

export function workspacePackages(): WorkspacePackage[] {
  return packageDirs().map((dir) => {
    const manifestPath = join(PACKAGES_ROOT, dir, "package.json");
    return { dir, manifestPath, manifest: readJson(manifestPath) };
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

/** `packages/<dir>/src/**\/*` for every package carrying the given scope tag. */
export function srcGlobsForScope(scope: string): string[] {
  return workspacePackages()
    .filter(({ manifest }) => axisValues(tagsOf(manifest), "scope").includes(scope))
    .map(({ dir }) => `packages/${dir}/src/**/*`)
    .toSorted();
}
