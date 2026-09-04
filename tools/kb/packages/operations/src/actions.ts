import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { z } from "zod";
import { type ActionDefinition, type KbContext, KbCtx, type KbStore } from "@kb/contracts";
import {
  ResolveError,
  SYSTEM_IDS,
  currentIso,
  domainError,
  domainFromResolve,
  freshId,
  isSysPrefixed,
  resolveFieldId,
  resolveTagId,
  type DomainError,
  type KbNode,
  type NodeId,
  type PropValue,
} from "@kb/model";
import { persistEffect } from "./session.ts";
import { DatalogError, pull, query } from "@kb/query";
import { resolveSavedQueryFile } from "./saved-query.ts";

type KbWriteEnv = KbCtx | KbStore | FileSystem;

/** Lift sync resolve/throw helpers into DomainError. */
function syncDomain<A>(f: () => A): Effect.Effect<A, DomainError> {
  return Effect.try({
    try: f,
    catch: (err) => {
      if (err instanceof ResolveError) return domainFromResolve(err);
      return domainError("internal", err instanceof Error ? err.message : String(err));
    },
  });
}

const PropInputSchema = z.object({
  field: z.string(),
  value: z.union([
    z.object({ t: z.literal("str"), v: z.string() }),
    z.object({ t: z.literal("num"), v: z.number() }),
    z.object({ t: z.literal("bool"), v: z.boolean() }),
    z.object({ t: z.literal("date"), v: z.string() }),
    z.object({ t: z.literal("ref"), v: z.string() }),
  ]),
});

export const nodeAddDef = {
  id: "node.add",
  title: "Add node",
  description: "Create a node with optional props, parent, position, and tags",
  mode: "apply" as const,
  inputSchema: z.object({
    text: z.string(),
    props: z.array(PropInputSchema).optional(),
    parent: z.string().optional(),
    position: z.number().int().nonnegative().optional(),
    order: z.string().optional(),
    tags: z.array(z.string()).optional(),
    id: z.string().optional(),
    /** Bypass sys.* write-guard (browse yes / break no). */
    force: z.boolean().optional(),
  }),
  outputSchema: z.object({
    id: z.string(),
    node: z.record(z.string(), z.unknown()),
  }),
} satisfies ActionDefinition;

export const nodeUpdateDef = {
  id: "node.update",
  title: "Update node",
  description: "Edit text, set/unset props, move, or delete a node",
  mode: "apply" as const,
  inputSchema: z.object({
    id: z.string(),
    text: z.string().optional(),
    setProps: z.array(PropInputSchema).optional(),
    unsetProps: z.array(z.object({ field: z.string(), value: z.unknown().optional() })).optional(),
    parent: z.string().nullable().optional(),
    position: z.number().int().nonnegative().optional(),
    order: z.string().optional(),
    delete: z.boolean().optional(),
    /** Parent deletion is never implicitly shallow; cascade is the default. */
    descendants: z.enum(["cascade", "reparent"]).optional(),
    /** Bypass sys.* write-guard (browse yes / break no). */
    force: z.boolean().optional(),
  }),
  outputSchema: z.object({
    id: z.string(),
    deleted: z.boolean().optional(),
    node: z.record(z.string(), z.unknown()).optional(),
  }),
} satisfies ActionDefinition;

export const nodeGetDef = {
  id: "node.get",
  title: "Get node",
  description: "Pull a node subtree to depth N",
  mode: "read" as const,
  inputSchema: z.object({
    id: z.string(),
    depth: z.number().int().nonnegative().default(1),
  }),
  outputSchema: z.object({
    node: z.unknown(),
  }),
} satisfies ActionDefinition;

export const fieldDefineDef = {
  id: "field.define",
  title: "Define field",
  description: "Mint a field node (typed sys.field)",
  mode: "apply" as const,
  inputSchema: z.object({
    name: z.string(),
    id: z.string().optional(),
  }),
  outputSchema: z.object({ id: z.string() }),
} satisfies ActionDefinition;

export const tagDefineDef = {
  id: "tag.define",
  title: "Define tag",
  description: "Mint a tag node (typed sys.tag) with optional templated fields",
  mode: "apply" as const,
  inputSchema: z.object({
    name: z.string(),
    id: z.string().optional(),
    fields: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({ id: z.string() }),
} satisfies ActionDefinition;

export const graphQueryDef = {
  id: "graph.query",
  title: "Query graph",
  description: "Run a raw EDN datalog query → JSON rows",
  mode: "read" as const,
  inputSchema: z.object({
    query: z.string(),
    inputs: z.array(z.unknown()).optional(),
  }),
  outputSchema: z.object({
    rows: z.unknown(),
  }),
} satisfies ActionDefinition;

export const graphRunDef = {
  id: "graph.run",
  title: "Run saved query",
  description: "Execute a saved query from .kb/queries/<name>.edn",
  mode: "read" as const,
  inputSchema: z.object({
    name: z.string(),
    inputs: z.array(z.unknown()).optional(),
  }),
  outputSchema: z.object({
    name: z.string(),
    query: z.string(),
    rows: z.unknown(),
  }),
} satisfies ActionDefinition;

export const graphSearchDef = {
  id: "graph.search",
  title: "Search nodes",
  description: "Case-insensitive substring search over node text (id + text rows)",
  mode: "read" as const,
  inputSchema: z.object({
    text: z.string(),
    limit: z.number().int().nonnegative().optional(),
  }),
  outputSchema: z.object({
    rows: z.unknown(),
  }),
} satisfies ActionDefinition;

function nodeById(ctx: KbContext, id: NodeId): KbNode | undefined {
  return ctx.nodes.find((n) => n.id === id);
}

function requireNode(ctx: KbContext, id: NodeId): KbNode {
  const n = nodeById(ctx, id);
  if (!n) throw new ResolveError("not_found", `node not found: ${id}`, { id });
  return n;
}

function cloneNode(n: KbNode): KbNode {
  return {
    ...n,
    props: Object.fromEntries(
      Object.entries(n.props).map(([k, v]) => [k, v.map((x) => ({ ...x }))]),
    ),
    children: [...n.children],
  };
}

function applyProps(
  ctx: KbContext,
  props: Record<NodeId, PropValue[]>,
  entries: z.infer<typeof PropInputSchema>[],
): void {
  for (const e of entries) {
    const fieldId = resolveFieldId(ctx.nodes, e.field);
    const list = props[fieldId] ?? [];
    list.push(e.value);
    props[fieldId] = list;
  }
}

function isInSubtree(nodes: KbNode[], rootId: NodeId, targetId: NodeId): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const stack = [rootId];
  const seen = new Set<NodeId>();
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) break;
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (n) stack.push(...n.children);
  }
  return false;
}

function detachFromParents(nodes: KbNode[], childId: NodeId, at: string): KbNode[] {
  const touched: KbNode[] = [];
  for (const n of nodes) {
    if (!n.children.includes(childId)) continue;
    const c = cloneNode(n);
    c.children = c.children.filter((id) => id !== childId);
    c.updatedAt = at;
    touched.push(c);
  }
  return touched;
}

function collectSubtreeIds(nodes: KbNode[], rootId: NodeId): NodeId[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result: NodeId[] = [];
  const seen = new Set<NodeId>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) break;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    stack.push(...(byId.get(id)?.children ?? []));
  }
  return result;
}

function insertChild(parent: KbNode, childId: NodeId, at: string, position?: number): KbNode {
  const c = cloneNode(parent);
  const pos = position === undefined || position > c.children.length ? c.children.length : position;
  c.children = [...c.children.slice(0, pos), childId, ...c.children.slice(pos)];
  c.updatedAt = at;
  return c;
}

function subtreePattern(depth: number): string {
  if (depth <= 0) return `[:node/id :node/text]`;
  if (depth === 1) {
    return `[:node/id :node/text :node/children {:node/child [:node/id :node/text]}]`;
  }
  // recursive-ish: nest child pulls
  let inner = `[:node/id :node/text]`;
  for (let i = 0; i < depth; i++) {
    inner = `[:node/id :node/text :node/children {:node/child ${inner}}]`;
  }
  return inner;
}

/** Prefer structured pull from our nodes map for reliable ordered depth. */
function pullSubtree(ctx: KbContext, id: NodeId, depth: number): unknown {
  const node = nodeById(ctx, id);
  if (!node) return null;

  const walk = (n: KbNode, d: number): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      id: n.id,
      text: n.text,
      props: n.props,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    };
    if (d <= 0) return base;
    base.children = n.children.map((cid) => {
      const child = nodeById(ctx, cid);
      if (!child) return { id: cid, missing: true };
      return walk(child, d - 1);
    });
    return base;
  };
  return walk(node, depth);
}

export const nodeAddEffect = Effect.fn("node.add")(function* (
  input: z.infer<typeof nodeAddDef.inputSchema>,
): Effect.fn.Return<{ id: string; node: KbNode }, DomainError, KbWriteEnv> {
  const ctx = yield* KbCtx;
  const at = yield* currentIso;
  const id = input.id ?? (yield* freshId);
  if (nodeById(ctx, id)) {
    return yield* domainError("ambiguous", `node id already exists: ${id}`, {
      id,
    });
  }

  const props: Record<NodeId, PropValue[]> = {};
  yield* syncDomain(() => {
    if (input.props) applyProps(ctx, props, input.props);
    if (input.tags) {
      for (const tagName of input.tags) {
        const tagId = resolveTagId(ctx.nodes, tagName);
        const list = props[SYSTEM_IDS.typeField] ?? [];
        list.push({ t: "ref", v: tagId });
        props[SYSTEM_IDS.typeField] = list;
      }
    }
  });

  const node: KbNode = {
    id,
    text: input.text,
    props,
    children: [],
    ...(input.order !== undefined && input.order !== "" ? { order: input.order } : {}),
    createdAt: at,
    updatedAt: at,
  };

  const parentId = input.parent;
  const upserts: KbNode[] = [node];
  if (parentId !== undefined && parentId !== "") {
    const parent = yield* syncDomain(() => cloneNode(requireNode(ctx, parentId)));
    upserts.push(insertChild(parent, id, at, input.position));
  }

  yield* syncDomain(() => assertNoSysUpsert(upserts, input.force === true, "node.add"));

  yield* persistEffect(ctx, { upserts, deletes: [] });
  return { id, node };
});

function assertSysWriteAllowed(id: string, input: z.infer<typeof nodeUpdateDef.inputSchema>): void {
  if (!isSysPrefixed(id) || input.force === true) return;
  const mutating =
    input.text !== undefined ||
    (input.setProps !== undefined && input.setProps.length > 0) ||
    (input.unsetProps !== undefined && input.unsetProps.length > 0) ||
    input.delete === true ||
    input.parent !== undefined ||
    input.position !== undefined;
  if (!mutating) return;
  throw new ResolveError(
    "forbidden",
    `sys.* nodes are write-protected (use force to override): ${id}`,
    { id },
  );
}

/**
 * Refuse any commit that upserts a sys.* node unless `force` is set. This is
 * the load-bearing guard behind the sys.* write-protection contract: it
 * covers mint-id (node.add `id`), reparenting under a sys.* parent
 * (`insertChild` mutates the parent), and every alias that funnels into
 * node.add / node.update. Checked against the final computed upserts, so no
 * structural path can slip through without tripping it.
 */
function assertNoSysUpsert(upserts: readonly KbNode[], force: boolean, action: string): void {
  if (force) return;
  for (const n of upserts) {
    if (!isSysPrefixed(n.id)) continue;
    throw new ResolveError(
      "forbidden",
      `sys.* nodes are write-protected (use force to override): ${n.id}`,
      { id: n.id, action },
    );
  }
}

export const nodeUpdateEffect = Effect.fn("node.update")(function* (
  input: z.infer<typeof nodeUpdateDef.inputSchema>,
): Effect.fn.Return<{ id: string; deleted?: boolean; node?: KbNode }, DomainError, KbWriteEnv> {
  const ctx = yield* KbCtx;
  const at = yield* currentIso;
  yield* syncDomain(() => assertSysWriteAllowed(input.id, input));

  if (input.delete === true) {
    const deleteIds =
      input.descendants === "reparent" ? [input.id] : collectSubtreeIds(ctx.nodes, input.id);
    const upserts = detachFromParents(ctx.nodes, input.id, at);
    yield* syncDomain(() => assertNoSysUpsert(upserts, input.force === true, "node.update"));
    yield* persistEffect(ctx, { upserts, deletes: deleteIds });
    return { id: input.id, deleted: true };
  }

  const node = yield* syncDomain(() => cloneNode(requireNode(ctx, input.id)));
  const upserts: KbNode[] = [];

  yield* syncDomain(() => {
    if (input.text !== undefined) node.text = input.text;
    if (input.order !== undefined) node.order = input.order;
    if (input.setProps) applyProps(ctx, node.props, input.setProps);
    if (input.unsetProps) {
      for (const u of input.unsetProps) {
        const fieldId = resolveFieldId(ctx.nodes, u.field);
        if (u.value === undefined) {
          delete node.props[fieldId];
        } else {
          const list = node.props[fieldId] ?? [];
          node.props[fieldId] = list.filter((pv) => JSON.stringify(pv) !== JSON.stringify(u.value));
          if (node.props[fieldId].length === 0) delete node.props[fieldId];
        }
      }
    }
  });

  const newParentId = input.parent;
  if (newParentId !== undefined) {
    if (newParentId !== null && isInSubtree(ctx.nodes, input.id, newParentId)) {
      return yield* domainError(
        "invalid_move",
        `cannot move ${input.id} under itself or its own descendant ${newParentId}`,
        { id: input.id, parent: newParentId },
      );
    }
    upserts.push(...detachFromParents(ctx.nodes, input.id, at));
    if (newParentId !== null) {
      const parent = yield* syncDomain(
        () => upserts.find((n) => n.id === newParentId) ?? cloneNode(requireNode(ctx, newParentId)),
      );
      const updated = insertChild(parent, input.id, at, input.position);
      const idx = upserts.findIndex((n) => n.id === parent.id);
      if (idx >= 0) upserts[idx] = updated;
      else upserts.push(updated);
    }
  } else if (input.position !== undefined) {
    const parent = ctx.nodes.find((n) => n.children.includes(input.id));
    if (parent) {
      const c = cloneNode(parent);
      c.children = c.children.filter((id) => id !== input.id);
      const pos = Math.min(input.position, c.children.length);
      c.children = [...c.children.slice(0, pos), input.id, ...c.children.slice(pos)];
      // DELIBERATE BUG (t2-dst red demo): stamp a fixed fractional rank on
      // the reordered parent so its sibling group ends up with two children
      // sharing one `order` key. `migrateOrderKeys` never rewrites an
      // existing rank, so the collision survives reopen — and the store's
      // own tx-validation never inspects `order`, so only the DST harness's
      // "strictly increasing order" invariant catches it.
      c.order = "1000000000";
      c.updatedAt = at;
      upserts.push(c);
    }
  }

  node.updatedAt = at;
  upserts.push(node);
  yield* syncDomain(() => assertNoSysUpsert(upserts, input.force === true, "node.update"));
  yield* persistEffect(ctx, { upserts, deletes: [] });
  return { id: input.id, node };
});

export const nodeGetEffect = Effect.fn("node.get")(function* (
  input: z.infer<typeof nodeGetDef.inputSchema>,
): Effect.fn.Return<{ node: unknown }, DomainError, KbCtx> {
  const ctx = yield* KbCtx;
  yield* syncDomain(() => requireNode(ctx, input.id));
  const node = pullSubtree(ctx, input.id, input.depth);
  if (input.depth <= 1) {
    void pull(ctx.qdb, subtreePattern(input.depth), input.id);
  }
  return { node };
});

export const fieldDefineEffect = Effect.fn("field.define")(function* (
  input: z.infer<typeof fieldDefineDef.inputSchema>,
): Effect.fn.Return<{ id: string }, DomainError, KbWriteEnv> {
  const ctx = yield* KbCtx;
  const existing = ctx.nodes.filter(
    (n) =>
      n.text === input.name &&
      (n.props[SYSTEM_IDS.typeField] ?? []).some((v) => v.t === "ref" && v.v === SYSTEM_IDS.field),
  );
  if (existing.length > 0 && (input.id === undefined || input.id === "")) {
    return yield* domainError("ambiguous", `field already exists: ${input.name}`, {
      ids: existing.map((e) => e.id),
    });
  }
  const result = yield* nodeAddEffect({
    id: input.id,
    text: input.name,
    props: [
      {
        field: SYSTEM_IDS.typeField,
        value: { t: "ref", v: SYSTEM_IDS.field },
      },
    ],
  });
  return { id: result.id };
});

export const tagDefineEffect = Effect.fn("tag.define")(function* (
  input: z.infer<typeof tagDefineDef.inputSchema>,
): Effect.fn.Return<{ id: string }, DomainError, KbWriteEnv> {
  const ctx = yield* KbCtx;
  const props: z.infer<typeof PropInputSchema>[] = [
    {
      field: SYSTEM_IDS.typeField,
      value: { t: "ref", v: SYSTEM_IDS.tag },
    },
  ];
  yield* syncDomain(() => {
    if (input.fields) {
      for (const f of input.fields) {
        const fieldId = resolveFieldId(ctx.nodes, f);
        props.push({
          field: SYSTEM_IDS.fieldsField,
          value: { t: "ref", v: fieldId },
        });
      }
    }
  });
  const result = yield* nodeAddEffect({
    id: input.id,
    text: input.name,
    props,
  });
  return { id: result.id };
});

/**
 * Map a query-layer failure to a typed domain error. Datalog errors thrown by
 * the datascript engine (parse/eval of the user's EDN) are `invalid_input`;
 * anything else — a genuine defect in our glue (normalization, revive) — stays
 * `internal` so internal bugs are never hidden behind an "invalid query" code.
 */
export function classifyQueryError(err: unknown, queryString: string): DomainError {
  if (err instanceof DatalogError) {
    return domainError("invalid_input", `invalid datalog query: ${err.message}`, {
      query: queryString,
    });
  }
  return domainError(
    "internal",
    `graph query failed: ${err instanceof Error ? err.message : String(err)}`,
    { query: queryString },
  );
}

/** Shared datalog execution for graph.query / graph.run. */
function runDatalog(
  ctx: KbContext,
  edn: string,
  inputs?: unknown[],
): Effect.Effect<unknown, DomainError> {
  return Effect.try({
    try: () => query(ctx.qdb, edn, ...(inputs ?? [])),
    catch: (err) => classifyQueryError(err, edn),
  });
}

export const graphQueryEffect = Effect.fn("graph.query")(function* (
  input: z.infer<typeof graphQueryDef.inputSchema>,
): Effect.fn.Return<{ rows: unknown }, DomainError, KbCtx> {
  const ctx = yield* KbCtx;
  const rows = yield* runDatalog(ctx, input.query, input.inputs);
  return { rows };
});

/** True for FileSystem "not found" platform errors (ENOENT on read). */
function isFsNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  return (err as { reason?: { _tag?: string } }).reason?._tag === "NotFound";
}

export const graphRunEffect = Effect.fn("graph.run")(function* (
  input: z.infer<typeof graphRunDef.inputSchema>,
): Effect.fn.Return<z.infer<typeof graphRunDef.outputSchema>, DomainError, KbCtx | FileSystem> {
  const ctx = yield* KbCtx;
  const fs = yield* FileSystem;
  const path = resolveSavedQueryFile(ctx.root, input.name);
  if (path === null) {
    return yield* domainError(
      "invalid_input",
      `invalid saved query name: ${input.name} (letters, digits, ., _, - only)`,
      { name: input.name },
    );
  }
  const edn = yield* fs.readFileString(path).pipe(
    Effect.mapError((err) => {
      if (isFsNotFound(err)) {
        return domainError("not_found", `saved query not found: ${input.name}`, {
          name: input.name,
          path,
        });
      }
      return domainError(
        "internal",
        `read saved query failed: ${err instanceof Error ? err.message : String(err)}`,
        { name: input.name, path },
      );
    }),
  );
  const rows = yield* runDatalog(ctx, edn, input.inputs);
  return { name: input.name, query: edn.trim(), rows };
});

export const graphSearchEffect = Effect.fn("graph.search")(function* (
  input: z.infer<typeof graphSearchDef.inputSchema>,
): Effect.fn.Return<{ rows: unknown[][] }, DomainError, KbCtx> {
  const ctx = yield* KbCtx;
  const needle = input.text.toLowerCase();
  const rows = ctx.nodes
    .filter((n) => n.text.toLowerCase().includes(needle))
    .map((n) => [n.id, n.text])
    .toSorted((a, b) => String(a[0]).localeCompare(String(b[0])));
  if (input.limit !== undefined && rows.length > input.limit) {
    rows.length = input.limit;
  }
  return { rows };
});
