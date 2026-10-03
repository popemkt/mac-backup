/**
 * What a person trusts: a digest of exactly what runs (DESIGN.md → Sandbox →
 * Trust). It covers the code as stored, every character of it, and the grant
 * it runs under, so changing either is new code that nobody has trusted yet.
 * The digest is always computed by the host from the code it is about to
 * hand an engine, never read from the node or taken from the guest.
 */
import { Effect } from "effect";
import { canonicalJson } from "@kb/model";
import type { CodeGrant } from "./grant.ts";

/** The version of what a digest covers; a change to it drops every trust. */
const DIGEST_FORMAT = "kb.sandbox/1";

/** The digest of a run's code and grant: `sha256:` and 64 hex digits. */
export const codeDigest = Effect.fn("sandbox.codeDigest")(function* (
  code: string,
  grant: CodeGrant,
): Effect.fn.Return<string> {
  const bytes = new TextEncoder().encode(canonicalJson({ format: DIGEST_FORMAT, code, grant }));
  const hash = yield* Effect.promise(() => crypto.subtle.digest("SHA-256", bytes));
  const hex = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0"));
  return `sha256:${hex.join("")}`;
});

/** Whether `text` is a digest {@link codeDigest} could have made. */
export function isCodeDigest(text: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(text);
}
