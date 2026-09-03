/**
 * One reader for the workspace's own shape. Every repo-shape check in this
 * package reads the tree through here, so "what a package is" is stated once.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const WORKSPACE_ROOT = join(import.meta.dir, "..", "..", "..");
export const PACKAGES_ROOT = join(WORKSPACE_ROOT, "packages");

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
    .sort();
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
export function dependencyEntries(
  manifest: PackageManifest,
): Array<[string, string, string]> {
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
  return tags
    .filter((t) => t.startsWith(`${axis}:`))
    .map((t) => t.slice(axis.length + 1));
}
