// Admission queue: a job waits until it fits under every cap, then runs. Caps are a job count and
// a CPU and memory budget (the sum of running jobs' limits), so a single box is never asked for
// more than it has. Higher priority first; first in, first out within a priority. A job that alone
// exceeds the budget is refused at submit instead of waiting forever. `pressure` lets the caller
// hold admissions while the host is loaded (the server reads /proc/pressure); running jobs are
// never touched.

export interface Budget {
  maxJobs: number;
  cpus: number;
  memoryMiB: number;
}

export interface Demand {
  cpus: number;
  memoryMiB: number;
}

interface Waiter {
  seq: number;
  priority: number;
  demand: Demand;
  admit: () => void;
  reject: (error: Error) => void;
}

export interface QueueStatus {
  running: number;
  waiting: number;
  used: Demand;
  budget: Budget;
}

export class QueueRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueRefused";
  }
}

export function createQueue(budget: Budget, pressure: () => boolean = () => false) {
  const waiting: Waiter[] = [];
  const used: Demand = { cpus: 0, memoryMiB: 0 };
  let running = 0;
  let seq = 0;

  const fits = (demand: Demand) =>
    running < budget.maxJobs &&
    used.cpus + demand.cpus <= budget.cpus &&
    used.memoryMiB + demand.memoryMiB <= budget.memoryMiB;

  const pump = () => {
    // Strict order: the head waits for room rather than being overtaken by smaller jobs, so a big
    // high-priority job is not starved.
    while (waiting.length > 0 && !pressure() && fits(waiting[0].demand)) {
      const next = waiting.shift() as Waiter;
      running += 1;
      used.cpus += next.demand.cpus;
      used.memoryMiB += next.demand.memoryMiB;
      next.admit();
    }
  };

  const release = (demand: Demand) => {
    running -= 1;
    used.cpus -= demand.cpus;
    used.memoryMiB -= demand.memoryMiB;
    pump();
  };

  /** Run `job` once admitted; resolves with its result. Aborting `signal` while waiting rejects. */
  async function run<T>(demand: Demand, priority: number, job: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (demand.cpus > budget.cpus || demand.memoryMiB > budget.memoryMiB) {
      throw new QueueRefused(
        `job needs ${demand.cpus} CPU / ${demand.memoryMiB} MiB; the budget is ${budget.cpus} CPU / ${budget.memoryMiB} MiB`,
      );
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { seq: seq++, priority, demand, admit: resolve, reject };
      const at = waiting.findIndex((w) => w.priority < priority);
      waiting.splice(at === -1 ? waiting.length : at, 0, waiter);
      signal?.addEventListener(
        "abort",
        () => {
          const index = waiting.indexOf(waiter);
          if (index !== -1) {
            waiting.splice(index, 1);
            reject(new QueueRefused("cancelled while queued"));
          }
        },
        { once: true },
      );
      pump();
    });
    try {
      return await job();
    } finally {
      release(demand);
    }
  }

  const status = (): QueueStatus => ({ running, waiting: waiting.length, used: { ...used }, budget });

  return { run, status, pump };
}
