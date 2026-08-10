import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { z } from "zod";
import { ulid } from "ulid";
import type { ActionDefinition } from "../shared/contracts.ts";
import {
  SYSTEM_IDS,
  isSysPrefixed,
  type KbNode,
  type NodeId,
  type PropValue,
  nowIso,
} from "../foundation/model.ts";
import {
  ResolveError,
  resolveFieldId,
  resolveTagId,
} from "../foundation/resolve.ts";
import {
  domainError,
  domainFromResolve,
  type DomainError,
} from "../foundation/errors.ts";
import type { KbContext } from "../context.ts";
import { KbCtx, KbStore, persistEffect, runWithKb } from "../context.ts";
import { pull, query } from "../foundation/query/index.ts";

type KbWriteEnv = KbCtx | KbStore | FileSystem;

/** Lift sync resolve/throw helpers into DomainError. */
function syncDomain<A>(f: () => A): Effect.Effect<A, DomainError> {
  return Effect.try({
    try: f,
    catch: (err) => {
      if (err instanceof ResolveError) return domainFromResolve(err);
      return domainError(
        "internal",
        err instanceof Error ? err.message : String(err),
      );
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
    unsetProps: z
      .array(z.object({ field: z.string(), value: z.unknown().optional() }))
      .optional(),
    parent: z.string().nullable().optional(),
    position: z.number().int().nonnegative().optional(),
    delete: z.boolean().optional(),
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
    list.push(e.value as PropValue);
    props[fieldId] = list;
  }
}

function isInSubtree(
  nodes: KbNode[],
  rootId: NodeId,
  targetId: NodeId,
): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const stack = [rootId];
  const seen = new Set<NodeId>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (n) stack.push(...n.children);
  }
  return false;
}

function detachFromParents(nodes: KbNode[], childId: NodeId): KbNode[] {
  const touched: KbNode[] = [];
  for (const n of nodes) {
    if (!n.children.includes(childId)) continue;
    const c = cloneNode(n);
    c.children = c.children.filter((id) => id !== childId);
    c.updatedAt = nowIso();
    touched.push(c);
  }
  return touched;
}

function insertChild(
  parent: KbNode,
  childId: NodeId,
  position?: number,
): KbNode {
  const c = cloneNode(parent);
  const pos =
    position === undefined || position > c.children.length
      ? c.children.length
      : position;
  c.children = [
    ...c.children.slice(0, pos),
    childId,
    ...c.children.slice(pos),
  ];
  c.updatedAt = nowIso();
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
export function pullSubtree(
  ctx: KbContext,
  id: NodeId,
  depth: number,
): unknown {
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

export const nodeAddEffect = Effect.fn("node.add")(
  function* (
    input: z.infer<typeof nodeAddDef.inputSchema>,
  ): Effect.fn.Return<{ id: string; node: KbNode }, DomainError, KbWriteEnv> {
    const ctx = yield* KbCtx;
    const at = nowIso();
    const id = input.id ?? ulid();
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
      createdAt: at,
      updatedAt: at,
    };

    const upserts: KbNode[] = [node];
    if (input.parent) {
      const parent = yield* syncDomain(() =>
        cloneNode(requireNode(ctx, input.parent!)),
      );
      upserts.push(insertChild(parent, id, input.position));
    }

    yield* syncDomain(() =>
      assertNoSysUpsert(upserts, input.force === true, "node.add"),
    );

    yield* persistEffect(ctx, { upserts, deletes: [] });
    return { id, node };
  },
);

export async function nodeAdd(
  ctx: KbContext,
  input: z.infer<typeof nodeAddDef.inputSchema>,
): Promise<{ id: string; node: KbNode }> {
  return runWithKb(ctx, nodeAddEffect(input));
}

function assertSysWriteAllowed(
  id: string,
  input: z.infer<typeof nodeUpdateDef.inputSchema>,
): void {
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
function assertNoSysUpsert(
  upserts: readonly KbNode[],
  force: boolean,
  action: string,
): void {
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

export const nodeUpdateEffect = Effect.fn("node.update")(
  function* (
    input: z.infer<typeof nodeUpdateDef.inputSchema>,
  ): Effect.fn.Return<
    { id: string; deleted?: boolean; node?: KbNode },
    DomainError,
    KbWriteEnv
  > {
    const ctx = yield* KbCtx;
    yield* syncDomain(() => assertSysWriteAllowed(input.id, input));

    if (input.delete) {
      const upserts = detachFromParents(ctx.nodes, input.id);
      yield* syncDomain(() =>
        assertNoSysUpsert(upserts, input.force === true, "node.update"),
      );
      yield* persistEffect(ctx, { upserts, deletes: [input.id] });
      return { id: input.id, deleted: true };
    }

    const node = yield* syncDomain(() => cloneNode(requireNode(ctx, input.id)));
    const upserts: KbNode[] = [];

    yield* syncDomain(() => {
      if (input.text !== undefined) node.text = input.text;
      if (input.setProps) applyProps(ctx, node.props, input.setProps);
      if (input.unsetProps) {
        for (const u of input.unsetProps) {
          const fieldId = resolveFieldId(ctx.nodes, u.field);
          if (u.value === undefined) {
            delete node.props[fieldId];
          } else {
            const list = node.props[fieldId] ?? [];
            node.props[fieldId] = list.filter(
              (pv) => JSON.stringify(pv) !== JSON.stringify(u.value),
            );
            if (node.props[fieldId]!.length === 0) delete node.props[fieldId];
          }
        }
      }
    });

    if (input.parent !== undefined) {
      if (
        input.parent !== null &&
        isInSubtree(ctx.nodes, input.id, input.parent)
      ) {
        return yield* domainError(
          "invalid_move",
          `cannot move ${input.id} under itself or its own descendant ${input.parent}`,
          { id: input.id, parent: input.parent },
        );
      }
      upserts.push(...detachFromParents(ctx.nodes, input.id));
      if (input.parent !== null) {
        const parent = yield* syncDomain(
          () =>
            upserts.find((n) => n.id === input.parent) ??
            cloneNode(requireNode(ctx, input.parent!)),
        );
        const updated = insertChild(parent, input.id, input.position);
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
        c.children = [
          ...c.children.slice(0, pos),
          input.id,
          ...c.children.slice(pos),
        ];
        c.updatedAt = nowIso();
        upserts.push(c);
      }
    }

    node.updatedAt = nowIso();
    upserts.push(node);
    yield* syncDomain(() =>
      assertNoSysUpsert(upserts, input.force === true, "node.update"),
    );
    yield* persistEffect(ctx, { upserts, deletes: [] });
    return { id: input.id, node };
  },
);

export async function nodeUpdate(
  ctx: KbContext,
  input: z.infer<typeof nodeUpdateDef.inputSchema>,
): Promise<{ id: string; deleted?: boolean; node?: KbNode }> {
  return runWithKb(ctx, nodeUpdateEffect(input));
}

export const nodeGetEffect = Effect.fn("node.get")(
  function* (
    input: z.infer<typeof nodeGetDef.inputSchema>,
  ): Effect.fn.Return<{ node: unknown }, DomainError, KbCtx> {
    const ctx = yield* KbCtx;
    yield* syncDomain(() => requireNode(ctx, input.id));
    const node = pullSubtree(ctx, input.id, input.depth);
    if (input.depth <= 1) {
      void pull(ctx.qdb, subtreePattern(input.depth), input.id);
    }
    return { node };
  },
);

export async function nodeGet(
  ctx: KbContext,
  input: z.infer<typeof nodeGetDef.inputSchema>,
): Promise<{ node: unknown }> {
  return runWithKb(ctx, nodeGetEffect(input));
}

export const fieldDefineEffect = Effect.fn("field.define")(
  function* (
    input: z.infer<typeof fieldDefineDef.inputSchema>,
  ): Effect.fn.Return<{ id: string }, DomainError, KbWriteEnv> {
    const ctx = yield* KbCtx;
    const existing = ctx.nodes.filter(
      (n) =>
        n.text === input.name &&
        (n.props[SYSTEM_IDS.typeField] ?? []).some(
          (v) => v.t === "ref" && v.v === SYSTEM_IDS.field,
        ),
    );
    if (existing.length > 0 && !input.id) {
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
  },
);

export async function fieldDefine(
  ctx: KbContext,
  input: z.infer<typeof fieldDefineDef.inputSchema>,
): Promise<{ id: string }> {
  return runWithKb(ctx, fieldDefineEffect(input));
}

export const tagDefineEffect = Effect.fn("tag.define")(
  function* (
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
  },
);

export async function tagDefine(
  ctx: KbContext,
  input: z.infer<typeof tagDefineDef.inputSchema>,
): Promise<{ id: string }> {
  return runWithKb(ctx, tagDefineEffect(input));
}

export const graphQueryEffect = Effect.fn("graph.query")(
  function* (
    input: z.infer<typeof graphQueryDef.inputSchema>,
  ): Effect.fn.Return<{ rows: unknown }, DomainError, KbCtx> {
    const ctx = yield* KbCtx;
    const rows = yield* Effect.try({
      try: () => query(ctx.qdb, input.query, ...(input.inputs ?? [])),
      catch: (err) =>
        domainError(
          "invalid_input",
          `invalid datalog query: ${err instanceof Error ? err.message : String(err)}`,
          { query: input.query },
        ),
    });
    return { rows };
  },
);

export async function graphQuery(
  ctx: KbContext,
  input: z.infer<typeof graphQueryDef.inputSchema>,
): Promise<{ rows: unknown }> {
  return runWithKb(ctx, graphQueryEffect(input));
}
