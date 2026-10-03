/**
 * Trusting code (DESIGN.md → Sandbox → Trust): a person says that the code
 * with this digest, the digest of exactly what their UI showed and ran, may
 * run in a Worker on this machine. Trust is local state behind the
 * `CodeTrust` port, never a node.
 *
 * `sandbox.trust` declares approval, so it asks everyone but a person's own
 * gesture, and the seed denies it to agents and to sandboxed code outright:
 * no code can promote itself, and no agent can promote code a person has not
 * looked at. Dropping trust is always safe, so `sandbox.untrust` asks nobody.
 */
import { Effect } from "effect";
import { z } from "zod";
import { CodeTrust, type ActionDefinition } from "@kb/contracts";
import type { DomainError } from "@kb/model";
import { isCodeDigest } from "@kb/sandbox";

const Digest = z.string().refine(isCodeDigest, "a code digest: sha256: followed by 64 hex digits");

export const sandboxTrustDef = {
  id: "sandbox.trust",
  title: "Trust code",
  description:
    "Trust sandboxed code on this machine by the digest of exactly what runs (its code and its grant), so it runs in a Worker instead of QuickJS. A person's own gesture in the kb UI; it is never written to the graph.",
  mode: { kind: "write", approval: "required" } as const,
  inputSchema: z.object({ digest: Digest }),
  outputSchema: z.object({ digest: z.string(), trusted: z.literal(true) }),
} satisfies ActionDefinition;

export const sandboxUntrustDef = {
  id: "sandbox.untrust",
  title: "Stop trusting code",
  description:
    "Stop trusting sandboxed code on this machine, by its digest: it runs in QuickJS again.",
  mode: { kind: "write" } as const,
  inputSchema: z.object({ digest: Digest }),
  outputSchema: z.object({ digest: z.string(), trusted: z.literal(false) }),
} satisfies ActionDefinition;

export const sandboxTrustedDef = {
  id: "sandbox.trusted",
  title: "Trusted code",
  description: "Which of these code digests a person has trusted on this machine.",
  mode: { kind: "read" } as const,
  inputSchema: z.object({ digests: z.array(Digest).max(100) }),
  outputSchema: z.object({ trusted: z.array(z.string()) }),
} satisfies ActionDefinition;

export const sandboxTrustEffect = Effect.fn("sandbox.trust")(function* (
  input: z.infer<typeof sandboxTrustDef.inputSchema>,
): Effect.fn.Return<z.infer<typeof sandboxTrustDef.outputSchema>, DomainError, CodeTrust> {
  yield* (yield* CodeTrust).trust(input.digest);
  return { digest: input.digest, trusted: true };
});

export const sandboxUntrustEffect = Effect.fn("sandbox.untrust")(function* (
  input: z.infer<typeof sandboxUntrustDef.inputSchema>,
): Effect.fn.Return<z.infer<typeof sandboxUntrustDef.outputSchema>, DomainError, CodeTrust> {
  yield* (yield* CodeTrust).untrust(input.digest);
  return { digest: input.digest, trusted: false };
});

export const sandboxTrustedEffect = Effect.fn("sandbox.trusted")(function* (
  input: z.infer<typeof sandboxTrustedDef.inputSchema>,
): Effect.fn.Return<z.infer<typeof sandboxTrustedDef.outputSchema>, DomainError, CodeTrust> {
  return { trusted: [...(yield* (yield* CodeTrust).trusted(input.digests))] };
});
