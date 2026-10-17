/**
 * The sdk's hooks: React readings of `BrowserHost`, each a statically known
 * hook over the host's subscribe and reads. A feature calls these, never a
 * store, and the host holds no hook of its own (see `sdk/host.ts`).
 */
import { useContext, useMemo, useSyncExternalStore } from "react";
import type { WireNode } from "@kb/contracts";
import {
  backdropChoice,
  extensionNodeId,
  type BackdropDirection,
  type BackdropStrength,
} from "@kb/model";
import type { NodeTextHostBinding } from "./components/node-text-host";
import { useNodeTextBindingThrough } from "./components/node-text-port";
import type { KbIndex } from "./query";
import { OpenNodeContext, useFollowThrough, type Follow } from "./lib/follow";
import { useGraphReadThrough, type GraphRead } from "./lib/graph-read";
import type { RefInk } from "./lib/md-edit";
import { usePaneScreenThrough, type PaneCarryOut, type PaneReport } from "./lib/pane-screen";
import { schemaOf, type SchemaIndex } from "./lib/schema";
import type { NodeMap, OutlineNode } from "./lib/types";
import { useQueryNodeRows, type QueryNodeRows } from "./lib/use-query-node-rows";
import type { PageGraphState } from "./lib/page-graph";
import type { Appearance, Prefs, ThemePref } from "./lib/theme";
import { useNarrowViewport } from "./lib/viewport";
import { browserHost, type BrowserHost } from "./host";
import { type FrameViewKey, isFrameViewKey } from "@kb/views";
import {
  BackdropPoint,
  chosenDeclared,
  familyViews,
  useContributions,
  ViewPoint,
  type Backdrop,
  type PageActivity,
} from "./lib/plugins";
import type { Contribution } from "@kb/plugin";
import { type FrameView, frameViewNodeOf, frameViewThrough } from "./lib/frame-view";
import type { FamilyView } from "./lib/view-key";

/** What `read` answers of the host, re-read whenever the host changes. */
function useHostValue<T>(read: (host: BrowserHost) => T): T {
  const host = browserHost();
  const snapshot = () => read(host);
  return useSyncExternalStore(host.subscribe, snapshot, snapshot);
}

/** A node of the live graph; undefined for no id or no such node. */
export function useNode(id: string | undefined): OutlineNode | undefined {
  return useHostValue((host) => (id === undefined ? undefined : host.node(id)));
}

/** A page head's backdrop: the contribution it shows (null, none contributed), its strength and direction. */
export interface PageBackdropChoice {
  readonly backdrop: Contribution<Backdrop> | null;
  readonly strength: BackdropStrength;
  readonly direction: BackdropDirection;
}

/**
 * The backdrop `node`'s page head shows (DESIGN-UI.md → Page-head
 * backdrops): the node's own settings, then core's node's; with no node,
 * core's alone, which is what every page shows unless it says otherwise.
 * A page's own settings are `sys.*` fields, which field rows hide, so no
 * gesture writes them yet. GAP [[01M54CEM0Z5SMAS7KABS7QZ67C]]
 */
export function usePageBackdrop(node?: OutlineNode): PageBackdropChoice {
  const backdrops = useContributions(BackdropPoint);
  const core = useNode(extensionNodeId("core"));
  const choice = backdropChoice(
    [node?.props, core?.props],
    backdrops.map(({ value }) => value.key.id),
  );
  return {
    backdrop: chosenDeclared(backdrops, choice.backdrop),
    strength: choice.strength,
    direction: choice.direction,
  };
}

/** Every node of the live graph. */
export function useNodes(): NodeMap {
  return useHostValue((host) => host.nodes());
}

/** The live graph's schema. */
export function useSchema(): SchemaIndex {
  return useHostValue((host) => host.schema());
}

/**
 * A node text host's binding in `instanceKey`, through the page's host: the
 * same body the shell binds its own text hosts with (`useNodeTextBindingThrough`).
 */
export function useNodeTextBinding(instanceKey: string | undefined): NodeTextHostBinding {
  return useNodeTextBindingThrough(browserHost(), instanceKey);
}

/** Whether any node's text is being edited. */
export function useEditing(): boolean {
  return useHostValue((host) => host.editing());
}

/**
 * What the owner is doing on the page now (`PageActivity`): the one input a
 * backdrop reacts to, read through the host like any other page state.
 */
export function usePageActivity(): PageActivity {
  const editing = useEditing();
  const writes = useGeneration();
  return useMemo(() => ({ editing, writes }), [editing, writes]);
}

/** Whether a node is being edited in this instance. */
export function useIsActive(nodeId: string, instanceKey: string): boolean {
  return useHostValue((host) => host.isActive(nodeId, instanceKey));
}

/** Whether a node is selected in this instance. */
export function useIsSelected(nodeId: string, instanceKey: string): boolean {
  return useHostValue((host) => host.isSelected(nodeId, instanceKey));
}

/**
 * Report what this view shows for the pane it is drawn in, and carry out the
 * commands sent to it with `carryOut`, until it unmounts (`lib/pane-screen`).
 */
export function usePaneScreen(report: PaneReport, carryOut: PaneCarryOut): void {
  usePaneScreenThrough(browserHost().screen, report, carryOut);
}

/** The replica's index, or null before the graph has loaded. */
export function useIndex(): KbIndex | null {
  return useHostValue((host) => host.index());
}

/** The graph's nodes as they came over the wire. */
export function useWireNodes(): WireNode[] {
  return useHostValue((host) => host.wireNodes());
}

/** The index's mutation counter: it moves on every change the replica takes. */
export function useGeneration(): number {
  return useHostValue((host) => host.index()?.generation ?? 0);
}

/**
 * A query node's rows, live: a subscription while the socket is open, the
 * local index otherwise (`useQueryNodeRows`).
 */
export function useQueryRows(input: {
  readonly nodeId: string;
  readonly edn: string | null;
}): QueryNodeRows {
  const live = useHostValue((host) => host.live());
  const index = useIndex();
  const generation = useGeneration();
  return useQueryNodeRows({
    nodeId: input.nodeId,
    edn: input.edn,
    live,
    index,
    generation,
    subscribe: browserHost().subscribeQuery,
  });
}

/** How references in rendered text are inked, for `MdView`'s `ink`. */
export function useRefInk(): RefInk {
  return useHostValue((host) => host.refInk());
}

/** How a pointer in rendered text is followed from where the caller is drawn, for `MdView`'s `onFollow`. */
export function useFollow(): Follow {
  return useFollowThrough(browserHost().follow);
}

/** What the page is painted in, resolved. */
export function useAppearance(): Appearance {
  return useHostValue((host) => host.appearance());
}

/** What `select` answers of the device-level preferences, re-read when they change. */
export function usePrefs<T>(select: (prefs: Prefs) => T): T {
  return useHostValue((host) => select(host.prefs()));
}

export function useTheme(): ThemePref {
  return usePrefs((prefs) => prefs.theme);
}

/** Whether Preferences is open, and how to open or close it. */
export function usePrefsOpen(): readonly [boolean, (open: boolean) => void] {
  const open = useHostValue((host) => host.prefsOpen());
  return [open, (next) => browserHost().setPrefsOpen(next)];
}

/** The left rail's state and gesture, for the `SidebarToggle` primitive. */
export function useSidebarToggle(): {
  readonly open: boolean;
  readonly onToggle: (button: HTMLButtonElement | null) => void;
} {
  const narrow = useNarrowViewport();
  const open = useHostValue((host) => host.sidebarOpen(narrow));
  return { open, onToggle: (button) => browserHost().toggleSidebar(narrow, open, button) };
}

/**
 * What `select` answers of the page's graph state, re-read when the graph
 * moves. `select` answers a value of the state, or one built once per
 * snapshot (`schemaOf`), so a reader re-renders only when it changes.
 */
export function usePageGraph<T>(select: (state: PageGraphState) => T): T {
  const { graph } = browserHost();
  const snapshot = () => select(graph.state());
  return useSyncExternalStore(graph.subscribe, snapshot, snapshot);
}

/** The page's graph, read by this component: it re-renders when what it read changes. */
export function useGraphRead(): GraphRead {
  return useGraphReadThrough(browserHost());
}

/** Open a node as the page around the caller: its pane's location, else the zoom. */
export function useOpenNode(): (id: string) => void {
  return useContext(OpenNodeContext) ?? browserHost().zoomTo;
}

/** Whether a node shows its debug fields. */
export function useDebugFields(nodeId: string): boolean {
  return useHostValue((host) => host.debugFields.ids().has(nodeId));
}

/** Every node showing its debug fields: what a menu row reads to say which way it switches. */
export function useDebugFieldIds(): ReadonlySet<string> {
  return useHostValue((host) => host.debugFields.ids());
}

/** The frame whose filter popover is open, if any. */
export function useFilterFrame(): string | null {
  return useHostValue((host) => host.filterFrame());
}

/** Whether the node palette is open. */
export function useNodePaletteOpen(): boolean {
  return useHostValue((host) => host.nodePaletteOpen());
}

/** The frame views provided, in their pickers' order: live, as `ViewPoint` holds them. */
export function useFrameViews(): readonly FamilyView<FrameViewKey>[] {
  const views = useContributions(ViewPoint);
  return useMemo(() => familyViews(views, isFrameViewKey), [views]);
}

/** Just their keys: what a frame's view node resolves against (`frameViewOf`). */
function useFrameViewKeys(): readonly FrameViewKey[] {
  const views = useFrameViews();
  return useMemo(() => views.map((view) => view.key), [views]);
}

/**
 * The view node `frame` shows its children through, live, read from the
 * schema (the whole graph, `frameViewNodeOf`): the store is read for that
 * one node, so a host re-renders when its view node changes and not otherwise.
 */
export function useFrameViewNode(frame: OutlineNode | undefined): OutlineNode | undefined {
  return usePageGraph((s) => frameViewNodeOf(frame, schemaOf(s)) ?? undefined);
}

/** The view `frame` shows its children in, live (`frameViewOf`). */
export function useFrameView(frame: OutlineNode | undefined): FrameView | null {
  const views = useFrameViewKeys();
  const viewNode = useFrameViewNode(frame);
  return useMemo(() => frameViewThrough(frame, viewNode ?? null, views), [frame, viewNode, views]);
}
