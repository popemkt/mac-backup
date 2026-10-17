import { Effect, Predicate } from "effect";
import { z } from "zod";
import { type ActionDefinition, KbCtx, type KbStore } from "@kb/contracts";
import {
  ResolveError,
  cardinalityOf,
  currentIso,
  domainError,
  fieldTypeOf,
  freshId,
  mentionSpans,
  parseOutline,
  parseTypedValue,
  present,
  replaceMentions,
  resolveFieldIn,
  type DomainError,
  type FieldType,
  type KbNode,
  type NodeId,
  type NodeGraph,
  type OutlineItem,
  type ParsedValue,
} from "@kb/model";
import {
  forcedBy,
  nodeAddDef,
  planNodeAdd,
  sessionGraph,
  syncDomain,
  type PropEntry,
} from "./actions.ts";
import { persistEffect } from "./session.ts";

export const nodeAddTreeDef = {
  id: "node.addTree",
  title: "Add outline",
  description:
    "Create a whole outline in one transaction from outline paste (Tana Paste) text: " +
    "nested `- ` items (indent nests), `#tag` / `#[[multi word tag]]`, `field:: value` " +
    "(or `field::` with nested `- value` items for several values), and `[[ref]]` / " +
    "`[[id|label]]` naming a node id or another item of the same outline by its text. " +
    "Top-level items go under parent at position (the forest roots and the end when " +
    "omitted). All or nothing; returns the created ids in tree order and each item's line.",
  mode: { kind: "write" } as const,
  // Every call is a batch of node.adds: approval decides it as node.add too,
  // by node.add's own mode.
  batchOf: [nodeAddDef.id],
  inputSchema: z.object({
    outline: z.string(),
    parent: z.string().optional(),
    position: z.number().int().nonnegative().optional(),
    /** Bypass sys.* write-guard (browse yes / break no), as node.add's. */
    force: z.boolean().optional(),
  }),
  outputSchema: z.object({
    /** Every created node, in tree order (an item, then its children). */
    ids: z.array(z.string()),
    /** Each item's 1-based source line → the id it was created with. */
    lines: z.record(z.string(), z.string()),
  }),
} satisfies ActionDefinition;

type NodeAddTreeInput = z.infer<typeof nodeAddTreeDef.inputSchema>;

/** One item in tree order: its parent's index in that order (null: top level) and its position. */
interface FlatItem {
  item: OutlineItem;
  parentIndex: number | null;
  position: number | undefined;
}

/** One item in tree order with the id it is created with, and the node it goes under. */
interface PlannedItem {
  item: OutlineItem;
  id: NodeId;
  parent: NodeId | undefined;
  position: number | undefined;
}

/**
 * The items in tree order (an item, then its children). Top-level items take
 * consecutive positions from the caller's position, so the outline lands as
 * one block wherever a single `node.add` would have put its first item.
 */
function flatten(items: readonly OutlineItem[], position: number | undefined): FlatItem[] {
  const out: FlatItem[] = [];
  const walk = (list: readonly OutlineItem[], parentIndex: number | null): void => {
    for (const [index, item] of list.entries()) {
      const self = out.length;
      const top = parentIndex === null && position !== undefined;
      out.push({ item, parentIndex, position: top ? position + index : undefined });
      walk(item.children, self);
    }
  };
  walk(items, null);
  return out;
}

/**
 * How an outline names a node in a ref: by an id the graph holds, else by the
 * text of one of the outline's own items (an earlier or a later one — the
 * outline lands at once). A name no item has, or that two items share, is
 * refused; nothing is ever guessed or created for it.
 */
function refResolver(graph: NodeGraph, planned: readonly PlannedItem[]) {
  const byText = new Map<string, NodeId[]>();
  for (const { item, id } of planned) byText.set(item.text, [...(byText.get(item.text) ?? []), id]);
  return (target: string): NodeId => {
    if (graph.has(target)) return target;
    const local = byText.get(target) ?? [];
    const [only] = local;
    if (local.length === 1 && only !== undefined) return only;
    if (local.length > 1) {
      throw new ResolveError(
        "ambiguous",
        `[[${target}]] names ${local.length} items of this outline; link one by its id instead`,
        { ref: target, ids: local },
      );
    }
    throw new ResolveError(
      "not_found",
      `unresolved reference [[${target}]]: no node has that id and no item of this outline has that text`,
      { ref: target },
    );
  };
}

type Resolve = ReturnType<typeof refResolver>;

/** `text` with every ref pointing at its id: an existing id's token is kept as written. */
function linkText(text: string, resolve: Resolve): string {
  return replaceMentions(text, (span) => {
    const id = resolve(span.id);
    return id === span.id ? text.slice(span.start, span.end) : `[[${id}|${span.label ?? span.id}]]`;
  });
}

/**
 * One field value read as its field's type. A ref field's value is one ref:
 * a whole `[[id]]` / `[[item text]]` token, or a bare id or item text,
 * resolved like any ref; text around a token is refused, since a ref holds
 * no prose. Every other type reads the text, its refs linked, through the
 * one `parseTypedValue`.
 */
function readValue(raw: string, type: FieldType, resolve: Resolve): ParsedValue {
  if (type !== "ref") return parseTypedValue(linkText(raw, resolve), type);
  const spans = mentionSpans(raw);
  const [only] = spans;
  if (only === undefined) return { ok: true, value: { t: "ref", v: resolve(raw) } };
  if (spans.length === 1 && only.start === 0 && only.end === raw.length) {
    return { ok: true, value: { t: "ref", v: resolve(only.id) } };
  }
  return {
    ok: false,
    reason: `a ref value is one [[id]] or [[item text]] token alone, or a bare id or item text: ${raw}`,
  };
}

/** Prefix a failure with the outline line it belongs to. */
const atLine =
  (line: number) =>
  (err: DomainError): DomainError =>
    domainError(err.code, `outline line ${line}: ${err.message}`, {
      line,
      ...(Predicate.isObject(err.details) ? err.details : {}),
    });

/**
 * The outline line a commit's refusal belongs to: the item it names, or the
 * first item when it names the parent the outline is pasted under (only the
 * top level is placed there). Null when it names neither.
 */
function refusedLine(
  err: DomainError,
  parent: NodeId | undefined,
  lines: Readonly<Record<string, NodeId>>,
): number | null {
  const refused = Predicate.isObject(err.details) ? err.details.id : undefined;
  if (typeof refused !== "string") return null;
  const numbers = Object.keys(lines).map(Number);
  const own = numbers.find((line) => lines[String(line)] === refused);
  if (own !== undefined) return own;
  return refused === parent && numbers.length > 0 ? Math.min(...numbers) : null;
}

/**
 * An item's fields as prop entries, each value read as its field's declared
 * type. A field that holds one value (`cardinalityOf`) and is given a second
 * by the same item is refused at the second value's line — the commit's
 * integrity check would refuse it too, but could not say where.
 */
const itemProps = Effect.fnUntraced(function* (
  item: OutlineItem,
  graph: NodeGraph,
  resolve: Resolve,
) {
  const entries: PropEntry[] = [];
  const held = new Set<NodeId>();
  for (const field of item.fields) {
    const fieldId = yield* syncDomain(() => resolveFieldIn(graph, field.name)).pipe(
      Effect.mapError(atLine(field.line)),
    );
    const props = graph.get(fieldId)?.props;
    const type = fieldTypeOf(props);
    const single = cardinalityOf(props) === "one";
    for (const { line, raw } of field.values) {
      if (single && held.has(fieldId)) {
        return yield* domainError(
          "invalid_input",
          `outline line ${line}: ${field.name} holds one value, and this item gives it another`,
          { line, field: field.name },
        );
      }
      held.add(fieldId);
      const read = yield* syncDomain(() => readValue(raw, type, resolve)).pipe(
        Effect.mapError(atLine(line)),
      );
      if (!read.ok) {
        return yield* domainError(
          "invalid_input",
          `outline line ${line}: ${field.name} is a ${type} field; ${read.reason}`,
          { line, field: field.name },
        );
      }
      entries.push({ field: fieldId, value: read.value });
    }
  }
  return entries;
});

/**
 * The plan of `node.addTree` over `graph`, checked but not stored: every
 * item planned by `node.add`'s own planner (`planNodeAdd`: tag and field
 * resolution, cardinality, placement), each step `put`ting
 * its upserts into `graph` so the next one sees them. Beyond what `node.add`
 * does, refs in text and values are resolved and rewritten first
 * (`linkText`), a dangling one is refused, and a one-valued field given two
 * values by one item is refused at its line. Any failure names its line,
 * a refusal of the commit's system-write rule included (`refusedLine`).
 */
export const planNodeAddTreeEffect = Effect.fn("node.addTree.plan")(function* (
  input: NodeAddTreeInput,
  graph: NodeGraph,
): Effect.fn.Return<
  z.infer<typeof nodeAddTreeDef.outputSchema> & { upserts: KbNode[] },
  DomainError
> {
  const parsed = parseOutline(input.outline);
  if (!parsed.ok) {
    return yield* domainError("invalid_input", `outline line ${parsed.line}: ${parsed.reason}`, {
      line: parsed.line,
    });
  }
  if (parsed.items.length === 0) {
    return yield* domainError("invalid_input", "the outline has no items");
  }
  const at = yield* currentIso;
  const flat = flatten(parsed.items, input.position);
  const ids: NodeId[] = [];
  for (let i = 0; i < flat.length; i++) ids.push(yield* freshId);
  const idAt = (index: number): NodeId =>
    present(ids[index], "node.addTree mints one id per flattened item");
  const planned: PlannedItem[] = flat.map(({ item, parentIndex, position }, index) => ({
    item,
    id: idAt(index),
    parent: parentIndex === null ? input.parent : idAt(parentIndex),
    position,
  }));

  const resolve = refResolver(graph, planned);
  const written = new Set<NodeId>();

  for (const { item, id, parent, position } of planned) {
    const props = yield* itemProps(item, graph, resolve);
    const { written: wrote } = yield* syncDomain(() =>
      planNodeAdd(
        graph,
        {
          text: linkText(item.text, resolve),
          props,
          tags: item.tags,
          ...(parent === undefined ? {} : { parent }),
          ...(position === undefined ? {} : { position }),
          ...(input.force === true ? { force: true } : {}),
        },
        id,
        at,
      ),
    ).pipe(Effect.mapError(atLine(item.line)));
    for (const w of wrote) written.add(w);
  }

  return {
    ids,
    lines: Object.fromEntries(planned.map(({ item, id }) => [String(item.line), id])),
    upserts: [...written].map((id) => present(graph.get(id), "a written node is in the graph")),
  };
});

/**
 * `node.addTree`: a whole outline as one transaction — its plan over the
 * session's stored graph, indexed once, committed once through
 * `persistEffect`: one integrity check, one transaction-log entry, one undo
 * step. Any failure, on any line, writes nothing.
 */
export const nodeAddTreeEffect = Effect.fn("node.addTree")(function* (
  input: NodeAddTreeInput,
): Effect.fn.Return<z.infer<typeof nodeAddTreeDef.outputSchema>, DomainError, KbCtx | KbStore> {
  const ctx = yield* KbCtx;
  const { ids, lines, upserts } = yield* planNodeAddTreeEffect(input, sessionGraph(ctx));
  yield* persistEffect(ctx, { upserts, deletes: [] }, forcedBy(input)).pipe(
    Effect.mapError((err) => {
      const line = refusedLine(err, input.parent, lines);
      return line === null ? err : atLine(line)(err);
    }),
  );
  return { ids, lines };
});
