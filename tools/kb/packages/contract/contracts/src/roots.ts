/**
 * The kb roots on this machine beside a session's own, as an action reaches
 * them (DESIGN.md → Locations): what is at a path, which `kb ui` serves a
 * root, a session over a root, and a `kb ui` started for one. A port for the reason the workspace ports
 * are one: the use case (the locations family's actions) names roots, and
 * only the runtime knows how a root's store is chosen by presence, how a
 * root is opened and seeded, and how a server says which root it serves.
 *
 * An action that uses it touches more than its own root, so its mode says
 * `outsideRoot`.
 */
import { Context, type Effect } from "effect";
import type { DomainError } from "@kb/model";
import type { KbContext } from "./session.ts";

/** What a path holds, read from the directory alone: nothing there is opened or written. */
export type RootState =
  | { readonly kind: "store"; readonly backend: string }
  | { readonly kind: "missing"; readonly reason: string }
  | { readonly kind: "not-a-store"; readonly reason: string };

export interface RootProbe {
  /**
   * The path as a server names its root: absolute, with its symlinks
   * resolved where it exists, so two spellings of one root compare equal.
   */
  readonly path: string;
  readonly state: RootState;
}

export interface KbRootsPort {
  /** What is at `path`. Never fails for a path that is absent or not a store: that is its state. */
  readonly probe: (path: string) => Effect.Effect<RootProbe, DomainError>;
  /** The URL of the `kb ui` that serves `root` now, or null (presence, checked by asking it). */
  readonly served: (root: string) => Effect.Effect<string | null, DomainError>;
  /** Make `root` a kb root with an empty store, creating its directory, unless it is one. */
  readonly create: (root: string) => Effect.Effect<void, DomainError>;
  /** A session over `root`, opened as every surface opens one: its store chosen by presence, seeded. */
  readonly open: (root: string) => Effect.Effect<KbContext, DomainError>;
  /**
   * Start a `kb ui` serving `root` and answer its URL once it says it serves
   * the root. The server outlives the call, as a `kb ui` a person starts
   * does. Fails with what the server said when it stops first or does not
   * answer in time.
   */
  readonly serve: (root: string) => Effect.Effect<string, DomainError>;
}

export class KbRoots extends Context.Service<KbRoots, KbRootsPort>()("kb/KbRoots") {}
