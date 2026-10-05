import { Effect } from "effect";
import { GraphWrites, KbCtx } from "@kb/contracts";
import { currentIso, type KbNode, type NodeId } from "@kb/model";
import {
  buildCheckModel,
  derivedEnforcement,
  propText,
  syncOutput,
  type CheckModel,
  type EmptyInput,
} from "./model.ts";

function replaceEnforcement(node: KbNode, field: NodeId, value: NodeId, at: string): KbNode {
  const props = Object.fromEntries(
    Object.entries(node.props).map(([id, values]) => [id, [...values]]),
  );
  delete props[field];
  props[field] = [{ t: "ref", v: value }];
  return { ...node, props, children: [...node.children], updatedAt: at };
}

/**
 * Each rule whose stored enforcement is not the one its check surface
 * derives, rewritten to hold the derived one as of `at`. A rule whose derived
 * level is no option of the field is left alone.
 */
export function enforcementSyncs(model: CheckModel, at: string): KbNode[] {
  const enforcementField = model.fieldIds.get("enforcement");
  if (enforcementField === undefined) return [];
  const upserts: KbNode[] = [];
  for (const rule of model.rules) {
    const derived = derivedEnforcement(model, rule).value;
    const valueId = derived === undefined ? undefined : model.enforcementIds.get(derived);
    if (valueId === undefined || propText(model, rule, "enforcement") === derived) continue;
    upserts.push(replaceEnforcement(rule, enforcementField, valueId, at));
  }
  return upserts;
}

export const checkSyncEffect = Effect.fn("ext.check.sync")(function* (_input: EmptyInput) {
  const ctx = yield* KbCtx;
  const upserts = enforcementSyncs(buildCheckModel(ctx.nodes), yield* currentIso);
  if (upserts.length > 0) yield* (yield* GraphWrites).commit({ upserts, deletes: [] });
  return syncOutput.parse({ updated: upserts.map((node) => node.id) });
});
