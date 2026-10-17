/**
 * The environment of a process kb starts, the one place it is decided. A
 * child is given what its kind needs of this process's environment as it is
 * now, plus explicit overrides; Bun hands a child the environment the
 * process started with unless it is given one, so a variable set since (the
 * home store a test names in `KB_HOME`, say) would not reach it otherwise.
 *
 * - `kb`: a kb process over a root, such as the `kb ui` a location's open
 *   starts. It gets what any program needs to run (the base) and kb's own
 *   settings (`KB_*`, and `XDG_*` where the home store lives on Linux), and
 *   nothing else: a root someone else wrote may name an `env:` credential,
 *   so no key of this process's reaches a server over it.
 * - `lookup`: a keychain or secret-service lookup. The base, and the session
 *   bus the freedesktop secret service answers on.
 * - `agent`: the agent runtime kb hosts for the person (Claude Code, under
 *   the sidebar agent). The base, where it keeps its state (`XDG_*`,
 *   `CLAUDE_CONFIG_DIR`), the network it reaches through (proxies and
 *   certificates), and the person's own Claude login, which the adapter
 *   passes on only to a provider that names neither an endpoint nor a key.
 *   No other key of this process's reaches it.
 * - `tool`: the person's own developer tool kb runs for them (Vite, under
 *   `kb ui --dev`), which runs as their shell would: the whole environment.
 */
export type ChildKind = "kb" | "lookup" | "agent" | "tool";

/** What any program needs to run as this user. */
const BASE = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TZ", "LANG", "TERM"];
const BASE_PREFIXES = ["LC_"];

const KEEPS: Readonly<
  Record<Exclude<ChildKind, "tool">, { names: readonly string[]; prefixes: readonly string[] }>
> = {
  kb: { names: BASE, prefixes: [...BASE_PREFIXES, "KB_", "XDG_"] },
  lookup: {
    names: [...BASE, "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"],
    prefixes: BASE_PREFIXES,
  },
  agent: {
    names: [
      ...BASE,
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "NODE_EXTRA_CA_CERTS",
      "SSL_CERT_FILE",
      "CLAUDE_CONFIG_DIR",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_BASE_URL",
    ],
    prefixes: [...BASE_PREFIXES, "XDG_"],
  },
};

export function childProcessEnv(
  kind: ChildKind,
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  const keep =
    kind === "tool"
      ? () => true
      : (key: string) =>
          KEEPS[kind].names.includes(key) ||
          KEEPS[kind].prefixes.some((prefix) => key.startsWith(prefix));
  // oxlint-disable-next-line node/no-process-env -- a child's environment is this process's, by definition
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && keep(key)) env[key] = value;
  }
  return { ...env, ...overrides };
}
