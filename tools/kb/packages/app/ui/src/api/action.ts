/** POST /api/action — the receipt and, on success, the rev it committed at (protocol.ts). */

import { ActionResponseSchema, type ActionInvocation, type ActionResponse } from "@kb/contracts";

export type { ActionInvocation, ActionResponse };

export type PostActionFn = (invocation: ActionInvocation) => Promise<ActionResponse>;

let postActionImpl: PostActionFn = defaultPostAction;

const clientOrigin =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `kb-${Math.random().toString(36).slice(2)}`;

/** Stable per-tab origin shared by HTTP actions and the live socket. */
export function getClientOrigin(): string {
  return clientOrigin;
}

async function defaultPostAction(invocation: ActionInvocation): Promise<ActionResponse> {
  const res = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-KB-Origin": getClientOrigin() },
    body: JSON.stringify(invocation),
  });
  const json: unknown = await res.json().catch(() => null);
  const parsed = ActionResponseSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  return {
    status: "failed",
    id: invocation.id,
    code: "internal",
    message: `POST /api/action → ${res.status}`,
  };
}

/** Inject a mock for tests. */
export function setPostAction(fn: PostActionFn | null): void {
  postActionImpl = fn ?? defaultPostAction;
}

/** Send one invocation, its whole envelope, to the server. */
export function postAction(invocation: ActionInvocation): Promise<ActionResponse> {
  return postActionImpl(invocation);
}
