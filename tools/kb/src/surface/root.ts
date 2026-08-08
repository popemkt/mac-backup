import { access, constants } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the kb repo root.
 * --root wins; otherwise walk cwd upward looking for `.kb/`.
 * When `allowCreate` (init), fall back to cwd if none found.
 */
export async function resolveRoot(
  opts: { root?: string; cwd?: string; allowCreate?: boolean } = {},
): Promise<string> {
  if (opts.root) return resolve(opts.root);

  let dir = resolve(opts.cwd ?? process.cwd());
  for (;;) {
    if (await exists(join(dir, ".kb"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (opts.allowCreate) return resolve(opts.cwd ?? process.cwd());
  throw new RootNotFoundError(
    "no .kb/ found (walked up from cwd); pass --root or run kb init",
  );
}

export class RootNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RootNotFoundError";
  }
}
