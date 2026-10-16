import { Effect, Schema } from "effect";
import { secretRefLabel, type SecretRef } from "@kb/model";

/**
 * Where a process reads a key a secret field refers to (DESIGN.md → Data
 * model → a secret is a reference): kb stores no key, and reads one only
 * through a reference a person wrote, in the process that needs it. A
 * composition root binds it (`kb ui` binds the environment and the platform
 * keychain); the browser never holds one, so it never sees a value.
 */
export interface SecretSource {
  /** The key `ref` names. A failure names the reference, never a value. */
  readonly resolve: (ref: SecretRef) => Effect.Effect<string, SecretError>;
}

/** A reference that does not resolve here: unset, not found, or no keychain to ask. */
export class SecretError extends Schema.TaggedError<SecretError>()("Kb/SecretError", {
  message: Schema.String,
}) {}

/** A source that holds no key: every reference fails, naming what it refers to. */
export const NO_SECRETS: SecretSource = {
  resolve: (ref) =>
    Effect.fail(new SecretError({ message: `${secretRefLabel(ref)}: this process reads no keys` })),
};
