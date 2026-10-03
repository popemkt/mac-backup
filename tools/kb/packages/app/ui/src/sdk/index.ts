/**
 * The sdk zone: the host API a feature's UI builds against (DESIGN-UI.md →
 * Extension UI halves). A feature zone may import only its own files, this
 * barrel and, for 3D, the scene kit. `UI_ALLOWS` holds it to that, so what a
 * feature uses of the shell is listed here and nowhere else.
 *
 * The UI points, the command point, the primitives and the pure helpers are
 * named here. Their code still lives in `lib/`, the primitives and `ds/`,
 * and moves into `@kb/ui-sdk` when the package exists. The shell's state
 * (stores, writes, the invoke path) is reached only through `BrowserHost`
 * and the hooks built over it. GAP [[01M3EZRFTS1W8SB97GFJAWD92X]]
 */
export { BrowserHostService, browserHost } from "./host";
export {
  useAppearance,
  useFollow,
  useGeneration,
  useIndex,
  useNode,
  usePrefsOpen,
  useQueryRows,
  useRefInk,
  useSidebarToggle,
  useTheme,
  useWireNodes,
} from "./hooks";

// The UI points: routes, views, sidebar sections, docks and node commands.
export {
  DockPoint,
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
  paramsOf,
  provideRoute,
  provideView,
  type MatchedRoute,
  type ViewProps,
} from "@/lib/plugins";
export { CommandPoint, nodeAction, type Command } from "@/lib/commands";

// The primitives.
export { EnumSelect } from "@/components/ui/enum-select";
export { IconButton } from "@/components/ui/icon-button";
export { MdView } from "@/components/ui/md-view";
export { SidebarRow, SidebarSection } from "@/components/ui/sidebar-row";
export { SidebarToggle } from "@/components/ui/sidebar-toggle";
export { ThemeIcon } from "@/components/ui/theme-icon";
export { WorkspaceState } from "@/components/ui/workspace-state";
export { ViewErrorBoundary } from "@/components/view-error-boundary";

// Pure helpers: class names, tokens, logging, motion, panes, routing, text,
// timing and toasts.
export { cn } from "@/lib/cn";
export { readTokenColor } from "@/lib/css-color";
export { graphLabelFont } from "@/lib/graph-label";
export { logError, logWarn } from "@/lib/log";
export { useReducedMotion } from "@/lib/motion";
export { usePane } from "@/lib/pane";
export { navigate, nodePath } from "@/lib/router";
export { textOr } from "@/lib/text";
export type { Appearance } from "@/lib/theme";
export {
  TIMING_FALLBACK,
  approach,
  approachRate,
  approachShare,
  easeAt,
  readTiming,
  springRate,
  springResponse,
  stepSpring,
  type CubicBezier,
  type Spring,
  type Timing,
} from "@/lib/timing";
export { toast } from "@/lib/toast";

// Query rows, named by their `:find` columns; the graph as a perspective
// draws it; and what a sandbox frame is handed.
export { chartRecords, queryRecords, type QueryRecords } from "@/ds";
export {
  extractLensGraph,
  listPerspectiveNodes,
  parsePerspective,
  resolvePerspective,
  type LensGraph,
} from "@/lib/graph-lens";
export type { HostedFrame, SandboxEvents, SandboxPorts, SandboxRun } from "@/lib/sandbox-host";
