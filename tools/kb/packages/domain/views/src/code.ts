/**
 * The code view type (generative UI mode C, roadmap decisions 4 and 5): code
 * that draws something, run in the sandbox. Its settings are the code itself,
 * plain text and run exactly as stored, and the grant that says what it may
 * ask of the graph. DESIGN.md → Kinds, roles and options → Code views states
 * the model, and DESIGN.md → Sandbox how it runs; this module is its
 * vocabulary.
 */
import { Schema } from "effect";
import { SYSTEM_IDS, canonicalJson, firstRef, firstStr } from "@kb/model";
import { encodeLensConfig } from "./lens.ts";
import { viewKey, type ConfigReport } from "./view-key.ts";

/** The code plugin's namespace: what a host imports, never the component. */
export const CODE_NAMESPACE = "code";

/**
 * How far code may read. `subject` is the node it is shown for and the nodes
 * under it, through `node.get`; `graph` is every node, through `node.get` and
 * `graph.query`; `none` reads nothing.
 */
export const READ_SCOPES = ["none", "subject", "graph"] as const;
export type ReadScope = (typeof READ_SCOPES)[number];

/**
 * What code may ask of the graph: its grant. It is part of what runs, so it
 * is inside the digest a person trusts, and widening it is new code.
 */
export const CodeGrant = Schema.Struct({
  reads: Schema.Literals(READ_SCOPES),
  /** Every other action the code may call, by id. */
  actions: Schema.Array(Schema.NonEmptyString),
}).annotate({
  description:
    "What the code may ask of the graph. reads: none, subject (the node it is shown for and the nodes under it, through node.get) or graph (every node, through node.get and graph.query). actions: the ids of any other actions it may call through kb.invoke; each call still meets the approval policies as the script actor, and a write that asks for a person waits for one.",
});
export type CodeGrant = typeof CodeGrant.Type;

/** What code may do when its view names no grant: read the node it is shown for, and below. */
export const DEFAULT_GRANT: CodeGrant = { reads: "subject", actions: [] };

/** The code a code view holding none runs: the node it is shown for, and its children. */
export const STARTER_CODE = [
  "const node = await kb.node(kb.subject, 1);",
  'if (node === null) return kb.draw("This view is shown for no node.");',
  'kb.draw(["div", {},',
  '  ["h2", {}, node.text || "(untitled)"],',
  '  ["ul", {}, ...node.children.map((child) => ["li", {}, child.text || child.id])]]);',
].join("\n");

/**
 * A code view's settings: the code, its grant, and the node it is shown for
 * (`source`, stored as `lens.focus`, else the host), which the code reads as
 * `kb.subject`.
 */
export const CodeParams = Schema.Struct({
  source: Schema.optionalKey(Schema.NonEmptyString),
  code: Schema.String,
  grant: CodeGrant,
}).annotate({
  description: [
    "A code view: JavaScript that draws something, run sandboxed in the kb UI (QuickJS until a person trusts it, a Worker after). It runs as the body of an async function and talks to kb only through the kb global:",
    "kb.subject (the node id it is shown for); await kb.node(id, depth?) → that node with its children to depth (default 1); await kb.query(edn) → datalog rows (needs reads: graph); await kb.invoke(actionId, input) → the action's output, or throws an error whose code is e.g. forbidden or approval_required;",
    'kb.draw(drawing) replaces what it shows: a drawing is text, an element ["tag", {attrs}, ...children] (HTML such as div, p, ul, table, button, input, and SVG such as svg, rect, path, text) or a list of drawings; no script, link, image, URL or event-handler attribute survives;',
    'kb.on("click" | "input" | "change" | "data", (event) => …) answers a gesture on a drawn element (event.target is the nearest id, event.value a control\'s value) or a change to the graph; kb.h(tag, attrs, ...children) builds an element; console.log logs.',
    "There is no network, no timers and no DOM. A turn that runs too long, too much memory, or a flood of messages ends the run.",
  ].join(" "),
});
export type CodeParams = typeof CodeParams.Type;

/** The grant a view node holds, read out of its text, else the default. */
function readGrant(raw: string | undefined, report: ConfigReport): { grant?: unknown } {
  if (raw === undefined || raw.trim() === "") return { grant: DEFAULT_GRANT };
  try {
    return { grant: JSON.parse(raw) as unknown };
  } catch {
    report(`${SYSTEM_IDS.codeGrantField} is not JSON`);
    return {};
  }
}

// GAP [[01M41DKTTRA55RA1KF4QBWQ9MF]] Trusting a code view changes its engine only;
// promoting it to a view type (an extension contributing a ViewPoint entry
// mode A can configure) waits on a promotion action and its review flow
// (DESIGN.md → Sandbox → Gaps).
/**
 * A code view: a view node naming `code.view`, whose code is one text prop
 * (`sys.f.code`, run exactly as stored), whose grant is another
 * (`sys.f.code.grant`, canonical JSON), and whose subject is its
 * `lens.focus`, else the node it is shown for.
 */
export const CodeView = viewKey(`${CODE_NAMESPACE}.view`, "Code", CodeParams, {
  read: (props, host, report) => {
    const source = firstRef(SYSTEM_IDS.lensFocusField)(props) ?? host ?? undefined;
    return {
      ...(source === undefined ? {} : { source }),
      // The code as stored, untrimmed: what runs is what a person trusts.
      code: props[SYSTEM_IDS.codeField]?.find((value) => value.t === "str")?.v ?? STARTER_CODE,
      ...readGrant(firstStr(SYSTEM_IDS.codeGrantField)(props), report),
    };
  },
  write: ({ source, code, grant }) => ({
    ...(source === undefined ? {} : encodeLensConfig({ focus: source })),
    [SYSTEM_IDS.codeField]: [{ t: "str", v: code }],
    [SYSTEM_IDS.codeGrantField]: [{ t: "str", v: canonicalJson(grant) }],
  }),
});
