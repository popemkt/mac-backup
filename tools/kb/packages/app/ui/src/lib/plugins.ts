/**
 * The browser's plugin kernel and the points the UI is assembled from.
 *
 * The same `@kb/plugin` kernel the server loads extensions into runs here, so
 * a view is a contribution, not a branch in the shell: a surface folder (and
 * later an extension's `./ui` entry) contributes the pages it owns and the
 * sidebar section that leads to them, and the shell renders whatever is
 * registered. Unloading a plugin removes its pages and its section, because
 * the kernel ties every contribution to the plugin's scope.
 */
import { useMemo, useSyncExternalStore, type ComponentType } from "react";
import type { Icon } from "@phosphor-icons/react";
import { Cause, Effect, Exit } from "effect";
import { Point, makeKernel, type Contribution, type Plugin, type PointKey } from "@kb/plugin";
import { usePath } from "@/lib/router";
import { toast } from "@/lib/toast";

/** Path parameters a surface read from the URL. */
export type SurfaceParams = Readonly<Record<string, string>>;

/**
 * How the shell frames a page: `scroll` and `fixed` sit under the workspace
 * header in the one main region (a canvas owns its own viewport, so `fixed`
 * does not scroll); `full` takes the whole column, header and all (the graph).
 */
type SurfaceFrame = "scroll" | "fixed" | "full";

export interface Surface {
  /** The params when this surface owns the path, else `null`. */
  readonly match: (path: string) => SurfaceParams | null;
  /** Consulted after every other surface: the outline takes whatever is left. */
  readonly fallback?: boolean;
  readonly frame: (params: SurfaceParams) => SurfaceFrame;
  /** Shown while the workspace loads under this surface. */
  readonly pendingTitle: (params: SurfaceParams) => string;
  /** Rendered above the page once the workspace is ready (a scope bar). */
  readonly Chrome?: ComponentType<{ readonly params: SurfaceParams }>;
  /** The page. It owns its error boundary, because only it knows what resets it. */
  readonly Component: ComponentType<{ readonly params: SurfaceParams }>;
}

/** The route a path resolved to: which surface, with what params. */
export interface MatchedRoute {
  /** The surface contribution's id, e.g. `canvas.page`. */
  readonly surface: string;
  readonly params: SurfaceParams;
}

export interface SidebarSection {
  /** Lower first. */
  readonly order: number;
  readonly Component: ComponentType<{ readonly route: MatchedRoute }>;
}

export const SurfacePoint = Point<Surface>()("ui.surfaces");
export const SidebarSectionPoint = Point<SidebarSection>()("ui.sidebar");

/** One kernel per page: everything the UI shows is contributed to it. */
const uiKernel = makeKernel();

/**
 * A plugin the user switches on and off (Preferences → plugins). Only a
 * plugin listed as optional is ever unloaded by preference; the rest load
 * unconditionally. `label` and `icon` are how the preference row names it.
 */
export interface OptionalUiPlugin {
  readonly plugin: Plugin;
  readonly label: string;
  readonly icon: Icon;
}

function reportFailure(name: string, verb: "load" | "unload", cause: Cause.Cause<unknown>): void {
  const failure = Cause.squash(cause);
  toast(
    `UI plugin ${name} failed to ${verb}: ${failure instanceof Error ? failure.message : String(failure)}`,
  );
}

/**
 * Converge the UI kernel on exactly `plugins`: load each one not yet loaded,
 * and unload each top-level plugin no longer listed — its pages and its
 * sidebar section go with it, live, because the kernel ties every
 * contribution to the plugin's scope. A plugin that fails is reported and
 * leaves nothing behind; the rest of the UI still loads.
 */
export function syncUiPlugins(plugins: readonly Plugin[]): void {
  const wanted = new Set(plugins.map((plugin) => plugin.name));
  for (const state of uiKernel.plugins()) {
    if (state.parent !== null || wanted.has(state.name)) continue;
    const exit = Effect.runSyncExit(uiKernel.unload(state.name));
    if (Exit.isFailure(exit)) reportFailure(state.name, "unload", exit.cause);
  }
  const loaded = new Set(uiKernel.plugins().map((plugin) => plugin.name));
  for (const plugin of plugins) {
    if (loaded.has(plugin.name)) continue;
    const exit = Effect.runSyncExit(uiKernel.load(plugin));
    if (Exit.isFailure(exit)) reportFailure(plugin.name, "load", exit.cause);
  }
}

/**
 * A reader for one point that returns the same array until the kernel moves.
 * `useSyncExternalStore` compares snapshots by identity, and the kernel hands
 * out a fresh array per read.
 */
function pointReader<C>(point: PointKey<C>): () => readonly Contribution<C>[] {
  let version = -1;
  let items: readonly Contribution<C>[] = [];
  return () => {
    if (uiKernel.version() !== version) {
      version = uiKernel.version();
      items = uiKernel.contributions(point);
    }
    return items;
  };
}

/** A point's contributions, re-read whenever the kernel changes. */
export function useContributions<C>(point: PointKey<C>): readonly Contribution<C>[] {
  const read = useMemo(() => pointReader(point), [point]);
  return useSyncExternalStore(uiKernel.subscribe, read, read);
}

/** The surface that owns `path`, fallbacks last; the first match wins. */
export function matchSurface(
  surfaces: readonly Contribution<Surface>[],
  path: string,
): { readonly surface: Contribution<Surface>; readonly params: SurfaceParams } | null {
  const ordered = [
    ...surfaces.filter((s) => s.value.fallback !== true),
    ...surfaces.filter((s) => s.value.fallback === true),
  ];
  for (const surface of ordered) {
    const params = surface.value.match(path);
    if (params !== null) return { surface, params };
  }
  return null;
}

/** The current route, as the registered surfaces resolve it. */
export function useRoute(): MatchedRoute & { readonly contribution: Contribution<Surface> | null } {
  const path = usePath();
  const surfaces = useContributions(SurfacePoint);
  const matched = matchSurface(surfaces, path);
  return {
    surface: matched?.surface.id ?? "",
    params: matched?.params ?? {},
    contribution: matched?.surface ?? null,
  };
}
