/** POST /api/action — registry.invoke receipt shape (mirrors shared/contracts). */

export type ActionReceipt =
  | { status: "succeeded"; id: string; output: unknown }
  | {
      status: "failed";
      id: string;
      code: string;
      message: string;
      details?: unknown;
    };

export interface ActionInvocation {
  id: string;
  input: unknown;
}

export type PostActionFn = (
  invocation: ActionInvocation,
) => Promise<ActionReceipt>;

let postActionImpl: PostActionFn = defaultPostAction;

const clientOrigin =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `kb-${Math.random().toString(36).slice(2)}`;

/** Stable per-tab origin shared by HTTP actions and the live socket. */
export function getClientOrigin(): string {
  return clientOrigin;
}

async function defaultPostAction(
  invocation: ActionInvocation,
): Promise<ActionReceipt> {
  const res = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-KB-Origin": getClientOrigin() },
    body: JSON.stringify(invocation),
  });
  const json: unknown = await res.json().catch(() => null);
  if (
    json &&
    typeof json === "object" &&
    "status" in json &&
    ((json as ActionReceipt).status === "succeeded" ||
      (json as ActionReceipt).status === "failed")
  ) {
    return json as ActionReceipt;
  }
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

export function postAction(
  id: string,
  input: unknown,
): Promise<ActionReceipt> {
  return postActionImpl({ id, input });
}

/** Invoke and unwrap; throws on failed receipts. */
export async function invokeAction<T>(
  id: string,
  input: unknown = {},
): Promise<T> {
  const receipt = await postAction(id, input);
  if (receipt.status === "failed") {
    throw new Error(`${receipt.code}: ${receipt.message}`);
  }
  return receipt.output as T;
}
