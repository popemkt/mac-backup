/**
 * The extensions as actions: `extension.switch`, the checked write of a
 * family's switch, and `extension.footprint`, the read of what a family adds.
 *
 * `extension.switch`: turn an optional family on or off for this store
 * (DESIGN.md → Extension families → optional is a server-side load
 * decision). It writes the family's switch node (`switchWrites`), so the
 * registry loads the family, or leaves it out, from the next call on, and
 * `kb.manifest` reports it so. The switch is a setting of every extension's
 * node, so this is the checked verb over a write `node.update` could make
 * too: it refuses a family that is unknown or not optional, and commits
 * through the same system-write rule (`persistEffect`) as every write.
 * The page's Preferences row calls it, and so may the CLI. It changes which
 * code the server loads, so the seeded approval policies ask an agent and
 * deny sandboxed code (DESIGN.md → Action registry → Approval).
 */
import { Effect } from "effect";
import { z } from "zod";
import {
  ExtensionCatalog,
  FamilyKernels,
  FootprintRowSchema,
  KbCtx,
  holdsFamily,
  runtimeFootprint,
  switchWrites,
  type ActionDefinition,
  type FamilyKernel,
  type FootprintRow,
  type KbStore,
} from "@kb/contracts";
import {
  SYSTEM_IDS,
  currentIso,
  domainError,
  extensionNameOf,
  extensionNodeId,
  typeRefsOf,
  type DomainError,
} from "@kb/model";
import type { KbIndex } from "@kb/query";
import { persistEffect, reloadEffect } from "./session.ts";

export const extensionSwitchDef = {
  id: "extension.switch",
  title: "Switch an extension",
  description:
    "Turn an optional extension (as kb.manifest lists it, optional: true) on or off for this kb: the server loads it, or leaves it out, from the next call on",
  mode: { kind: "write" } as const,
  inputSchema: z.object({ name: z.string().min(1), on: z.boolean() }),
  outputSchema: z.object({ name: z.string(), on: z.boolean() }),
} satisfies ActionDefinition;

export const extensionSwitchEffect = Effect.fn("extension.switch")(function* (
  input: z.infer<typeof extensionSwitchDef.inputSchema>,
): Effect.fn.Return<
  z.infer<typeof extensionSwitchDef.outputSchema>,
  DomainError,
  ExtensionCatalog | KbCtx | KbStore
> {
  // A family a host composes (the agent, by `kb ui`) is in this catalog only where that host
  // runs, so only there can its switch be written. GAP [[01M43H3T8XEMTNBARC024PZD2W]]
  const row = (yield* ExtensionCatalog).find((candidate) => candidate.name === input.name);
  if (row === undefined) {
    return yield* domainError("not_found", `no extension named ${input.name}`, {
      name: input.name,
    });
  }
  if (!row.optional) {
    return yield* domainError(
      "invalid_input",
      `${input.name} is not optional: it is on wherever it is loaded`,
      { name: input.name },
    );
  }
  const ctx = yield* KbCtx;
  // Read the switch as the store has it now: another process may have written it first.
  yield* reloadEffect(ctx);
  const upserts = switchWrites(row, input.on, (id) => ctx.index.getNode(id), yield* currentIso);
  yield* persistEffect(ctx, { upserts, deletes: [] });
  return { name: input.name, on: input.on };
});

export const extensionFootprintDef = {
  id: "extension.footprint",
  title: "An extension's footprint",
  description:
    "What each extension adds to this kb, or the one named: the nodes its declaration seeds, each with its kind, and what its plugins contribute to the hosts running now (actions, templates, views, channels), each with the point it went to, and whether the extension is loaded",
  mode: { kind: "read" } as const,
  inputSchema: z.object({ name: z.string().min(1).optional() }),
  outputSchema: z.object({ rows: z.array(FootprintRowSchema) }),
} satisfies ActionDefinition;

/** What `family`'s declaration seeds, as `index` answers `:node/owner`, in id order. */
function seedFootprint(index: KbIndex, family: string, enabled: boolean): FootprintRow[] {
  const owner = JSON.stringify(extensionNodeId(family));
  const ids = index
    .runDatalog(`[:find ?id :where [?e :node/id ${owner}] [?n :node/owner ?e] [?n :node/id ?id]]`)
    .flatMap(([id]) => (typeof id === "string" ? [id] : []))
    .toSorted();
  return ids.map((id) => ({
    family,
    kind: typeRefsOf(index.getNode(id))[0] ?? "node",
    id,
    enabled,
    source: "seed",
  }));
}

/** A family's whole footprint over `index` and `kernels`: its seed's rows, then each kernel's. */
export function familyFootprint(
  index: KbIndex,
  family: string,
  kernels: readonly FamilyKernel[],
): FootprintRow[] {
  const enabled = kernels.some((held) => holdsFamily(held, family));
  return [
    ...seedFootprint(index, family, enabled),
    ...kernels.flatMap((held) => runtimeFootprint(family, held)),
  ];
}

/**
 * `extension.footprint`: the rows of every extension the store has a node
 * for under `sys.extensions`, core's included, or of the one named. Data
 * rows read the index's `:node/owner`, so they hold whether the family is
 * loaded or not; runtime rows read the kernels this host holds families in
 * (`FamilyKernels`), so a family switched off has none.
 */
export const extensionFootprintEffect = Effect.fn("extension.footprint")(function* (
  input: z.infer<typeof extensionFootprintDef.inputSchema>,
): Effect.fn.Return<
  z.infer<typeof extensionFootprintDef.outputSchema>,
  DomainError,
  FamilyKernels | KbCtx
> {
  const ctx = yield* KbCtx;
  const kernels = yield* FamilyKernels;
  const families = (ctx.index.getNode(SYSTEM_IDS.extensionsRoot)?.children ?? []).flatMap(
    (id) => extensionNameOf(id) ?? [],
  );
  const named =
    input.name === undefined ? families : families.filter((name) => name === input.name);
  if (input.name !== undefined && named.length === 0) {
    return yield* domainError("not_found", `no extension named ${input.name}`, {
      name: input.name,
    });
  }
  return { rows: named.flatMap((family) => familyFootprint(ctx.index, family, kernels)) };
});
