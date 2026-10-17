/**
 * The environment of a process kb starts: this process's own as it is now,
 * with explicit overrides. Bun hands a child the environment the process
 * started with unless it is given one, so a variable set since (the home
 * store a test names in `KB_HOME`, say) would not reach it.
 */
export function childProcessEnv(
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  // oxlint-disable-next-line node/no-process-env -- a child's environment is this process's, by definition
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...overrides };
}
