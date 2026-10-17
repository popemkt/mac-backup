/**
 * This machine, as a URL names it. A request to a loopback host never leaves
 * the machine, so it is the one place kb sends plain `http` (a local model
 * server) and the one place it looks for another `kb ui`.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "[::1]"]);

/** Whether `host`, a URL's `hostname`, is this machine: `localhost`, `::1` or an address in 127.0.0.0/8. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}
