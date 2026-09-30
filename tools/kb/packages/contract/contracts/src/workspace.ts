import { Context, type Effect } from "effect";
import type { DomainError, LegacyDocsView } from "@kb/model";
import type { SavedQuery } from "./protocol.ts";

/**
 * The two things kb keeps in the workspace beside the node store: the saved
 * queries under `.kb/queries` and the opaque media under `.kb/assets`. (A
 * docs view is a view node in the store, not a file here: DESIGN.md → View
 * nodes.)
 *
 * Each is a port because the *use case* is isomorphic and the *storage* is
 * not: `graph.run` reads a saved query and `asset.upload` writes bytes —
 * none of that is filesystem work, but all of it
 * ended up importing `node:path` and `effect/FileSystem` because the only
 * implementation was on disk. The names here are the vocabulary; where the
 * bytes live is the adapter's business.
 *
 * Names are ids, not paths. A port takes the name a user typed and is
 * responsible for never letting it address anything outside its directory —
 * the traversal defence is the adapter's, because only the adapter has paths.
 */

/**
 * The grammar of a workspace name is the domain's (`@kb/model`'s
 * `isValidWorkspaceName`): a use case rejects a bad name before it calls a
 * port, and an adapter skips a directory entry it could never address.
 */
export { isValidWorkspaceName } from "@kb/model";

export interface SavedQueriesPort {
  /** Every readable, well-named `.edn` under the queries directory, by name. */
  readonly list: Effect.Effect<readonly SavedQuery[], DomainError>;
  /** The query's edn, or null when there is none by that name. */
  read(name: string): Effect.Effect<string | null, DomainError>;
}

export class SavedQueries extends Context.Service<SavedQueries, SavedQueriesPort>()(
  "kb/SavedQueries",
) {}

/** What a root still keeps as `.kb/views/*.json`: the specs, and the ones that cannot be imported. */
export interface LegacyDocsViewFiles {
  readonly views: readonly LegacyDocsView[];
  /** One line per spec file left out, naming it and why. */
  readonly skipped: readonly string[];
}

/**
 * The docs view specs a root kept before docs views were view nodes: what
 * `views.migrate` imports, then retires. Nothing else reads them.
 * GAP [GAP-LEGACY-DOCS-VIEWS-IMPORT]
 */
export interface LegacyDocsViewsPort {
  readonly read: Effect.Effect<LegacyDocsViewFiles, DomainError>;
  /** Remove the spec files of `names`, which an import has made view nodes of. */
  retire(names: readonly string[]): Effect.Effect<void, DomainError>;
}

export class LegacyDocsViews extends Context.Service<LegacyDocsViews, LegacyDocsViewsPort>()(
  "kb/LegacyDocsViews",
) {}

export interface AssetsPort {
  /**
   * Store `bytes` as the asset `<id>.<ext>` and return the path node text and
   * markdown reference it by (`assets/<id>.<ext>`) — the caller names the
   * asset, the adapter decides where it lands.
   */
  write(id: string, ext: string, bytes: Uint8Array): Effect.Effect<string, DomainError>;
}

export class Assets extends Context.Service<Assets, AssetsPort>()("kb/Assets") {}
