/**
 * A secret reference: where a key lives, never the key (DESIGN.md → Data
 * model → field types → secret). A field of type `secret` holds one, so a
 * pasted key is refused at write time, before it can reach a committed
 * store. The reference is resolved only by the process that needs the key,
 * through its `SecretSource`.
 *
 * - `env:NAME` names an environment variable of that process;
 * - `keychain:<service>` or `keychain:<service>/<account>` names a generic
 *   password in the platform's keychain (the macOS keychain, the freedesktop
 *   secret service on Linux).
 */
export type SecretRef =
  | { readonly kind: "env"; readonly name: string }
  | { readonly kind: "keychain"; readonly service: string; readonly account?: string };

const ENV = /^env:([A-Za-z_][A-Za-z0-9_]*)$/;
const KEYCHAIN = /^keychain:([^\s/]+)(?:\/([^\s/]+))?$/;

/** The reference `text` writes, or null when it is not one. */
export function parseSecretRef(text: string): SecretRef | null {
  const env = ENV.exec(text);
  if (env?.[1] !== undefined) return { kind: "env", name: env[1] };
  const keychain = KEYCHAIN.exec(text);
  if (keychain?.[1] === undefined) return null;
  const [, service, account] = keychain;
  return account === undefined
    ? { kind: "keychain", service }
    : { kind: "keychain", service, account };
}

/** How a reference reads in a message: what it names, never a value. */
export function secretRefLabel(ref: SecretRef): string {
  if (ref.kind === "env") return `the environment variable ${ref.name}`;
  return ref.account === undefined
    ? `the keychain item ${ref.service}`
    : `the keychain item ${ref.service} (account ${ref.account})`;
}
