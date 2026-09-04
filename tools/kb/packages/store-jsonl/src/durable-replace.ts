/**
 * Durable whole-file replace for nodes.jsonl (r4 Stage-0).
 *
 * Protocol:
 * 1. write candidate to tmp via fd + fsync
 * 2. copy live → .bak (best-effort prior generation)
 * 3. rename tmp → live
 * 4. fsync parent directory (when the platform allows)
 *
 * Does not change the on-disk JSONL format.
 */
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { domainError, type DomainError } from "@kb/model";

function mapErr(err: unknown, context: string): DomainError {
  const message = err instanceof Error ? err.message : String(err);
  return domainError("internal", `${context}: ${message}`);
}

function fsyncPath(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDir(dir: string): void {
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Directory fsync is best-effort (some FS/OS combos reject it).
  }
}

/**
 * Atomically replace `path` with `body`, keeping `backupPath` as the prior
 * live contents when a prior file existed.
 */
export function durableReplaceFile(path: string, backupPath: string, body: string): void {
  const dir = dirname(path);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw mapErr(err, `mkdir ${dir}`);
  }

  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, body, 0, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    if (existsSync(path)) {
      try {
        copyFileSync(path, backupPath);
        fsyncPath(backupPath);
      } catch (err) {
        throw mapErr(err, `backup ${path} → ${backupPath}`);
      }
    }

    try {
      renameSync(tmp, path);
    } catch (err) {
      try {
        unlinkSync(tmp);
      } catch {
        // ignore cleanup failure
      }
      throw mapErr(err, `rename ${tmp} → ${path}`);
    }

    fsyncDir(dir);
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "internal") {
      throw err;
    }
    throw mapErr(err, `durable replace ${path}`);
  }
}
