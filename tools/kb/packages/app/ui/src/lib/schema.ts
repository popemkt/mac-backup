/**
 * Where a node's schema is read from: the whole graph, whatever the outline
 * shows.
 *
 * The outline map (`NodeMap`) is a projection — under an ontology scope it
 * holds only members, because scope decides which content the outline lists
 * and navigates to. What that content *means* is not scoped: a field's name,
 * declared type, cardinality, hidden flag and option set, a tag's name and
 * templated fields, and the label of a ref value are resolved against every
 * node.
 *
 * So schema is a type of its own. {@link SchemaIndex} is a read-only view of the
 * whole graph that only {@link schemaOf} produces; every function that reads a
 * definition takes a `SchemaIndex`, never a `NodeMap`. Handing the projection to a
 * schema reader is then a compile error rather than a bug that only shows
 * under a scope — which is how the same bug was found four times over before
 * the type existed.
 *
 * Unscoped, the projection *is* the whole graph and is returned as the schema;
 * scoped, the full map is built once per snapshot (`wireNodes` identity, which
 * every store transition renews), so a selector over it is referentially
 * stable.
 */
import type { WireNode } from "@kb/contracts";
import type { KbIndex } from "@/ds";
import { wireToOutlineMap } from "@/lib/graph-view";
import type { NodeMap, OutlineNode } from "@/lib/types";

declare const schemaBrand: unique symbol;

/** The whole graph, read-only, as every field and tag definition is resolved. */
export type SchemaIndex = ReadonlyMap<string, OutlineNode> & { readonly [schemaBrand]: true };

/** What a schema is built from: the store's projection and the snapshot it projects. */
export interface SchemaSource {
  readonly ontologyId: string | null;
  readonly nodes: NodeMap;
  readonly wireNodes: readonly WireNode[];
}

const fullGraph = new WeakMap<readonly WireNode[], SchemaIndex>();

/**
 * The schema of a state. The one constructor: the brand is asserted here and
 * nowhere else, because this is the one place that knows the map it returns
 * is the whole graph.
 */
export function schemaOf(state: SchemaSource): SchemaIndex {
  const cached = fullGraph.get(state.wireNodes);
  if (cached !== undefined) return cached;
  // Unscoped, the projection is the whole graph, so the first projection of
  // a snapshot is its schema. It stays the schema when a collapse or expand
  // replaces the projection map, because nothing a schema reader asks —
  // props, text, children, tags — changes with expansion; so a schema is one
  // object per snapshot and memos keyed on it survive UI state changes.
  const built = state.ontologyId === null ? projectionAsSchema(state.nodes) : wholeGraph(state);
  fullGraph.set(state.wireNodes, built);
  return built;
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

/** What a field context is built from: the schema's sources and the index. */
export interface FieldContextSource extends SchemaSource {
  readonly index: KbIndex | null;
}

const contexts = new WeakMap<NodeMap, FieldContext>();

/**
 * The field context of a state — the one constructor. One object per
 * projection map, so a selector over it is referentially stable.
 */
export function fieldContextOf(state: FieldContextSource): FieldContext {
  const cached = contexts.get(state.nodes);
  if (cached !== undefined && cached.index === state.index) return cached;
  const context: FieldContext = {
    schema: schemaOf(state),
    outline: state.nodes,
    index: state.index,
  };
  contexts.set(state.nodes, context);
  return context;
}

function projectionAsSchema(nodes: NodeMap): SchemaIndex {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one place a map becomes a SchemaIndex; unscoped, the projection is the whole graph
  return nodes as unknown as SchemaIndex;
}

function wholeGraph(state: SchemaSource): SchemaIndex {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one place a map becomes a SchemaIndex; built from the full snapshot
  return wireToOutlineMap([...state.wireNodes], new Set()) as unknown as SchemaIndex;
}
