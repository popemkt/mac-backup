// Admission: a sandbox waits until it fits under every cap, then holds a lease on the budget until
// it is destroyed (docs/research/2026-10-31-sandboxes.md §9.6). Caps are a sandbox count and a CPU
// and memory budget; `pressure` holds new admissions while the host is loaded. Higher priority
// first, first in first out within a priority, and the head is never overtaken by a smaller
// request, so a big high-priority sandbox is not starved. A request larger than the whole budget
// is refused at once.

export interface Budget {
  sandboxes: number;
  cpus: number;
  memoryMiB: number;
}

export interface Demand {
  cpus: number;
  memoryMiB: number;
}

export interface Lease {
  readonly demand: Demand;
  /** Idempotent. */
  release(): void;
}

export interface QueueStatus {
  running: number;
  waiting: number;
  used: Demand;
  budget: Budget;
  pressure: boolean;
}

export class QueueRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueRefused";
  }
}

interface Waiter {
  key: string;
  priority: number;
  demand: Demand;
  admit: (lease: Lease) => void;
  reject: (error: Error) => void;
}

export function createQueue(budget: Budget, pressure: () => boolean = () => false) {
  const waiting: Waiter[] = [];
  const used: Demand = { cpus: 0, memoryMiB: 0 };
  let running = 0;

  const fits = (demand: Demand) =>
    running < budget.sandboxes &&
    used.cpus + demand.cpus <= budget.cpus + 1e-9 &&
    used.memoryMiB + demand.memoryMiB <= budget.memoryMiB;

  const take = (demand: Demand): Lease => {
    running += 1;
    used.cpus += demand.cpus;
    used.memoryMiB += demand.memoryMiB;
    let held = true;
    return {
      demand,
      release() {
        if (!held) return;
        held = false;
        running -= 1;
        used.cpus -= demand.cpus;
        used.memoryMiB -= demand.memoryMiB;
        pump();
      },
    };
  };

  function pump(): void {
    while (waiting.length > 0 && fits(waiting[0].demand) && !pressure()) {
      const next = waiting.shift() as Waiter;
      next.admit(take(next.demand));
    }
  }

  const check = (demand: Demand) => {
    if (demand.cpus > budget.cpus || demand.memoryMiB > budget.memoryMiB) {
      throw new QueueRefused(
        `needs ${demand.cpus} CPU / ${demand.memoryMiB} MiB; the whole budget is ${budget.cpus} CPU / ${budget.memoryMiB} MiB`,
      );
    }
  };

  return {
    /** Wait for admission. `key` names the waiter for `cancel`. Aborting `signal` while queued rejects. */
    acquire(key: string, demand: Demand, priority: number, signal?: AbortSignal): Promise<Lease> {
      check(demand);
      return new Promise<Lease>((admit, reject) => {
        const waiter: Waiter = { key, priority, demand, admit, reject };
        const at = waiting.findIndex((w) => w.priority < priority);
        waiting.splice(at === -1 ? waiting.length : at, 0, waiter);
        signal?.addEventListener("abort", () => cancelWaiter(waiter, "cancelled while queued"), { once: true });
        pump();
      });
    },
    /** A lease for a sandbox that was already running before a restart; it counts even over budget. */
    adopt(demand: Demand): Lease {
      return take(demand);
    },
    /** Drop a queued request; false if `key` is not waiting. */
    cancel(key: string, reason = "cancelled while queued"): boolean {
      const waiter = waiting.find((w) => w.key === key);
      return waiter ? cancelWaiter(waiter, reason) : false;
    },
    position(key: string): number {
      return waiting.findIndex((w) => w.key === key);
    },
    status(): QueueStatus {
      return { running, waiting: waiting.length, used: { ...used }, budget, pressure: pressure() };
    },
    /** Look again (pressure has no event of its own). */
    pump,
  };

  function cancelWaiter(waiter: Waiter, reason: string): boolean {
    const index = waiting.indexOf(waiter);
    if (index === -1) return false;
    waiting.splice(index, 1);
    waiter.reject(new QueueRefused(reason));
    return true;
  }
}

export type Queue = ReturnType<typeof createQueue>;
