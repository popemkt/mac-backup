// bb-plugin-canvas-links — the host entry. Runs `canvas-link` on the machine a workspace (or a canvas) lives on: the
// CLI owns the log, the central copy, tldraw's files and `open`, so this file only finds it and runs it.
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { delimiter, join } from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract, type Run } from "./contract";

const TIMEOUT_MS = 20_000;
const OUTPUT_LIMIT = 4 * 1024 * 1024;

const isExecutable = (path: string) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** canvas-link from PATH, else where Home Manager puts it: bb's daemon may start without a login PATH. */
function findCanvasLink(): string | null {
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter),
    `/etc/profiles/per-user/${userInfo().username}/bin`,
    join(homedir(), ".nix-profile/bin"),
    "/run/current-system/sw/bin",
  ];
  for (const dir of dirs) if (dir !== "" && isExecutable(join(dir, "canvas-link"))) return join(dir, "canvas-link");
  return null;
}

function run(file: string, args: string[], cwd: string | null, threadId: string | null, signal: AbortSignal): Promise<Run> {
  return new Promise(resolve => {
    // The thread is the session: canvas-link reads it from BB_THREAD_ID, as it does inside the thread's own shell.
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const name of ["BB_THREAD_ID", "ORCA_AGENT_SESSION_ID", "ORCA_PANE_KEY", "CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID", "CODEX_SESSION_ID"])
      delete env[name];
    if (threadId !== null) env.BB_THREAD_ID = threadId;
    const child = spawn(file, args, { cwd: cwd ?? homedir(), env, signal, timeout: TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < OUTPUT_LIMIT) stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < OUTPUT_LIMIT) stderr += d.toString("utf8");
    });
    child.on("error", err => resolve({ exitCode: 1, stdout, stderr: stderr + err.message }));
    child.on("close", code => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    canvasLink: async ({ command, args, cwd, threadId }, context) => {
      const file = findCanvasLink();
      if (file === null) return { exitCode: 127, stdout: "", stderr: `canvas-link is not installed on ${hostname()}` };
      return run(file, [command, ...args], cwd, threadId, context.signal);
    },
    hostname: async () => hostname().split(".")[0].toLowerCase(),
  },
});
