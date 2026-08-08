/** POST /api/action — registry invocation with typed receipts. */

export type ActionReceipt =
  | { status: "succeeded"; id: string; output: unknown }
  | {
      status: "failed";
      id: string;
      code: string;
      message: string;
      details?: unknown;
    };

export async function postAction(
  id: string,
  input: unknown = {},
): Promise<ActionReceipt> {
  const res = await fetch("/api/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, input }),
  });
  const json = (await res.json()) as ActionReceipt;
  return json;
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
