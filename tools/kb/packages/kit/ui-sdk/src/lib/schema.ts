/**
 * Where a node's schema is read from: the whole graph, whatever a projection
 * shows.
 *
 * A projection (`NodeMap`) may hold only part of the graph — under an
 * ontology scope only members, because scope decides which content is listed
 * and navigated to. What that content *means* is not scoped: a field's name,
 * declared type, cardinality, hidden flag and option set, a tag's name and
 * templated fields, and the label of a ref value are resolved against every
 * node.
 *
 * So schema is a type of its own. {@link SchemaIndex} is a read-only view of the
 * whole graph; every function that reads a definition takes a `SchemaIndex`,
 * never a `NodeMap`. Handing a projection to a schema reader is then a compile
 * error rather than a bug that only shows under a scope — which is how the
 * same bug was found four times over before the type existed.
 *
 * A schema is built from the graph snapshot alone ({@link schemaOf}): each
 * snapshot (`wireNodes` identity, which every graph move renews) builds one
 * schema map, so a selector over it is referentially stable and no reader
 * decides what it is. A node map that already is a whole graph — a fixture,
 * a story — is its own schema ({@link schemaOfGraph}).
 */
import type { WireNode } from "@kb/contracts";
import type { KbIndex } from "../query";
import { isPartialProjection, wireToOutlineMap } from "./graph-view";
import type { NodeMap, OutlineNode } from "./types";

declare const schemaBrand: unique symbol;

/** The whole graph, read-only, as every field and tag definition is resolved. */
export type SchemaIndex = ReadonlyMap<string, OutlineNode> & { readonly [schemaBrand]: true };

/** What a schema is built from: the graph snapshot. */
export interface SchemaSource {
  readonly wireNodes: readonly WireNode[];
}

interface Built {
  readonly wire: readonly WireNode[];
  readonly schema: SchemaIndex;
}

/**
 * The schemas built last, newest first: a move's before and after, which are
 * both read while it runs. A new one keeps the unchanged nodes of either
 * (`wireToOutlineMap`), so a node's object lasts across snapshots whichever
 * of the two a reader last held, and whatever order readers ask in.
 */
let built: readonly [Built?, Built?] = [];

/**
 * The schema of a graph snapshot: every node. Asking for one of the last two
 * snapshots built changes nothing; any other is built, from the newest.
 */
export function schemaOf(snapshot: SchemaSource): SchemaIndex {
  const [newest, before] = built;
  if (newest?.wire === snapshot.wireNodes) return newest.schema;
  if (before?.wire === snapshot.wireNodes) return before.schema;
  const wire = [...snapshot.wireNodes];
  const previous = [newest?.schema, before?.schema].filter((s) => s !== undefined);
  const schema = schemaOfGraph(wireToOutlineMap(wire, new Set(), wire, previous));
  built = [{ wire: snapshot.wireNodes, schema }, newest];
  return schema;
}

/**
 * A node map that is the whole graph, as its schema. The brand is asserted
 * here and nowhere else; {@link schemaOf} builds its map through it. A scope's
 * projection is refused: it is part of the graph, and a schema is all of it.
 */
export function schemaOfGraph(graph: ReadonlyMap<string, OutlineNode>): SchemaIndex {
  if (isPartialProjection(graph)) {
    throw new Error("schemaOfGraph: a scoped projection is part of the graph, not its schema");
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one place a map becomes a SchemaIndex; the caller hands the whole graph
  return graph as unknown as SchemaIndex;
}

/**
 * Everything a field value's editor resolves against, as one value: the
 * schema, the outline as shown, and the index a declared target query runs
 * on. Editors take this and derive the rest themselves — which option set a
 * field declares, and where its picker searches (`refSearchOf`) — so no
 * surface computes, or forgets to pass, a part of it.
 */
export interface FieldContext {
  readonly schema: SchemaIndex;
  readonly outline: ReadonlyMap<string, OutlineNode>;
  readonly index: KbIndex | null;
}

/** Rows and the schema they resolve against: what a reader of rows by id takes. */
export interface RowSource {
  readonly schema: SchemaIndex;
  readonly nodes: NodeMap;
}

/** What a field context is built from: the rows, their schema and the index. */
export interface FieldContextSource extends RowSource {
  readonly index: KbIndex | null;
}

const contexts = new WeakMap<NodeMap, FieldContext>();

/**
 * The field context of a source — the one constructor. One object per
 * projection map, schema and index, so a selector over it is referentially
 * stable.
 */
export function fieldContextOf(source: FieldContextSource): FieldContext {
  const cached = contexts.get(source.nodes);
  if (cached !== undefined && cached.index === source.index && cached.schema === source.schema) {
    return cached;
  }
  const context: FieldContext = {
    schema: source.schema,
    outline: source.nodes,
    index: source.index,
  };
  contexts.set(source.nodes, context);
  return context;
}
