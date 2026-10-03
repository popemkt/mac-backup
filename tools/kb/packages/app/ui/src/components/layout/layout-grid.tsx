/**
 * A layout drawn as splits and tabs, by dockview behind the adapter
 * (`dockview-adapter.ts`): the kb tree is what it is handed and what every
 * change it reports is read back into, so dockview's JSON is never kept.
 * The workspace draws its panes with it, movable; a dashboard draws its
 * panes with it, fixed. This module and the adapter are the only ones that
 * load dockview, and they load in a chunk of their own, when a second pane
 * opens or a dashboard is shown.
 */
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import "./dockview-theme.css";
import { XIcon } from "@phosphor-icons/react";
import { sameLayout, type LayoutTree } from "@kb/views";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";
import { PANE_COMPONENT, fromDockview, toDockview, type PaneParams } from "./dockview-adapter";
import { PaneMount } from "./pane-mount";
import type { ElementOf } from "./use-pane-bodies";
import { PaneSwitcher } from "./pane-switcher";
import { usePaneTitle } from "./pane-title";

/** kb's own dockview theme: every value a design-system token (`dockview-theme.css`). */
const KB_THEME: DockviewTheme = {
  name: "kb",
  className: "dockview-theme-kb",
  gap: 0,
  dndOverlayMounting: "relative",
  dndPanelOverlay: "group",
  dndTabIndicator: "line",
};

export interface LayoutGridProps {
  readonly tree: LayoutTree;
  /** The pane that has the focus, if one of these does. */
  readonly focused: string | null;
  readonly elementOf: ElementOf;
  /**
   * A workspace's panes can be dragged, docked, closed and switched to
   * another view; a dashboard's are fixed.
   */
  readonly movable: boolean;
  readonly onFocus: (id: string) => void;
  /** Take an arrangement the person made by dragging, resizing or picking a tab. */
  readonly onArrange?: (tree: LayoutTree) => void;
  readonly onClose?: (id: string) => void;
  /** Move a pane to another location (its view switcher). */
  readonly onNavigate?: (id: string, path: string) => void;
}

interface GridParts {
  readonly elementOf: ElementOf;
  readonly movable: boolean;
  readonly focused: string | null;
  readonly onClose: ((id: string) => void) | undefined;
  readonly onNavigate: ((id: string, path: string) => void) | undefined;
}

const GridContext = createContext<GridParts | null>(null);

function useGridParts(): GridParts {
  const parts = useContext(GridContext);
  if (parts === null) throw new Error("a pane drawn outside its layout grid");
  return parts;
}

function pathOf(params: unknown): string {
  const { path } = (params ?? {}) as Partial<PaneParams>;
  return typeof path === "string" ? path : "/";
}

/** A pane's body in its group: the element its body is drawn into, placed here. */
function PaneContent({ api }: IDockviewPanelProps) {
  const { elementOf } = useGridParts();
  return <PaneMount element={elementOf(api.id)} />;
}

/** A pane's tab: its title (its view switcher, in a workspace) and its close button. */
function PaneTab({ api, params }: IDockviewPanelHeaderProps) {
  const { movable, focused, onClose, onNavigate } = useGridParts();
  const path = pathOf(params);
  const title = usePaneTitle(path);
  const focusedHere = focused === api.id;
  return (
    <div
      className={cn(
        "kb-pane-tab group/tab flex h-full min-w-0 items-center gap-0.5 pl-1.5 pr-1 text-ui",
        focusedHere ? "text-foreground/80" : "text-foreground/45",
      )}
      data-pane-tab={api.id}
      data-focused={focusedHere ? "true" : undefined}
    >
      {movable && onNavigate !== undefined ? (
        <PaneSwitcher path={path} title={title} onChoose={(next) => onNavigate(api.id, next)} />
      ) : (
        <span className="truncate px-1">{title}</span>
      )}
      {movable && onClose !== undefined ? (
        <IconButton
          label={`Close ${title}`}
          icon={XIcon}
          className="opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onClose(api.id)}
        />
      ) : null}
    </div>
  );
}

const COMPONENTS = { [PANE_COMPONENT]: PaneContent };
const TAB_COMPONENTS = { [PANE_COMPONENT]: PaneTab };

/** The box dockview lays out in: its element's size, or a screen's before it has one. */
function boxOf(element: HTMLElement | null) {
  const width = element?.clientWidth ?? 0;
  const height = element?.clientHeight ?? 0;
  return { width: width > 0 ? width : 1280, height: height > 0 ? height : 720 };
}

export default function LayoutGrid({
  tree,
  focused,
  elementOf,
  movable,
  onFocus,
  onArrange,
  onClose,
  onNavigate,
}: LayoutGridProps) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<DockviewApi | null>(null);
  // What dockview hears about lives in refs, so its listeners are set once.
  const latest = useRef({ tree, onFocus, onArrange });
  useEffect(() => {
    latest.current = { tree, onFocus, onArrange };
  });

  const show = (target: LayoutTree): void => {
    const grid = api.current;
    if (grid === null) return;
    const current = fromDockview(grid.toJSON());
    if (current !== null && sameLayout(current, target)) return;
    grid.fromJSON(toDockview(target, boxOf(host.current)));
  };

  const onReady = (event: DockviewReadyEvent): void => {
    api.current = event.api;
    show(latest.current.tree);
    event.api.onDidLayoutChange(() => {
      const next = fromDockview(event.api.toJSON());
      if (next !== null && !sameLayout(next, latest.current.tree)) latest.current.onArrange?.(next);
    });
    event.api.onDidActivePanelChange((change) => {
      if (change.panel !== undefined) latest.current.onFocus(change.panel.id);
    });
  };

  // The kb tree is canonical: when it changes from outside, dockview is shown
  // it; and the focused pane is dockview's active panel.
  useEffect(() => {
    show(tree);
    const panel = focused === null ? undefined : api.current?.getPanel(focused);
    if (panel !== undefined && !panel.api.isActive) panel.api.setActive();
  });

  const parts = useMemo(
    (): GridParts => ({ elementOf, movable, focused, onClose, onNavigate }),
    [elementOf, movable, focused, onClose, onNavigate],
  );
  return (
    <GridContext.Provider value={parts}>
      <div
        ref={host}
        className="kb-layout-grid relative min-h-0 min-w-0 flex-1"
        data-movable={movable}
      >
        <DockviewReact
          className="absolute inset-0"
          theme={KB_THEME}
          components={COMPONENTS}
          tabComponents={TAB_COMPONENTS}
          defaultTabComponent={PaneTab}
          onReady={onReady}
          disableDnd={!movable}
          locked={!movable}
          // Panes stay in this window. GAP [[01M3Q5DP9TQF0E9DZMHAKHMGWD]]
          disableFloatingGroups
          singleTabMode="fullwidth"
          noPanelsOverlay="emptyGroup"
        />
      </div>
    </GridContext.Provider>
  );
}
