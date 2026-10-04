/**
 * The view catalog mechanism: the views a host knows, as an agent or a
 * picker reads them — each key's id, option, label and family, which the seed
 * names its option by, and its settings as a JSON Schema derived from the
 * key's params, so the catalog states nothing a key does not.
 *
 * Which views a host knows is not this module's to say. A host reads them
 * off its kernel's view point (DESIGN.md → Extension families → the view
 * catalog is a point) and hands them to {@link viewCatalogOf}.
 */
import { Result, Schema } from "effect";
import { viewIdOfOption } from "@kb/model";
import { paramsFromProps, type ViewKey } from "./view-key.ts";

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

/** What a catalog holds of each view: at least its key. */
export interface CatalogItem {
  readonly key: ViewKey<unknown>;
}

/**
 * The views one host knows, in the order they were contributed. A host may
 * also list views it holds no key for: the page lists every view the server
 * lists, and draws only those a loaded plugin holds the key of.
 */
export interface ViewCatalogOf<D extends CatalogItem> {
  readonly items: readonly D[];
  /**
   * The view `view` names: its id (`outline.board`), or the option node that
   * names it in data (`sys.view.outline.board`). Null for neither.
   */
  itemOf(view: string): D | null;
  /** The key of the view `view` names, as {@link itemOf} finds it. */
  keyOf(view: string): ViewKey<unknown> | null;
  /** Every view as `kb.manifest` lists it, in {@link items}' order. */
  entries(): readonly ViewCatalogEntry[];
  /**
   * The view `view` names as the host lists it, whether or not it holds its
   * key: a held view's entry, else the entry of a view it lists without one.
   * Null for a view it does not list.
   */
  listedOf(view: string): ViewCatalogEntry | null;
}

/** The JSON Schema of a key's params, with its definitions inlined under `$defs`. */
function settingsSchemaOf(key: ViewKey<unknown>): unknown {
  const document = Schema.toJsonSchemaDocument(key.params);
  return Object.keys(document.definitions).length === 0
    ? document.schema
    : { ...document.schema, $defs: document.definitions };
}

/** Entries by key: a key is made once, so its entry is derived once whatever catalog lists it. */
const entryCache = new WeakMap<ViewKey<unknown>, ViewCatalogEntry>();

function entryOf(key: ViewKey<unknown>): ViewCatalogEntry {
  const cached = entryCache.get(key);
  if (cached !== undefined) return cached;
  const defaults = paramsFromProps(key, {}, null, () => {});
  const entry: ViewCatalogEntry = {
    id: key.id,
    option: key.option,
    label: key.label,
    ...(key.family === undefined ? {} : { family: key.family }),
    settings: settingsSchemaOf(key),
    ...(Result.isSuccess(defaults) ? { defaults: defaults.success } : {}),
  };
  entryCache.set(key, entry);
  return entry;
}

/** The view id `view` names: its id as given, or the id its option names. */
function idOf(view: string): string {
  return viewIdOfOption(view) ?? view;
}

/**
 * The catalog of `items`, looked up by view id or option, also listing
 * `unheld`: views the host lists but holds no key for.
 */
export function viewCatalogOf<D extends CatalogItem>(
  items: readonly D[],
  unheld: readonly ViewCatalogEntry[] = [],
): ViewCatalogOf<D> {
  const byId = new Map<string, D>(items.map((item) => [item.key.id, item]));
  const unheldById = new Map(unheld.map((entry) => [entry.id, entry]));
  const itemOf = (view: string): D | null => byId.get(idOf(view)) ?? null;
  return {
    items,
    itemOf,
    keyOf: (view) => itemOf(view)?.key ?? null,
    entries: () => items.map((item) => entryOf(item.key)),
    listedOf: (view) => {
      const item = itemOf(view);
      return item === null ? (unheldById.get(idOf(view)) ?? null) : entryOf(item.key);
    },
  };
}
