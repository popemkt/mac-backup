// Which bb machine runs the backend's agent. Resolved from bb itself (its host list and primary host), never
// hard-coded: one machine in a single-machine bb, and in a multi-machine bb the bb server's own machine first, then
// any other connected machine where the backend is usable.

export interface Machine {
  id: string;
  name: string;
  connected: boolean;
  /** The machine the bb server runs on (bb's primary host). */
  isServer: boolean;
}

/** Candidates in the order to try: an explicit choice alone, else connected machines, the server's first. */
export function candidates(machines: Machine[], preferred: string): Machine[] {
  const want = preferred.trim();
  if (want !== "") {
    const m = machines.find(x => x.id === want || x.name === want);
    return m === undefined ? [] : [m];
  }
  return machines
    .filter(m => m.connected)
    .sort((a, b) => Number(b.isServer) - Number(a.isServer) || a.name.localeCompare(b.name));
}

export type Probe<T> = { machine: Machine; result: T };

/**
 * Picks the first candidate whose probe is `ready`; failing that, the first whose probe is `usable` (e.g. Codex is
 * installed but signed out, so the person can sign in there); failing that, the first candidate with its result.
 */
export function pick<T>(probes: Probe<T>[], ready: (r: T) => boolean, usable: (r: T) => boolean): Probe<T> | null {
  return probes.find(p => ready(p.result)) ?? probes.find(p => usable(p.result)) ?? probes[0] ?? null;
}
