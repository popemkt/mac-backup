// sandbox's backend (proof of concept): the contract (core/contract.ts), one local provider
// (core/providers/bwrap.ts) and the admission queue (core/queue.ts), behind `bb sandbox`.
//
//   bb sandbox run [--net none|open] [--cpus N] [--memory MiB] [--timeout S] [--priority N] -- <argv…>
//   bb sandbox status
//
// `run` creates a sandbox, runs one command in it, prints its output and destroys it. The design
// this proves out (providers, jobs, fan-out, machine provider) is
// docs/research/2026-10-31-sandboxes.md.
//
// The plugin's CLI runs in the bb server, and so do its sandboxes: this is a single-host proof of
// concept (shared-server, where the server and the threads' daemon are one machine).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { DEFAULT_LIMITS, type NetworkPolicy, type SandboxSpec } from "./core/contract.ts";
import { createBwrapProvider } from "./core/providers/bwrap.ts";
import { createQueue } from "./core/queue.ts";

const OUTPUT_MAX_BYTES = 256 * 1024;
/** Hold new admissions while the host is this loaded (PSI "some" avg10, percent). */
const PRESSURE_CPU = 60;
const PRESSURE_MEMORY = 10;

const USAGE = "bb sandbox run [--net none|open] [--cpus N] [--memory MiB] [--timeout S] [--priority N] -- <command…>";

/** PSI avg10 of `resource`, or 0 where the kernel has no PSI. */
const psi = (resource: "cpu" | "memory"): number => {
  try {
    const line = readFileSync(`/proc/pressure/${resource}`, "utf8").split("\n")[0];
    return Number(/avg10=([\d.]+)/.exec(line)?.[1] ?? 0);
  } catch {
    return 0;
  }
};

interface RunArgs {
  spec: SandboxSpec;
  priority: number;
  argv: string[];
}

export function parseRun(argv: string[]): RunArgs | string {
  const split = argv.indexOf("--");
  if (split === -1 || split === argv.length - 1) return `missing command; usage: ${USAGE}`;
  const limits = { ...DEFAULT_LIMITS };
  let network: NetworkPolicy = { egress: "none" };
  let priority = 0;
  const flags = argv.slice(0, split);
  for (let i = 0; i < flags.length; i += 2) {
    const [flag, value] = [flags[i], flags[i + 1]];
    const number = Number(value);
    if (value === undefined) return `${flag} needs a value; usage: ${USAGE}`;
    if (flag === "--net") {
      if (value !== "none" && value !== "open") return "--net is none or open (allowlists need a provider with an egress proxy)";
      network = { egress: value };
    } else if (!Number.isFinite(number) || number < 0) {
      return `${flag} needs a non-negative number`;
    } else if (flag === "--cpus") limits.cpus = number;
    else if (flag === "--memory") limits.memoryMiB = number;
    else if (flag === "--timeout") limits.timeoutSec = number;
    else if (flag === "--priority") priority = number;
    else return `unknown option ${flag}; usage: ${USAGE}`;
  }
  return { spec: { limits, network }, priority, argv: argv.slice(split + 1) };
}

export default function plugin(bb: BbPluginApi): void {
  const settings = bb.settings.define({
    bwrapPath: { type: "string", label: "bubblewrap binary (bwrap)", default: "bwrap" },
    cgroups: {
      type: "boolean",
      label: "Cap CPU, memory and processes with systemd-run --user (needs the user manager, linger)",
      default: false,
    },
    maxJobs: { type: "number", label: "Sandboxes running at once", default: 4 },
    cpuBudget: { type: "number", label: "CPU budget across running sandboxes (cores)", default: 8 },
    memoryBudgetMiB: { type: "number", label: "Memory budget across running sandboxes (MiB)", default: 12288 },
  });

  // Fixed at load: a changed budget applies on `bb plugin reload sandbox`.
  let queue: ReturnType<typeof createQueue> | null = null;
  const getQueue = async () => {
    if (!queue) {
      const s = await settings.get();
      queue = createQueue(
        { maxJobs: s.maxJobs, cpus: s.cpuBudget, memoryMiB: s.memoryBudgetMiB },
        () => psi("cpu") > PRESSURE_CPU || psi("memory") > PRESSURE_MEMORY,
      );
    }
    return queue;
  };

  // A queue held by pressure has no event to wake it; look again every few seconds.
  bb.background.service("pressure-pump", {
    async start(signal) {
      while (!signal.aborted) {
        queue?.pump();
        await new Promise<void>((r) => {
          const timer = setTimeout(r, 5_000);
          signal.addEventListener("abort", () => (clearTimeout(timer), r()), { once: true });
        });
      }
    },
  });

  bb.cli.register({
    name: "sandbox",
    summary: "Run a command in an isolated, resource-capped sandbox (proof of concept: local bubblewrap provider)",
    commands: [
      { name: "run", summary: "Create a sandbox, run one command, print its output, destroy it", usage: USAGE },
      { name: "status", summary: "Queue state: running, waiting, budget in use", usage: "bb sandbox status" },
    ],
    async run(argv, ctx) {
      const [verb, ...rest] = argv;
      const q = await getQueue();
      if (verb === "status") return { exitCode: 0, stdout: `${JSON.stringify(q.status(), null, 2)}\n` };
      if (verb !== "run") return { exitCode: 2, stderr: `usage: ${USAGE}\n       bb sandbox status\n` };

      const parsed = parseRun(rest);
      if (typeof parsed === "string") return { exitCode: 2, stderr: `${parsed}\n` };
      const s = await settings.get();
      const provider = createBwrapProvider({
        root: join(homedir(), ".local/state/bb-sandbox/sandboxes"),
        bwrap: s.bwrapPath,
        cgroups: s.cgroups,
        outputMaxBytes: OUTPUT_MAX_BYTES,
      });
      const spec: SandboxSpec = { ...parsed.spec, labels: ctx.threadId ? { threadId: ctx.threadId } : {} };
      const { cpus, memoryMiB } = spec.limits;
      return await q.run(
        { cpus, memoryMiB },
        parsed.priority,
        async () => {
          const box = await provider.create(spec, ctx.signal);
          try {
            const result = await provider.exec(box.id, { argv: parsed.argv }, ctx.signal);
            const note = `[sandbox ${box.id} · bwrap · ${result.durationMs} ms · exit ${result.exitCode}${result.timedOut ? " · timed out" : ""}]\n`;
            return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr + note };
          } finally {
            await provider.destroy(box.id);
          }
        },
        ctx.signal,
      );
    },
  });
}
