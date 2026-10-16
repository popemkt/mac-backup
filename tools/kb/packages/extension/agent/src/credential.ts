import { Effect } from "effect";
import type { SecretSource } from "@kb/contracts";
import { parseSecretRef } from "@kb/model";
import { AgentRuntimeError } from "./runtime.ts";

/**
 * The key a provider's credential refers to, read when a turn needs it, or
 * undefined for a provider that names none. The write check already holds
 * the field to a reference; one that still does not read is refused here
 * too, and a failure names the reference, never a value.
 */
export const resolveCredential = Effect.fn("kb.agent.resolveCredential")(function* (
  credential: string | null,
  secrets: SecretSource,
): Effect.fn.Return<string | undefined, AgentRuntimeError> {
  if (credential === null) return undefined;
  const ref = parseSecretRef(credential);
  if (ref === null) {
    return yield* new AgentRuntimeError({
      message: "The provider's credential is not a secret reference (env:NAME or keychain:…).",
    });
  }
  return yield* secrets
    .resolve(ref)
    .pipe(Effect.mapError((error) => new AgentRuntimeError({ message: error.message })));
});
