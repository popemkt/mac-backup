/**
 * The browser's plugin kernel and the points the UI is assembled from.
 *
 * The same `@kb/plugin` kernel the server loads extensions into runs here, so
 * a page is a contribution, not a branch in the shell: a plugin (a shell
 * folder, or a family's `-ui` package) contributes its views, the routes that
 * lead to them, and the sidebar section that lists them, and the shell renders
 * whatever is registered. Unloading a plugin removes all three, because the
 * kernel ties every contribution to the plugin's scope.
 *
 * The contract of `ViewPoint` and `RoutePoint` is stated once, in
 * DESIGN-UI.md → UI points: routes and views.
 */
import {
  createElement,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ComponentType,
  type FunctionComponent,
  type ReactElement,
} from "react";
import type { Icon } from "@phosphor-icons/react";
import { Cause, Effect } from "effect";
import { runtimeFootprint, type FootprintRow } from "@kb/contracts";
import { present } from "@kb/model";
import {
  Point,
  makeKernel,
  syncPlugins,
  type Contribution,
  type ContributionEntry,
  type Kernel,
  type Plugin,
  type PointKey,
  type ServiceKey,
} from "@kb/plugin";
import { usePath } from "./router";
import type { FamilyView, ViewPicker } from "./view-key";
import {
  type FrameViewKey,
  isFrameViewKey,
  localIdOf,
  type PlainViewKey,
  type ViewKey,
} from "@kb/views";
import { toast } from "./toast";
import type { BackdropDirection, BackdropStrength, SeedBackdrop, SeedOption } from "@kb/model";
import type { OutlineNode } from "./types";

/**
 * Where a host renders a view: `page` fills the box the host gives it (the
 * shell's page, the graph's canvas); `inline` sits in the outline's flow,
 * under the row of the frame it shows. The rest of the placements wait on
 * their first host: GAP [[01M3EZR20H0CDF5MD01M2S26C5]].
 */
export type Placement = "page" | "inline";

/** What a host guarantees a view: never a store, never `ctx`. */
export interface ViewHost {
  readonly placement: Placement;
  /**
   * The view node the host draws the view from, when it draws one (the node
   * route opening a view node): where a view that edits its own settings
   * writes them. Absent for a view drawn from a view type or from code.
   */
  readonly viewNode?: string;
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
  /** How a picker names it, for a view of a family a host chooses between. */
  readonly picker?: ViewPicker;
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
  readonly picker?: ViewPicker;
}

export const ViewPoint = Point<ProvidedView>()("ui.views");

/** The `ViewPoint` contribution for `key`, under the key's own local id. */
/**
 * A view of a family (its key names a `family`) must say how a picker names
 * it: its pickers list it by nothing else. A view of no family has no picker.
 */
export function provideView<P>(
  key: ViewKey<P> & { readonly family: string },
  view: Omit<View<P>, "key" | "picker"> & { readonly picker: ViewPicker },
): ContributionEntry<ProvidedView>;
export function provideView<P>(
  key: PlainViewKey<P>,
  view: Omit<View<P>, "key" | "picker">,
): ContributionEntry<ProvidedView>;
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
  /**
   * The path that opens this route's view with nothing chosen (`/graph`,
   * `/canvas`), for a route that has one: where a pane's view switcher sends
   * a pane to show this view.
   */
  readonly entry?: string;
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
  readonly view: ViewKey<unknown>;
  readonly resolve: (path: string) => ResolvedRoute | null;
  /** How the route frames its view's page for `params`, which must be that view's. */
  readonly frameOf: (params: unknown) => RouteFrame;
  readonly entry?: string;
}

export const RoutePoint = Point<ProvidedRoute>()("ui.routes");

/** The `RoutePoint` contribution for `route`, under its view's local id. */
/**
 * `route`'s params for `path`, or null when it is not the route's — or when
 * the route cannot read it: a malformed escape (`/canvas/%E0%A4%A`) makes
 * `decodeURIComponent` throw, and a path no route can read is no route's,
 * never a crash of the shell that resolves it.
 */
function matchPath<P>(route: Route<P>, path: string): P | null {
  try {
    return route.match(path);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

export function provideRoute<P>(route: Route<P>): ContributionEntry<ProvidedRoute> {
  const { Chrome } = route;
  return {
    id: localIdOf(route.view),
    value: {
      view: route.view,
      frameOf: (params) => route.frame(asParamsOf(route.view, params)),
      ...(route.entry === undefined ? {} : { entry: route.entry }),
      resolve: (path) => {
        const params = matchPath(route, path);
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

/**
 * A dock: a tool window at the workspace's right edge, beside every page
 * (the agent's chat is the first). The workspace header has one toggle per
 * dock, in `order`, and at most one dock is open.
 */
export interface Dock {
  /** Lower first. */
  readonly order: number;
  /** What its toggle and its header call it. */
  readonly label: string;
  readonly icon: Icon;
  readonly Component: ComponentType<{ readonly onClose: () => void }>;
}

export const DockPoint = Point<Dock>()("ui.docks");

/**
 * A page overlay: something a plugin mounts once for the whole page, beside
 * every pane, such as a popover host that portals to the document (the
 * outline's frame filter is the first). The shell mounts every overlay, in
 * `order`, and names none.
 */
export interface Overlay {
  /** Lower first. */
  readonly order: number;
  readonly Component: ComponentType;
}

export const OverlayPoint = Point<Overlay>()("ui.overlays");

/**
 * How a page head frames a backdrop: the breathing room it reserves above
 * the head's content, its frame's height, bounded width and vertical offset,
 * the directions it can face (none, when it has no direction), and how
 * opaque it is at each strength.
 */
export interface BackdropPresentation {
  readonly space: number;
  readonly height: number;
  readonly maxWidth: number;
  readonly offset: number;
  readonly directions: readonly BackdropDirection[];
  readonly opacity: Readonly<Record<BackdropStrength, number>>;
}

/**
 * What the owner is doing on the page, as a backdrop may read it
 * (DESIGN-UI.md → Page-head backdrops): whether a node's text is being
 * edited, and how many writes the graph has taken. A backdrop compares the
 * count with the one it last saw, so it needs no listener of its own for
 * app events. Navigation is the `node` it is handed changing.
 */
export interface PageActivity {
  readonly editing: boolean;
  readonly writes: number;
}

/** What a page head tells the backdrop it shows. */
export interface BackdropProps {
  /** The head's colour: the shown node's tag colour, else the accent. */
  readonly color: string;
  /** The node the head shows, when it shows one. */
  readonly node: OutlineNode | undefined;
  readonly strength: BackdropStrength;
  readonly direction: BackdropDirection;
  /** The presentation's opacity at `strength`. */
  readonly opacity: number;
  /** What the owner is doing on the page now. */
  readonly activity: PageActivity;
}

/**
 * A page-head backdrop: the ambience painted behind a page's head
 * (DESIGN-UI.md → Page-head backdrops). Every page head renders the chosen
 * one through one slot (`PageBackdrop`) and names none. Its `key` is the
 * backdrop its family declares, whose option node choosing it refers to.
 */
export interface Backdrop {
  readonly key: SeedBackdrop;
  readonly presentation: BackdropPresentation;
  readonly Component: ComponentType<BackdropProps>;
}

export const BackdropPoint = Point<Backdrop>()("ui.backdrops");

/**
 * The backdrop its family declares as `key`, as its page plugin contributes
 * it: under the key's local id, so in the family's namespace it answers to
 * the declared id, as a view answers to its key (`provideView`).
 */
export function provideBackdrop(
  key: SeedBackdrop,
  backdrop: Omit<Backdrop, "key">,
): ContributionEntry<Backdrop> {
  return provideDeclared({ key, ...backdrop });
}

/**
 * A design system as the page holds it (DESIGN-UI.md → Design tokens →
 * Design systems): one complete set of layer-1 values, light and dark. Its
 * `key` is the system as its family names it, and the id `<html
 * data-theme>` carries while it paints the page. Its `stylesheet` is what
 * the page adds to paint it: its base and dark blocks over layer 1 under
 * `[data-theme="<id>"]`, empty for core's default, which is layer 1 itself.
 * The page adds every contributed sheet and names none, so a family's
 * system paints while its plugin is loaded and is gone when it unloads.
 */
export interface DesignSystem {
  readonly key: SeedOption;
  readonly stylesheet: string;
}

export const DesignSystemPoint = Point<DesignSystem>()("ui.design-systems");

/** The design system its family names `key`, as its page plugin contributes it (`provideBackdrop`). */
export function provideDesignSystem(
  key: SeedOption,
  system: Omit<DesignSystem, "key">,
): ContributionEntry<DesignSystem> {
  return provideDeclared({ key, ...system });
}

/**
 * A contribution its family names by a key (a backdrop, a design system):
 * it answers to the key's id, `<family>.<local id>`, so it is contributed
 * under the local id and the family's namespace restores the rest, as a
 * view answers to its key. A key of core's, in the root namespace, has no
 * family part and is contributed as it is.
 */
interface Keyed {
  readonly key: SeedOption;
}

function provideDeclared<T extends Keyed>(value: T): ContributionEntry<T> {
  const { id } = value.key;
  return { id: id.slice(id.indexOf(".") + 1), value };
}

/**
 * The contribution `id` names among `contributed`; the first contributed
 * for null, or for an id nobody contributes now. Null only when nothing is
 * contributed. One reading for every keyed point, so a stale choice falls
 * through the same way for a backdrop and a design system.
 */
export function chosenDeclared<T extends Keyed>(
  contributed: readonly Contribution<T>[],
  id: string | null,
): Contribution<T> | null {
  return contributed.find(({ value }) => value.key.id === id) ?? contributed[0] ?? null;
}

/** One kernel per page: everything the UI shows is contributed to it. */
const uiKernel = makeKernel();

/**
 * An optional extension the person switches on and off (Preferences →
 * plugins), by its name, as the server reports it: `on` is whether the
 * server has it loaded, and `label` is how the row names it.
 */
export interface ExtensionSwitch {
  readonly name: string;
  readonly label: string;
  readonly on: boolean;
}

/**
 * Converge the UI kernel on exactly `plugins` (`syncPlugins`, the one
 * convergence every host uses): a top-level plugin no longer listed unloads,
 * and its routes, views and sidebar section go with it, live. A plugin that
 * fails is reported and leaves nothing behind; the rest of the UI still
 * loads.
 */
export function syncUiPlugins(plugins: readonly Plugin[]): void {
  for (const { name, verb, cause } of Effect.runSync(syncPlugins(uiKernel, plugins))) {
    const failure = Cause.squash(cause);
    toast(
      `UI plugin ${name} failed to ${verb}: ${failure instanceof Error ? failure.message : String(failure)}`,
    );
  }
}

/** Called after every change to the page kernel's plugins, services or contributions. */
export const subscribeUiKernel = uiKernel.subscribe;

/**
 * A family's footprint on the page (DESIGN.md → Extension families →
 * footprint): what its browser entry, children included, contributed to
 * `kernel`, the page's own by default, as rows from `page`. The server's
 * rows come from `extension.footprint`; the plugin view joins the two.
 */
export function pageFootprint(family: string, kernel: Kernel = uiKernel): readonly FootprintRow[] {
  return runtimeFootprint(family, { source: "page", kernel });
}

/**
 * A reader for one point that returns the same array until the kernel moves.
 * `useSyncExternalStore` compares snapshots by identity, and the kernel hands
 * out a fresh array per read.
 */
export function pointReader<C>(point: PointKey<C>): () => readonly Contribution<C>[] {
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

/** A point's contributions now, for a reader outside React (a port the shell wires). */
export function currentContributions<C>(point: PointKey<C>): readonly Contribution<C>[] {
  return uiKernel.contributions(point);
}

/** The service provided under `key` now, or undefined while no plugin provides it. */
export function currentService<S>(key: ServiceKey<S>): S | undefined {
  return uiKernel.service(key);
}

/**
 * The provided views of one family, as its pickers list them: each view whose
 * key `isFamily` admits and whose contribution names it (`picker`), in
 * `picker.order`. The one way a family is enumerated, so a picker, a decode
 * and a walk all see the same views.
 */
export function familyViews<K extends ViewKey<unknown>>(
  views: readonly Contribution<ProvidedView>[],
  isFamily: (key: ViewKey<unknown>) => key is K,
): readonly FamilyView<K>[] {
  const listed: FamilyView<K>[] = [];
  for (const { value } of views) {
    if (!isFamily(value.key)) continue;
    // `provideView` requires a family view's picker, so none is ever missing.
    const picker = present(value.picker, `${value.key.id} is a family view with no picker`);
    listed.push({ key: value.key, picker });
  }
  return listed.toSorted((a, b) => a.picker.order - b.picker.order);
}

/**
 * The frame views provided now, in their pickers' order: what a frame's row
 * walk lays its rows out by and the view commands offer (`familyViews`).
 */
export function providedFrameViews(): readonly FamilyView<FrameViewKey>[] {
  return familyViews(currentContributions(ViewPoint), isFrameViewKey);
}

/** A service as provided now, or undefined while none is; re-read whenever the kernel changes. */
export function useService<S>(key: ServiceKey<S>): S | undefined {
  const read = useCallback(() => uiKernel.service(key), [key]);
  return useSyncExternalStore(uiKernel.subscribe, read, read);
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

/**
 * The view `kernel` provides under `key`; null when none is, or one made with
 * another key object. A view answers to its key's id through the kernel's
 * own lookup: the id it was contributed at, or, for a view whose frozen id
 * another family's namespace first stored, an alias.
 */
export function findView<P>(kernel: Pick<Kernel, "lookup">, key: ViewKey<P>): View<P> | null {
  const provided = kernel.lookup(ViewPoint, key.id)?.value;
  return provided?.key === key ? asViewOf(key, provided) : null;
}

/** The view provided under `key` now, for a reader outside React. */
export function currentView<P>(key: ViewKey<P>): View<P> | null {
  return findView(uiKernel, key);
}

/** The view provided under `key`, live: null while its owner is unloaded. */
export function useView<P>(key: ViewKey<P>): View<P> | null {
  const read = useCallback(() => currentView(key), [key]);
  return useSyncExternalStore(uiKernel.subscribe, read, read);
}

/** The params of `route` when it renders `key`, else null. */
export function paramsOf<P>(route: MatchedRoute | null, key: ViewKey<P>): P | null {
  return route?.view === key ? asParamsOf(key, route.params) : null;
}

/**
 * How `key`'s page is framed when it shows `params`: as the route that opens
 * that view frames it, or null when no route opens it. A host that shows a
 * view no route led to (a node opened in its default view) frames it so.
 */
export function pageFrameOf<P>(
  routes: readonly Contribution<ProvidedRoute>[],
  key: ViewKey<P>,
  params: P,
): RouteFrame | null {
  const route = routes.find(({ value }) => value.view === key);
  return route === undefined ? null : route.value.frameOf(params);
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
