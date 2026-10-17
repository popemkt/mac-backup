/**
 * The graph family's actions, `ext.graph.*`, aliased bare beside core's
 * `graph.query` and `graph.search`: trace and suggest, which read the store
 * through the same functions the page reads its replica with (`read.ts`),
 * and typing a relation (`relation.ts`), which writes one ref prop.
 */
import { Effect, Result, Schema } from "effect";
import { z } from "zod";
import { GraphWrites, KbCtx, type ExtensionAction, type KbContext } from "@kb/contracts";
import { currentIso, domainError, type DomainError } from "@kb/model";
import { EdgeKindSchema, type EdgeKind } from "./lens.ts";
import { suggestOf, traceOf } from "./read.ts";
import { typedRelation } from "./relation.ts";
import { SUGGEST_DEFAULTS } from "./suggest.ts";
import { TRACE_DEFAULTS } from "./trace.ts";

const isEdgeKind = Schema.is(EdgeKindSchema);
const edgeKinds = z
  .array(
    z
      .string()
      .refine(isEdgeKind, { message: 'expected mention, child, ref-prop or "prop:<field id>"' }),
  )
  .optional()
  .describe("The relationships walked; default mention, child and ref-prop (every ref field)");
const includeSystem = z
  .boolean()
  .optional()
  .describe(
    "Walk through scaffolding (sys.* nodes, commands, tags and fields) too; by default the graph elides it",
  );

const traceInput = z.object({
  from: z.string().describe("The node the paths start at"),
  to: z.string().describe("The node the paths end at"),
  kinds: edgeKinds,
  k: z.number().int().positive().optional().describe(`How many paths; default ${TRACE_DEFAULTS.k}`),
  maxHops: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(`The longest path, in hops; default ${TRACE_DEFAULTS.maxHops}`),
  includeSystem,
});

const traceOutput = z.object({
  paths: z.array(
    z.object({
      nodes: z.array(z.string()),
      hops: z.array(
        z.object({
          from: z.string(),
          to: z.string(),
          kind: z.string(),
          forward: z.boolean(),
          label: z.string(),
          sentence: z.string(),
        }),
      ),
      hubCost: z.number(),
    }),
  ),
  reason: z.object({ code: z.enum(["same-node", "unreached"]), message: z.string() }).nullable(),
  warnings: z.array(z.string()),
});

const suggestInput = z.object({
  id: z.string().describe("The node to suggest relations for"),
  kinds: edgeKinds,
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(`How many suggestions; default ${SUGGEST_DEFAULTS.limit}`),
  includeSystem,
});

const suggestOutput = z.object({
  suggestions: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      score: z.number(),
      reasons: z.object({
        shared: z.array(z.string()),
        tags: z.array(z.string()),
        citedBy: z.array(z.string()),
      }),
    }),
  ),
});

/** The kinds a call names, which the input schema has already held to `EdgeKindSchema`. */
function kindsOf(kinds: readonly string[] | undefined): EdgeKind[] | undefined {
  return kinds?.filter(isEdgeKind);
}

/** Fails `not_found` on the first of `ids` the store does not hold. */
function existing(
  index: KbContext["index"],
  ids: readonly string[],
): Effect.Effect<void, DomainError> {
  const missing = ids.find((id) => index.getNode(id) === undefined);
  return missing === undefined
    ? Effect.void
    : Effect.fail(domainError("not_found", `node not found: ${missing}`));
}

export const graphTraceEffect = Effect.fn("ext.graph.trace")(function* (
  input: z.infer<typeof traceInput>,
): Effect.fn.Return<z.infer<typeof traceOutput>, DomainError, KbCtx> {
  const { index, nodes } = yield* KbCtx;
  yield* existing(index, [input.from, input.to]);
  const answer = traceOf(nodes, { ...input, kinds: kindsOf(input.kinds) });
  return traceOutput.parse(answer);
});

export const graphSuggestEffect = Effect.fn("ext.graph.suggest")(function* (
  input: z.infer<typeof suggestInput>,
): Effect.fn.Return<z.infer<typeof suggestOutput>, DomainError, KbCtx> {
  const { index, nodes } = yield* KbCtx;
  yield* existing(index, [input.id]);
  return suggestOutput.parse({
    suggestions: suggestOf(nodes, { ...input, kinds: kindsOf(input.kinds) }),
  });
});

const relationInput = z.object({
  source: z.string().describe("The node the relation leaves"),
  target: z.string().describe("The node it points at"),
  field: z.string().describe("The ref field that names the relation; its text is the label"),
});

const relationOutput = z.object({
  source: z.string(),
  target: z.string(),
  field: z.string(),
  /** False when the source already held the relation. */
  written: z.boolean(),
});

export const graphRelationTypeEffect = Effect.fn("ext.graph.relation.type")(function* (
  input: z.infer<typeof relationInput>,
): Effect.fn.Return<z.infer<typeof relationOutput>, DomainError, KbCtx | GraphWrites> {
  const { index } = yield* KbCtx;
  const nodes = new Map([...index.allNodes()].map((node) => [node.id, node]));
  const typed = typedRelation(nodes, input, (edn) => index.runDatalog(edn), yield* currentIso);
  if (Result.isFailure(typed)) return yield* domainError(typed.failure.code, typed.failure.message);
  if (typed.success !== null)
    yield* (yield* GraphWrites).commit({ upserts: [typed.success], deletes: [] });
  return { ...input, written: typed.success !== null };
});

export const GRAPH_ACTIONS: readonly ExtensionAction[] = [
  {
    id: "trace",
    aliases: ["graph.trace"],
    title: "Trace connections",
    description:
      "The k shortest paths between two nodes over the graph's relationships, each hop with its " +
      "kind, its direction, its label and a sentence. Ties in length go to the path through less " +
      "connected nodes. A path is not a datalog relation, so this is not graph.query",
    mode: { kind: "read" },
    inputSchema: traceInput,
    outputSchema: traceOutput,
    effect: graphTraceEffect,
  },
  {
    id: "suggest",
    aliases: ["graph.suggest"],
    title: "Suggest relations",
    description:
      "Nodes the relationships do not connect to a node but whose structure says they relate: " +
      "shared neighbours (Adamic-Adar), shared tags by rarity, and co-citation, each with its reasons",
    mode: { kind: "read" },
    inputSchema: suggestInput,
    outputSchema: suggestOutput,
    effect: graphSuggestEffect,
  },
  {
    id: "relation.type",
    aliases: ["graph.relation.type"],
    title: "Type a relation",
    description:
      "Say what a connection means: add one ref prop of a ref field from source to target, in " +
      "one transaction, leaving the text (and any mention of the target) as it is. The field " +
      "node's text is the relation's label. Refuses a field that is not a ref and a target the " +
      "field does not allow; typing a relation the source already holds writes nothing",
    mode: { kind: "write" },
    inputSchema: relationInput,
    outputSchema: relationOutput,
    effect: graphRelationTypeEffect,
  },
];
