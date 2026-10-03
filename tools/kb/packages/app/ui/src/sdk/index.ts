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
export { useAppearance, useFollow, useGeneration, useNode, useQueryRows, useRefInk } from "./hooks";

// The UI points: views, docks and node commands.
export { DockPoint, ViewPoint, provideView, type ViewProps } from "@/lib/plugins";
export { CommandPoint, nodeAction, type Command } from "@/lib/commands";

// The primitives.
export { IconButton } from "@/components/ui/icon-button";
export { MdView } from "@/components/ui/md-view";
export { WorkspaceState } from "@/components/ui/workspace-state";

// Pure helpers: class names, tokens, logging, panes, routing and toasts.
export { cn } from "@/lib/cn";
export { readTokenColor } from "@/lib/css-color";
export { graphLabelFont } from "@/lib/graph-label";
export { logError, logWarn } from "@/lib/log";
export { usePane } from "@/lib/pane";
export { nodePath } from "@/lib/router";
export { textOr } from "@/lib/text";
export { toast } from "@/lib/toast";

// Query rows, named by their `:find` columns, and what a sandbox frame is handed.
export { chartRecords, queryRecords, type QueryRecords } from "@/ds";
export type { HostedFrame, SandboxEvents, SandboxPorts, SandboxRun } from "@/lib/sandbox-host";
