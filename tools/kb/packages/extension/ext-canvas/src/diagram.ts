/**
 * `ext.canvas.diagram` (DESIGN.md → Canvas documents → Diagram): a new
 * canvas drawn from structure. From a datalog query, each node its first
 * column names is a card showing it, and the graph's edges among them are
 * edges between the cards: the graph family's own projection, asked for
 * through the host's `CoreInvoke` as a read (`ext.graph.edges`), so a
 * diagram draws the connections the graph draws and elides what it elides.
 * A typed relation's edge is bound to its field. From mermaid flowchart
 * text, each box is a shape and each link an edge (`mermaidDiagram`). Both
 * are one spec, drawn by `@kb/canvas`'s `diagramDoc`, and the canvas is
 * made through the write path (`createCanvasEffect`).
 */
import { Effect, Predicate } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { z } from "zod";
import { CoreInvoke, type ExtensionAction, type KbCtx, type KbStore } from "@kb/contracts";
import {
  DIAGRAM_FLOWS,
  DIAGRAM_LIMITS,
  MERMAID_TEXT_LIMIT,
  diagramDoc,
  mermaidDiagram,
  type DiagramFlow,
  type DiagramLink,
  type DiagramSpec,
} from "@kb/canvas";
import { freshId } from "@kb/model";
import { graphQueryEffect } from "@kb/operations";
import type { KbIndexService } from "@kb/query";
import { CanvasTxError, canvasStep, createCanvasEffect, type CanvasFail } from "./write.ts";

/** The action that answers the edges among a set of nodes, which the graph family provides. */
const GRAPH_EDGES = "ext.graph.edges";

const diagramInput = z
  .object({
    query: z
      .string()
      .min(1)
      .optional()
      .describe("A datalog query whose first column is node ids; each node is a card"),
    mermaid: z
      .string()
      .min(1)
      .max(MERMAID_TEXT_LIMIT)
      .optional()
      .describe("Mermaid flowchart text (flowchart TD, LR, …); each box is a shape"),
    kinds: z
      .array(z.string())
      .optional()
      .describe(
        'For a query: the relationships drawn, as ext.graph.edges takes them (mention, child, ref-prop, "prop:<field id>"); default mention, child and ref-prop',
      ),
    includeSystem: z
      .boolean()
      .optional()
      .describe(
        "For a query: draw scaffolding (sys.* nodes, tags, fields) too; the graph elides it",
      ),
    flow: z
      .enum(DIAGRAM_FLOWS)
      .optional()
      .describe("The way links run; a query's down when absent, a flowchart's as its header says"),
    name: z.string().optional().describe("What the canvas is called; Diagram when absent"),
    parent: z.string().optional().describe("The node the canvas is filed under"),
  })
  .refine((input) => (input.query === undefined) !== (input.mermaid === undefined), {
    message: "give a query or mermaid text, one of them",
  });

const diagramOutput = z.object({
  canvasId: z.string(),
  items: z.number(),
  edges: z.number(),
  /** What did not come across: nodes the graph elides, statements a flowchart says kb draws nothing for. */
  reported: z.array(z.string()),
});

const edgesSchema = z.object({
  nodes: z.array(z.string()),
  edges: z.array(
    z.object({ source: z.string(), target: z.string(), kind: z.string(), label: z.string() }),
  ),
});

type DiagramInput = z.infer<typeof diagramInput>;

/** The node ids a query's rows name in their first column, once each, in order. */
function rowIds(rows: unknown): string[] {
  const ids = Array.isArray(rows)
    ? rows.flatMap((row: unknown) =>
        Array.isArray(row) && Predicate.isString(row[0]) ? [row[0]] : [],
      )
    : [];
  return [...new Set(ids)];
}

/** A graph edge as a diagram link: a typed relation labelled and bound to its field, a built-in kind bare. */
function linkOf(edge: z.infer<typeof edgesSchema>["edges"][number]): DiagramLink {
  const link = { from: edge.source, to: edge.target };
  return edge.kind.startsWith("prop:")
    ? { ...link, label: edge.label, bindField: edge.kind.slice("prop:".length) }
    : link;
}

/** A query's nodes, and the graph's edges among them, as a spec: one card per node the graph shows. */
const querySpecEffect = Effect.fn("ext.canvas.diagram.query")(function* (
  query: string,
  input: DiagramInput,
): Effect.fn.Return<{ spec: DiagramSpec; reported: string[] }, CanvasFail, KbIndexService> {
  const { rows } = yield* graphQueryEffect({ query });
  const ids = rowIds(rows);
  if (ids.length === 0) {
    return yield* Effect.fail(new CanvasTxError("the query names no node in its first column"));
  }
  // Refused before the graph is asked for their edges, by the cap every diagram meets.
  if (ids.length > DIAGRAM_LIMITS.boxes) {
    return yield* Effect.fail(
      new CanvasTxError(
        `the query names ${ids.length} nodes; a diagram draws ${DIAGRAM_LIMITS.boxes} at most`,
      ),
    );
  }
  const invoke = yield* CoreInvoke;
  if (invoke === null) return yield* Effect.fail(new CanvasTxError("this host reads no graph"));
  const receipt = yield* invoke(
    {
      id: GRAPH_EDGES,
      input: {
        ids,
        ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
        ...(input.includeSystem === undefined ? {} : { includeSystem: input.includeSystem }),
      },
    },
    "read",
  );
  if (receipt.status === "failed") return yield* Effect.fail(new CanvasTxError(receipt.message));
  const graph = yield* canvasStep(() => edgesSchema.parse(receipt.output));
  const shown = new Set(graph.nodes);
  return {
    spec: {
      flow: input.flow ?? "down",
      boxes: graph.nodes.map((id) => ({ key: id, item: { preset: "kb-node", nodeId: id } })),
      links: graph.edges.map(linkOf),
    },
    reported: ids
      .filter((id) => !shown.has(id))
      .map((id) => `${id} is scaffolding the graph elides: not drawn`),
  };
});

/** Mermaid flowchart text as a spec, its flow `flow` when one is asked for. */
function mermaidSpec(text: string, flow: DiagramFlow | undefined) {
  const read = mermaidDiagram(text);
  return {
    spec: flow === undefined ? read.spec : { ...read.spec, flow },
    reported: read.reported.map(({ line, note }) => `line ${line}: ${note}`),
  };
}

const canvasDiagramEffect = Effect.fn("ext.canvas.diagram")(function* (
  input: DiagramInput,
): Effect.fn.Return<
  z.infer<typeof diagramOutput>,
  CanvasFail,
  KbCtx | KbStore | FileSystem | KbIndexService
> {
  const { spec, reported } =
    input.query === undefined
      ? yield* canvasStep(() => mermaidSpec(input.mermaid ?? "", input.flow))
      : yield* querySpecEffect(input.query, input);
  // Two ids a link: its edge's and its binding's.
  const minted = yield* Effect.replicateEffect(freshId, spec.links.length * 2);
  const doc = yield* canvasStep(() => diagramDoc(spec, () => minted.shift() ?? ""));
  const canvasId = yield* createCanvasEffect(input.name ?? "Diagram", doc, input.parent);
  return { canvasId, items: doc.nodes.length, edges: doc.edges.length, reported };
});

export const canvasDiagram: ExtensionAction = {
  id: "diagram",
  title: "Draw a diagram",
  description:
    "A new #canvas drawn from structure, flowing down (or as flow says). Give a datalog query: " +
    "each node its first column names is a card showing it, and the graph's edges among them " +
    "(as ext.graph.edges draws them; scaffolding elided unless includeSystem) are edges between " +
    "the cards, a typed relation labelled and bound to its field. Or give mermaid flowchart text: " +
    "each box a shape (rectangle, rhombus as a diamond, circle as an ellipse; other shapes their " +
    "nearest) with its words, each link an edge with its label, heads and line (dotted dashed, " +
    "thick heavy). Boxes are ranked down the flow, each rank laid out across it by arrange. " +
    "What does not come across (a subgraph, a class, a style) is reported.",
  mode: { kind: "write" },
  inputSchema: diagramInput,
  outputSchema: diagramOutput,
  effect: canvasDiagramEffect,
};
