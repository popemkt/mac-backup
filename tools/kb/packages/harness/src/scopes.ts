/**
 * A *path scope* is a prefix — one directory or one file, workspace-relative —
 * and a gate that owns a scope list claims every TypeScript file under
 * `tools/kb` falls in exactly one of them. Two gates ask that same question:
 * `lint-scope-coverage` of the `lint` script's arguments, and
 * `typecheck-scope` of the package tsconfig `include` lists. The question is
 * answered here once, so a third gate adds a scope list rather than a third
 * copy of the loop.
 *
 * "Exactly one" is the point in both cases. Zero means a file no gate ever
 * sees; more than one means two gates disagree about which config owns it.
 */
import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { WORKSPACE_ROOT, gitWorkspaceFiles } from "./workspace.ts";

/** One scope plus the config line that authored it, for the failure message. */
export interface PathScope {
  /** Workspace-relative directory or file path. */
  path: string;
  /** Where the scope was declared, e.g. `packages/cli/tsconfig.json`. */
  source: string;
}

export interface ScopeAssignment {
  /** Files no scope claims. */
  unassigned: string[];
  /** `<file> matches: <scope>, <scope>` for files more than one scope claims. */
  multiple: string[];
}

/** Every tracked and untracked-not-ignored `.ts` / `.tsx` file under the root. */
export function allWorkspaceTsFiles(root: string = WORKSPACE_ROOT): string[] {
  const tracked = gitWorkspaceFiles(["*.ts", "*.tsx"], root);
  const untracked = gitWorkspaceFiles(["--others", "--exclude-standard", "*.ts", "*.tsx"], root);
  return [...new Set([...tracked, ...untracked])].toSorted();
}

function covers(scope: string, file: string): boolean {
  return file === scope || file.startsWith(`${scope}/`);
}

/**
 * Assign every file to the scopes that claim it. `excluded` paths are dropped
 * before assignment; each one is a recorded decision at its call site, never a
 * silent hole.
 */
export function assignToScopes(
  files: readonly string[],
  scopes: readonly PathScope[],
  excluded: readonly string[] = [],
): ScopeAssignment {
  const normalized = scopes.map((s) => ({ ...s, path: normalize(s.path).replace(/\/$/, "") }));
  const unassigned: string[] = [];
  const multiple: string[] = [];

  for (const file of files) {
    const norm = normalize(file);
    if (excluded.some((ex) => covers(normalize(ex), norm))) continue;

    const matches = normalized.filter((s) => covers(s.path, norm));
    if (matches.length === 0) {
      unassigned.push(norm);
    } else if (matches.length > 1) {
      multiple.push(`${norm} matches: ${matches.map((s) => `${s.path} (${s.source})`).join(", ")}`);
    }
  }
  return { unassigned, multiple };
}

/** Scope paths that name nothing on disk — a scope list gone stale. */
export function missingScopes(scopes: readonly PathScope[]): string[] {
  return scopes
    .filter(({ path }) => !existsSync(join(WORKSPACE_ROOT, path)))
    .map(({ path, source }) => `${path} (${source}) does not exist`);
}
