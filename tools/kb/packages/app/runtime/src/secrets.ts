import { Effect } from "effect";
import { SecretError, type SecretSource } from "@kb/contracts";
import { secretRefLabel, type SecretRef } from "@kb/model";

/** What one keychain lookup answered: its exit code and what it printed. */
export interface LookupResult {
  readonly code: number;
  readonly stdout: string;
}

/** How the platform keychain is asked: the command line, and what it answered. */
export type RunLookup = (argv: readonly string[]) => Promise<LookupResult>;

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

const runProcess: RunLookup = (argv) => {
  const child = Bun.spawn([...argv], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  return Promise.all([new Response(child.stdout).text(), child.exited]).then(([stdout, code]) => ({
    code,
    stdout,
  }));
};

/**
 * The secret source a `kb ui` process binds (DESIGN.md → Data model → a
 * secret is a reference): an `env:` reference reads this process's
 * environment, and a `keychain:` one asks the macOS keychain (`security`) or
 * the freedesktop secret service (`secret-tool`). A reference that does not
 * resolve fails with what it names, never with a value.
 */
export function systemSecrets(
  options: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly platform?: string;
    readonly run?: RunLookup;
  } = {},
): SecretSource {
  // oxlint-disable-next-line node/no-process-env -- the env: reference is this process's environment by definition
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runProcess;
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
        try: () => run(argv),
        catch: () =>
          new SecretError({
            message: `${secretRefLabel(ref)}: ${argv[0] ?? "the keychain"} did not run`,
          }),
      });
      const value = answer.stdout.replace(/\r?\n$/, "");
      return answer.code !== 0 || value === "" ? yield* missing() : value;
    }),
  };
}
