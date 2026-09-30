/**
 * A docs view for a test root, made the way any caller makes one: a view
 * node naming `docs.markdown`, added with `node.add` (DESIGN.md → Kinds,
 * roles and options → View nodes).
 */
import { Effect } from "effect";
import { docsViewNodeId, docsViewProps, type DocsViewSpec } from "@kb/model";
import { invokeReceiptEffect, kbRuntimeLayer } from "@kb/runtime";
import { openSession } from "./store-session.ts";

export const addDocsView = Effect.fn("testKit.addDocsView")(function* (
  root: string,
  name: string,
  spec: DocsViewSpec,
) {
  const ctx = yield* openSession(root);
  const props = Object.entries(docsViewProps(spec)).flatMap(([field, values]) =>
    values.map((value) => ({ field, value })),
  );
  const receipt = yield* invokeReceiptEffect(ctx, {
    id: "node.add",
    input: { id: docsViewNodeId(name), text: name, props },
  }).pipe(Effect.provide(kbRuntimeLayer(ctx)));
  if (receipt.status !== "succeeded")
    return yield* Effect.die(new Error(`docs view ${name}: ${receipt.message}`));
  return receipt;
});
