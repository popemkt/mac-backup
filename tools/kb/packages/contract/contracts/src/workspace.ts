import { Context, type Effect } from "effect";
import type { DomainError } from "@kb/model";
import type { SavedQuery } from "./protocol.ts";

/**
 * The three things kb keeps in the workspace beside the node store: the saved
 * queries under `.kb/queries`, the view specs under `.kb/views`, and the
 * opaque media under `.kb/assets`.
 *
 * Each is a port because the *use case* is isomorphic and the *storage* is
 * not: `graph.run` reads a saved query, `render.view` loads a view spec, and
 * `asset.upload` writes bytes — none of that is filesystem work, but all of it
 * ended up importing `node:path` and `effect/FileSystem` because the only
 * implementation was on disk. The names here are the vocabulary; where the
 * bytes live is the adapter's business.
 *
 * Names are ids, not paths. A port takes the name a user typed and is
 * responsible for never letting it address anything outside its directory —
 * the traversal defence is the adapter's, because only the adapter has paths.
 */

/**
 * The grammar of a workspace name: letters, digits, `_`, `.` and `-`, starting
 * on a word character. It is stated here, with the ports, because both sides
 * need it and neither owns it — a use case rejects a bad name before it calls
 * a port, and an adapter skips a directory entry it could never address.
 *
 * Rejects traversal, separators, spaces, control characters, leading dots and
 * dashes, and the empty string. Matches what `kb run` has always accepted.
 */
const WORKSPACE_NAME_RE = /^[\w][\w.-]*$/;

export function isValidWorkspaceName(name: string): boolean {
  return typeof name === "string" && WORKSPACE_NAME_RE.test(name);
}

export interface SavedQueriesPort {
  /** Every readable, well-named `.edn` under the queries directory, by name. */
  readonly list: Effect.Effect<readonly SavedQuery[], DomainError>;
  /** The query's edn, or null when there is none by that name. */
  read(name: string): Effect.Effect<string | null, DomainError>;
}

export class SavedQueries extends Context.Service<SavedQueries, SavedQueriesPort>()(
  "kb/SavedQueries",
) {}

export interface ViewsPort {
  /** Every view name, sorted. */
  readonly list: Effect.Effect<readonly string[], DomainError>;
  /** The view spec's source text, or null when there is none by that name. */
  load(name: string): Effect.Effect<string | null, DomainError>;
}

export class Views extends Context.Service<Views, ViewsPort>()("kb/Views") {}

export interface AssetsPort {
  /**
   * Store `bytes` as the asset `<id>.<ext>` and return the path node text and
   * markdown reference it by (`assets/<id>.<ext>`) — the caller names the
   * asset, the adapter decides where it lands.
   */
  write(id: string, ext: string, bytes: Uint8Array): Effect.Effect<string, DomainError>;
}

export class Assets extends Context.Service<Assets, AssetsPort>()("kb/Assets") {}
