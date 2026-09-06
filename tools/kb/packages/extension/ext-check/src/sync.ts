import { Effect } from "effect";
import { KbCtx } from "@kb/contracts";
import { currentIso, type KbNode, type NodeId } from "@kb/model";
import { persistEffect } from "@kb/operations";
import { buildCheckModel, derivedEnforcement, propText, syncOutput } from "./model.ts";

function replaceEnforcement(node: KbNode, field: NodeId, value: NodeId, at: string): KbNode {
  const props = Object.fromEntries(
    Object.entries(node.props).map(([id, values]) => [id, [...values]]),
  );
  delete props[field];
  props[field] = [{ t: "ref", v: value }];
  return { ...node, props, children: [...node.children], updatedAt: at };
}

export const checkSyncEffect = Effect.fn("ext.check.sync")(function* (_input: object) {
  const ctx = yield* KbCtx;
  const model = buildCheckModel(ctx.nodes);
  const enforcementField = model.fieldIds.get("enforcement");
  if (enforcementField === undefined) return syncOutput.parse({ updated: [] });

  const at = yield* currentIso;
  const upserts: KbNode[] = [];
  for (const rule of model.rules) {
    const derived = derivedEnforcement(model, rule).value;
    const valueId = derived === undefined ? undefined : model.enforcementIds.get(derived);
    if (valueId === undefined || propText(model, rule, "enforcement") === derived) continue;
    upserts.push(replaceEnforcement(rule, enforcementField, valueId, at));
  }

  if (upserts.length > 0) yield* persistEffect(ctx, { upserts, deletes: [] });
  return syncOutput.parse({ updated: upserts.map((node) => node.id) });
});
