import { Effect } from "effect";
import { SecretError, type SecretSource } from "@kb/contracts";
import { secretRefLabel, type SecretRef } from "@kb/model";
import { childProcessEnv } from "./child-env.ts";

/** What one keychain lookup answered: its exit code and what it printed. */
export interface LookupResult {
  readonly code: number;
  readonly stdout: string;
}

/**
 * How the platform keychain is asked: the command line, and what it
 * answered. `signal` aborts when the lookup is given up, and the lookup
 * stops with it.
 */
export type RunLookup = (argv: readonly string[], signal: AbortSignal) => Promise<LookupResult>;

/**
 * How long a keychain lookup may take. The macOS keychain may ask the person
 * to allow the read, so this leaves time to answer; past it the lookup is
 * killed and the reference fails, so a turn never hangs on it.
 */
const LOOKUP_TIMEOUT_MS = 30_000;

/** The keychain command for `ref` on `platform`, or null where kb knows none. */
function keychainArgv(
  ref: Extract<SecretRef, { kind: "keychain" }>,
  platform: string,
): readonly string[] | null {
  const account = ref.account;
  if (platform === "darwin") {
    return [
      "security",
      "find-generic-password",
      "-s",
      ref.service,
      ...(account === undefined ? [] : ["-a", account]),
      "-w",
    ];
  }
  if (platform === "linux") {
    return [
      "secret-tool",
      "lookup",
      "service",
      ref.service,
      ...(account === undefined ? [] : ["account", account]),
    ];
  }
  return null;
}

/** A lookup as a child process, killed outright when `signal` aborts. */
const runProcess: RunLookup = (argv, signal) => {
  const child = Bun.spawn([...argv], {
    stdout: "pipe",
    stderr: "ignore",
    stdin: "ignore",
    env: childProcessEnv("lookup"),
    signal,
    killSignal: "SIGKILL",
  });
  return Promise.all([new Response(child.stdout).text(), child.exited]).then(([stdout, code]) => ({
    code,
    stdout,
  }));
};

/**
 * The secret source a `kb ui` process binds (DESIGN.md → Data model → a
 * secret is a reference): an `env:` reference reads this process's
 * environment, and a `keychain:` one asks the macOS keychain (`security`) or
 * the freedesktop secret service (`secret-tool`), killed if it has not
 * answered within `timeoutMs`. A reference that does not resolve fails with
 * what it names, never with a value.
 */
export function systemSecrets(
  options: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly platform?: string;
    readonly run?: RunLookup;
    readonly timeoutMs?: number;
  } = {},
): SecretSource {
  // oxlint-disable-next-line node/no-process-env -- the env: reference is this process's environment by definition
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runProcess;
  const timeoutMs = options.timeoutMs ?? LOOKUP_TIMEOUT_MS;
  return {
    resolve: Effect.fn("kb.secrets.resolve")(function* (ref: SecretRef) {
      const missing = () => new SecretError({ message: `${secretRefLabel(ref)} is not set` });
      if (ref.kind === "env") {
        const value = env[ref.name];
        return value === undefined || value === "" ? yield* missing() : value;
      }
      const argv = keychainArgv(ref, platform);
      if (argv === null) {
        return yield* new SecretError({
          message: `${secretRefLabel(ref)}: kb reads no keychain on ${platform}`,
        });
      }
      const answer = yield* Effect.tryPromise({
        try: (signal) => run(argv, signal),
        catch: () =>
          new SecretError({
            message: `${secretRefLabel(ref)}: ${argv[0] ?? "the keychain"} did not run`,
          }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () =>
            Effect.fail(
              new SecretError({
                message: `${secretRefLabel(ref)}: ${argv[0] ?? "the keychain"} did not answer within ${timeoutMs / 1000}s`,
              }),
            ),
        }),
      );
      const value = answer.stdout.replace(/\r?\n$/, "");
      return answer.code !== 0 || value === "" ? yield* missing() : value;
    }),
  };
}
