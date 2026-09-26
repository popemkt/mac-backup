/**
 * The browser's plugin kernel and the points the UI is assembled from.
 *
 * The same `@kb/plugin` kernel the server loads extensions into runs here, so
 * a page is a contribution, not a branch in the shell: a plugin folder (and
 * later an extension's `./ui` entry) contributes its views, the routes that
 * lead to them, and the sidebar section that lists them, and the shell renders
 * whatever is registered. Unloading a plugin removes all three, because the
 * kernel ties every contribution to the plugin's scope.
 *
 * The contract of `ViewPoint` and `RoutePoint` is stated once, in
 * DESIGN-UI.md → UI points: routes and views. They belong to `@kb/ui-sdk`
 * once it exists: GAP [[01M3EZRFTS1W8SB97GFJAWD92X]].
 */
import {
  createElement,
  useMemo,
  useSyncExternalStore,
  type ComponentType,
  type FunctionComponent,
  type ReactElement,
} from "react";
import type { Icon } from "@phosphor-icons/react";
import { Cause, Effect, Exit } from "effect";
import {
  Point,
  makeKernel,
  type Contribution,
  type ContributionEntry,
  type Plugin,
  type PointKey,
} from "@kb/plugin";
import { usePath } from "@/lib/router";
import { toast } from "@/lib/toast";

/**
 * Where a host renders a view. Only `page` exists while every view fills a
 * page box: GAP [[01M3EZR20H0CDF5MD01M2S26C5]].
 */
export type Placement = "page";

/**
 * A view's name and the params it renders from. Made once by the plugin that
 * owns the view and compared by identity, like `Service`/`Point` keys: a key
 * spelled alike but created elsewhere is a different key. `~params` is never
 * set; it carries `P` for the compiler.
 */
export interface ViewKey<P> {
  readonly kind: "view";
  /** `<namespace>.<local id>`: the owning plugin's namespace, then the view's id. */
  readonly id: `${string}.${string}`;
  readonly "~params"?: P;
}

/** The params of a view that renders from nothing but the store (the outline, a list). */
export type NoParams = Readonly<Record<never, never>>;

export function viewKey<P>(): (id: `${string}.${string}`) => ViewKey<P> {
  return (id) => ({ kind: "view", id });
}

/** What a host guarantees a view: never a store, never `ctx`. */
export interface ViewHost {
  readonly placement: Placement;
}

export interface ViewProps<P> {
  readonly params: P;
  readonly host: ViewHost;
}

export interface View<P> {
  readonly key: ViewKey<P>;
  readonly placements: readonly Placement[];
  /** The params the view contract mounts this view with. */
  readonly sample: P;
  readonly Component: FunctionComponent<ViewProps<P>>;
}

/**
 * A view as the point holds it, its params erased so views of every `P` share
 * one point. Only {@link findView} reads one back as a `View<P>`.
 */
export interface ProvidedView {
  readonly key: ViewKey<unknown>;
  readonly placements: readonly Placement[];
  readonly sample: unknown;
  readonly Component: FunctionComponent<ViewProps<never>>;
}

export const ViewPoint = Point<ProvidedView>()("ui.views");

/** The local id a contribution under `key` takes: the key's id past its namespace. */
function localIdOf(key: ViewKey<unknown>): string {
  return key.id.slice(key.id.indexOf(".") + 1);
}

/** The `ViewPoint` contribution for `key`, under the key's own local id. */
export function provideView<P>(
  key: ViewKey<P>,
  view: Omit<View<P>, "key">,
): ContributionEntry<ProvidedView> {
  const provided: View<P> = { key, ...view };
  return { id: localIdOf(key), value: provided };
}

/**
 * How the shell frames a page: `scroll` and `fixed` sit under the workspace
 * header in the one main region (a canvas owns its own viewport, so `fixed`
 * does not scroll); `full` takes the whole column, header and all (the graph).
 */
type RouteFrame = "scroll" | "fixed" | "full";

/** A path resolved to a view and its params; it owns no page component. */
export interface Route<P> {
  readonly view: ViewKey<P>;
  /**
   * The params when this route owns the path, else `null`. A path no route
   * owns is not found; no route takes "whatever is left".
   */
  readonly match: (path: string) => P | null;
  readonly frame: (params: P) => RouteFrame;
  /** Shown while the workspace loads under this route. */
  readonly pendingTitle: (params: P) => string;
  /** Rendered above the page, outside its scroll region (a scope bar). */
  readonly Chrome?: ComponentType<{ readonly params: P }>;
}

/** The page a path resolved to: which view, with what params. */
export interface MatchedRoute {
  readonly view: ViewKey<unknown>;
  readonly params: unknown;
}

/** A matched route with what the shell frames it with, read off the route. */
export interface ResolvedRoute extends MatchedRoute {
  readonly frame: RouteFrame;
  readonly pendingTitle: string;
  readonly chrome: ReactElement | null;
}

/** A route as the point holds it: resolving a path keeps its params typed inside. */
export interface ProvidedRoute {
  readonly resolve: (path: string) => ResolvedRoute | null;
}

export const RoutePoint = Point<ProvidedRoute>()("ui.routes");

/** The `RoutePoint` contribution for `route`, under its view's local id. */
export function provideRoute<P>(route: Route<P>): ContributionEntry<ProvidedRoute> {
  const { Chrome } = route;
  return {
    id: localIdOf(route.view),
    value: {
      resolve: (path) => {
        const params = route.match(path);
        if (params === null) return null;
        return {
          view: route.view,
          params,
          frame: route.frame(params),
          pendingTitle: route.pendingTitle(params),
          chrome: Chrome === undefined ? null : createElement(Chrome, { params }),
        };
      },
    },
  };
}

export interface SidebarSection {
  /** Lower first. */
  readonly order: number;
  readonly Component: ComponentType<{ readonly route: MatchedRoute | null }>;
}

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
 * and unload each top-level plugin no longer listed — its routes, views and
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

/*
 * The view points' one trust, in its two readings: an erased view, and a
 * matched route's params, read as the `P` their key stands for. Sound
 * because each was typed by this very key object on the way in
 * (`provideView`, `provideRoute`), and each caller has just checked that
 * identity — the trust `asKeyType` spends in the kernel.
 */
function asViewOf<P>(_key: ViewKey<P>, view: ProvidedView): View<P> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- typed by this very key in provideView; identity checked by the caller
  return view as unknown as View<P>;
}

function asParamsOf<P>(_key: ViewKey<P>, params: unknown): P {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- typed by this very key in provideRoute; identity checked by the caller
  return params as P;
}

/** The view provided under `key`; null when none is, or one made with another key object. */
export function findView<P>(
  views: readonly Contribution<ProvidedView>[],
  key: ViewKey<P>,
): View<P> | null {
  const provided = views.find((view) => view.id === key.id)?.value;
  return provided?.key === key ? asViewOf(key, provided) : null;
}

/** The view provided under `key`, live: null while its owner is unloaded. */
export function useView<P>(key: ViewKey<P>): View<P> | null {
  return findView(useContributions(ViewPoint), key);
}

/** The params of `route` when it renders `key`, else null. */
export function paramsOf<P>(route: MatchedRoute | null, key: ViewKey<P>): P | null {
  return route?.view === key ? asParamsOf(key, route.params) : null;
}

/** The route that owns `path`, or null when none does; the first match wins. */
export function matchRoute(
  routes: readonly Contribution<ProvidedRoute>[],
  path: string,
): ResolvedRoute | null {
  for (const route of routes) {
    const resolved = route.value.resolve(path);
    if (resolved !== null) return resolved;
  }
  return null;
}

/** The current route, as the registered routes resolve it. */
export function useRoute(): ResolvedRoute | null {
  const path = usePath();
  const routes = useContributions(RoutePoint);
  return matchRoute(routes, path);
}
