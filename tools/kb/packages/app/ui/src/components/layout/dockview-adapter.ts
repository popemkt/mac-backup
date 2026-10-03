/**
 * kb's layout tree and dockview's serialized form, both ways. kb's tree is
 * canonical (DESIGN-UI.md → Panes and layouts): dockview is handed a
 * projection of it and every change it reports comes back through
 * {@link fromDockview}, so dockview's JSON is never stored. Pure: the grid
 * component owns the live instance.
 */
import type { SerializedDockview, SerializedGridObject } from "dockview-react";
import { Orientation } from "dockview-react";
import type { LayoutPane, LayoutTree, SplitDirection } from "@kb/views";

/** One group as dockview serializes it: its panes, by id, and the one showing. */
type GroupPanelViewState = Exclude<SerializedDockview["grid"]["root"]["data"], readonly unknown[]>;

/** What the grid needs to draw a pane's tab: its location. */
export interface PaneParams {
  readonly path: string;
}

/** The box dockview lays a layout out in, in pixels. */
export interface GridSize {
  readonly width: number;
  readonly height: number;
}

/** The content and tab component every pane is drawn with. */
export const PANE_COMPONENT = "pane";

const ORIENTATION: Record<SplitDirection, Orientation> = {
  row: Orientation.HORIZONTAL,
  column: Orientation.VERTICAL,
};

const across = (direction: SplitDirection): SplitDirection =>
  direction === "row" ? "column" : "row";

/**
 * Sizes as dockview lays them out: each share of `total`, in unrounded
 * pixels (dockview rounds when it lays out), so a share reads back as itself.
 */
function pixelSizes(count: number, total: number, sizes: readonly number[] | undefined): number[] {
  const shares = sizes ?? Array.from({ length: count }, () => 1 / count);
  return shares.map((share) => share * total);
}

/** Fractions to four places, or nothing when they are all (about) one share. */
function fractions(pixels: readonly number[]): number[] | undefined {
  const total = pixels.reduce((a, b) => a + b, 0);
  if (total <= 0) return undefined;
  const shares = pixels.map((px) => Math.round((px / total) * 10_000) / 10_000);
  const even = 1 / shares.length;
  // Within a hundredth of even is even: a hairline's rounding is no resize.
  return shares.every((share) => Math.abs(share - even) < 0.01) ? undefined : shares;
}

/** A group's id: its first pane's, so the same tabs project to the same group. */
const groupIdOf = (tabs: readonly LayoutPane[]): string => `group:${tabs[0]?.id ?? ""}`;

function toNode(
  tree: LayoutTree,
  direction: SplitDirection,
  size: number,
  across_: number,
): SerializedGridObject<GroupPanelViewState> {
  if ("tabs" in tree) {
    return {
      type: "leaf",
      size,
      data: {
        id: groupIdOf(tree.tabs),
        views: tree.tabs.map((pane) => pane.id),
        activeView: tree.active ?? tree.tabs[0].id,
      },
    };
  }
  const pixels = pixelSizes(tree.children.length, across_, tree.sizes);
  return {
    type: "branch",
    size,
    data: tree.children.map((child, i) => toNode(child, across(direction), pixels[i] ?? 0, size)),
  };
}

/**
 * `tree` as dockview loads it, laid out in `box`. The root is always a
 * branch, as dockview's grid is: lone tabs become a row of one.
 */
export function toDockview(tree: LayoutTree, box: GridSize): SerializedDockview {
  const direction = "split" in tree ? tree.split : "row";
  const main = direction === "row" ? box.width : box.height;
  const cross = direction === "row" ? box.height : box.width;
  const root =
    "split" in tree
      ? toNode(tree, direction, cross, main)
      : { type: "branch" as const, size: cross, data: [toNode(tree, "column", main, cross)] };
  const panels: SerializedDockview["panels"] = {};
  const visit = (node: LayoutTree): void => {
    if ("split" in node) {
      node.children.forEach(visit);
      return;
    }
    for (const pane of node.tabs) {
      const params: PaneParams = { path: pane.path };
      panels[pane.id] = {
        id: pane.id,
        contentComponent: PANE_COMPONENT,
        tabComponent: PANE_COMPONENT,
        params: { ...params },
      };
    }
  };
  visit(tree);
  return {
    grid: { root, width: box.width, height: box.height, orientation: ORIENTATION[direction] },
    panels,
  };
}

function isLeaf(
  node: SerializedGridObject<GroupPanelViewState>,
): node is SerializedGridObject<GroupPanelViewState> & { data: GroupPanelViewState } {
  return node.type === "leaf";
}

function paneOf(id: string, panels: SerializedDockview["panels"]): LayoutPane {
  const params: unknown = panels[id]?.params;
  const path =
    typeof params === "object" &&
    params !== null &&
    "path" in params &&
    typeof params.path === "string"
      ? params.path
      : "/";
  return { id, path };
}

function fromNode(
  node: SerializedGridObject<GroupPanelViewState>,
  direction: SplitDirection,
  panels: SerializedDockview["panels"],
): LayoutTree | null {
  if (isLeaf(node)) {
    const [first, ...rest] = node.data.views.map((id) => paneOf(id, panels));
    if (first === undefined) return null;
    const active = node.data.activeView;
    return active === undefined || active === first.id
      ? { tabs: [first, ...rest] }
      : { tabs: [first, ...rest], active };
  }
  const branches = Array.isArray(node.data) ? node.data : [];
  const kept = branches.flatMap((child) => {
    const tree = fromNode(child, across(direction), panels);
    return tree === null ? [] : [{ tree, size: child.size ?? 0 }];
  });
  const [only] = kept;
  if (only === undefined) return null;
  if (kept.length === 1) return only.tree;
  const sizes = fractions(kept.map((child) => child.size));
  const children = kept.map((child) => child.tree);
  return sizes === undefined
    ? { split: direction, children }
    : { split: direction, children, sizes };
}

/**
 * The kb layout dockview's state stands for. A branch of one child is that
 * child, sizes become fractions (left out when even), and a group's active
 * pane is named only when it is not its first.
 */
export function fromDockview(serialized: SerializedDockview): LayoutTree | null {
  const direction: SplitDirection =
    serialized.grid.orientation === Orientation.HORIZONTAL ? "row" : "column";
  return fromNode(serialized.grid.root, direction, serialized.panels);
}
