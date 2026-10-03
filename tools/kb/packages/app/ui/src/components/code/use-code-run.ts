/**
 * The two things a code view knows about a run beyond its code: whether a
 * person trusts it (by the digest of exactly what runs, computed here from
 * the code the page shows and hands the frame), and the calls it made that
 * wait for the person's answer.
 */
import { useEffect, useState } from "react";
import { Effect, Schema } from "effect";
import type { ActionInvocation } from "@kb/contracts";
import { codeDigest } from "@kb/sandbox";
import { canonicalJson } from "@kb/model";
import { CodeGrant } from "@kb/views";
import { browserHost, type SandboxPorts } from "@/sdk";

/** What is known of a run's trust: its digest, and whether it is trusted here. */
export interface CodeTrustState {
  readonly digest: string;
  readonly trusted: boolean;
}

const decodeGrant = Schema.decodeUnknownSync(Schema.fromJsonString(CodeGrant));

/**
 * The trust of `code` under `grant`, or null while it is being worked out;
 * `refresh` asks again (after a trust gesture). The grant is compared by its
 * canonical JSON: a host decodes a fresh one on every change to the graph,
 * and an edit elsewhere must not stop the run to ask again.
 */
export function useCodeTrust(
  code: string,
  grant: CodeGrant,
): { readonly trust: CodeTrustState | null; readonly refresh: () => void } {
  const grantKey = canonicalJson(grant);
  const [round, setRound] = useState(0);
  const [known, setKnown] = useState<
    | (CodeTrustState & {
        readonly code: string;
        readonly grantKey: string;
        readonly round: number;
      })
    | null
  >(null);
  useEffect(() => {
    let live = true;
    void Effect.runPromise(codeDigest(code, decodeGrant(grantKey)))
      .then(async (digest) => ({ digest, trusted: await browserHost().sandbox.isTrusted(digest) }))
      .then((state) => {
        if (live) setKnown({ ...state, code, grantKey, round });
      });
    return () => {
      live = false;
    };
  }, [code, grantKey, round]);
  // An answer for other code, or from before the last gesture, is no answer.
  const current =
    known !== null && known.code === code && known.grantKey === grantKey && known.round === round
      ? { digest: known.digest, trusted: known.trusted }
      : null;
  return { trust: current, refresh: () => setRound((n) => n + 1) };
}

/** A call the code made that waits for the person's answer. */
export interface Asking {
  readonly invocation: ActionInvocation;
  readonly answer: (approved: boolean) => void;
}

/**
 * The ports a frame takes, stable for the page's life (a frame reads them
 * once), and the calls waiting for the person. A call the invoke core
 * answers `approval_required` waits here; the person's answer makes the same
 * call as the script's, approved or not, so declining is refused again by
 * the invoke core and the code is told so.
 */
export function useSandboxPorts(): {
  readonly ports: SandboxPorts;
  readonly asking: readonly Asking[];
} {
  const [asking, setAsking] = useState<readonly Asking[]>([]);
  const [ports] = useState<SandboxPorts>(() => ({
    node: (id) => browserHost().node(id),
    invoke: async (invocation) => {
      const receipt = await browserHost().sandbox.invokeAsScript(invocation);
      if (receipt.status !== "failed" || receipt.code !== "approval_required") return receipt;
      const approved = await new Promise<boolean>((resolve) => {
        const entry: Asking = {
          invocation,
          answer: (answer) => {
            setAsking((queue) => queue.filter((waiting) => waiting !== entry));
            resolve(answer);
          },
        };
        setAsking((queue) => [...queue, entry]);
      });
      return browserHost().sandbox.invokeAsScript(
        approved ? { ...invocation, approved: true } : invocation,
      );
    },
  }));
  return { ports, asking };
}
