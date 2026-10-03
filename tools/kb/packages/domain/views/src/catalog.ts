/**
 * The view catalog: every view kb provides, as an agent or a picker reads it
 * — the key's id and option, the label and family the seed names it by
 * (`VIEW_VALUES`), and its settings as a JSON Schema derived from the key's
 * params, so the catalog states nothing a key does not.
 */
import { Result, Schema } from "effect";
import { VIEW_VALUES, viewIdOfOption } from "@kb/model";
import { DocsMarkdownView } from "./docs.ts";
import {
  ClusterView,
  Force2dView,
  Force3dView,
  GraphView,
  NeighbourhoodView,
  TreeView,
  TreemapView,
} from "./graph.ts";
import { LabView } from "./lab.ts";
import { LayoutView, NodeView } from "./layout.ts";
import { CanvasListView, CanvasView } from "./canvas.ts";
import { OntologyListView, OntologyScopeView } from "./ontology.ts";
import {
  OutlineBoardView,
  OutlineCardsView,
  OutlineListView,
  OutlineSnippetView,
  OutlineTableView,
  OutlineView,
} from "./outline.ts";
import { paramsFromProps, type ViewKey } from "./view-key.ts";

/**
 * Every view kb provides, one key per view the seed names an option for
 * (`VIEW_VALUES`), in the seed's order; the catalog's tests hold the two to
 * each other, and the UI's view contract holds every view a plugin provides
 * to a key here.
 */
export const VIEW_CATALOG: readonly ViewKey<unknown>[] = [
  OutlineView,
  OutlineListView,
  OutlineTableView,
  OutlineBoardView,
  OutlineCardsView,
  OutlineSnippetView,
  GraphView,
  Force2dView,
  TreeView,
  ClusterView,
  Force3dView,
  TreemapView,
  NeighbourhoodView,
  OntologyListView,
  OntologyScopeView,
  CanvasListView,
  CanvasView,
  LabView,
  DocsMarkdownView,
  LayoutView,
  NodeView,
];

/**
 * The key a view goes by: its id (`outline.board`), or the option node that
 * names it in data (`sys.view.outline.board`). Null for neither.
 */
export function catalogKeyOf(view: string): ViewKey<unknown> | null {
  const id = viewIdOfOption(view) ?? view;
  return VIEW_CATALOG.find((key) => key.id === id) ?? null;
}

/** One view of the catalog, as `kb.manifest` lists it. */
export interface ViewCatalogEntry {
  /** The view's id: what `view.propose` takes, and its option's suffix. */
  readonly id: string;
  /** The option node a view node's `sys.f.view` names. */
  readonly option: string;
  readonly label: string;
  /** The family a host picks between (`graph.renderer`, `outline.frame`), when it is one. */
  readonly family?: string;
  /** The view's settings: the JSON its params decode from (draft 2020-12). */
  readonly settings: unknown;
  /**
   * The settings a view node holding none reads as, when such a node can be
   * read at all: a place to start a proposal from.
   */
  readonly defaults?: unknown;
}

/** The JSON Schema of a key's params, with its definitions inlined under `$defs`. */
function settingsSchemaOf(key: ViewKey<unknown>): unknown {
  const document = Schema.toJsonSchemaDocument(key.params);
  return Object.keys(document.definitions).length === 0
    ? document.schema
    : { ...document.schema, $defs: document.definitions };
}

/** What the seed names a view: its option's label. */
export function viewLabelOf(key: ViewKey<unknown>): string {
  const values: Readonly<Record<string, { readonly label: string }>> = VIEW_VALUES;
  return values[key.id]?.label ?? key.id;
}

function entryOf(key: ViewKey<unknown>): ViewCatalogEntry {
  const defaults = paramsFromProps(key, {}, null, () => {});
  return {
    id: key.id,
    option: key.option,
    label: viewLabelOf(key),
    ...(key.family === undefined ? {} : { family: key.family }),
    settings: settingsSchemaOf(key),
    ...(Result.isSuccess(defaults) ? { defaults: defaults.success } : {}),
  };
}

let entries: readonly ViewCatalogEntry[] | undefined;

/** The catalog's entries, in {@link VIEW_CATALOG}'s order, derived once. */
export function viewCatalog(): readonly ViewCatalogEntry[] {
  entries ??= VIEW_CATALOG.map(entryOf);
  return entries;
}
