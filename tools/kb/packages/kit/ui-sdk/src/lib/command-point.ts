/**
 * The command point: what a command is, what it is handed, and where a plugin
 * contributes one (DESIGN-UI.md → Extension UI halves). The shell's own
 * commands and the registry over them are `lib/commands.tsx`; a feature's
 * command reaches the palette and the node menu through {@link CommandPoint}
 * and needs nothing else of the shell. A picker a node command hands the node
 * palette to is a {@link PaletteStep}, contributed through
 * {@link PaletteStepPoint} by whichever family owns it.
 */
import type { ReactNode } from "react";
import { Point } from "@kb/plugin";
import type { WireNode } from "@kb/contracts";
import type { FrameViewKey, LayoutTree } from "@kb/views";
import type { ThemePref, WidthPref } from "./theme";
import type { PickerCandidate } from "./picker";
import type { SchemaIndex } from "./schema";
import type { NodeMap } from "./types";
import type { FamilyView } from "./view-key";

/** What commands read and drive on the outline store. */
export interface OutlineCommandApi {
  readonly selectedNodeId: string | null;
  readonly rootNodeId: string;
  readonly ontologyId: string | null;
  readonly nodes: NodeMap;
  readonly wireNodes: WireNode[];
  jumpToNode: (id: string) => void;
  zoomTo: (id: string) => void;
  /** The frame views provided, in their pickers' order. */
  frameViews: () => readonly FamilyView<FrameViewKey>[];
}

interface PrefsCommandApi {
  readonly theme: ThemePref;
  readonly designSystem: string | null;
  readonly width: WidthPref;
  setTheme: (theme: ThemePref) => void;
  setDesignSystem: (designSystem: string | null) => void;
  setWidth: (width: WidthPref) => void;
}

interface UiCommandApi {
  setPrefsOpen: (open: boolean) => void;
  setGlobalPaletteOpen: (open: boolean) => void;
  setFilterPopoverFrameId: (id: string | null) => void;
}

/** What commands read and drive on the workspace (its panes and their arrangement). */
interface WorkspaceCommandApi {
  readonly layout: LayoutTree;
  readonly focused: string;
  openBeside: (beside: string, path: string) => string;
  close: (id: string) => void;
  replace: (layout: LayoutTree) => void;
  save: (text: string) => Promise<string | null>;
}

interface DebugFieldsCommandApi {
  readonly ids: ReadonlySet<string>;
  toggle: (nodeId: string) => void;
}

/** The palette shell a command can dismiss or send to a picker step, by its contribution's id. */
export interface PaletteSurface {
  close: () => void;
  openStep: (step: string) => void;
}

/** What a palette step's candidates are drawn from. */
export interface PaletteStepGraph {
  readonly nodes: NodeMap;
  readonly wireNodes: readonly WireNode[];
  /** The row the palette is anchored to: never its own candidate. */
  readonly anchorId: string | null;
}

/** What a palette step's pick writes: the row it is about, and the candidate picked or named. */
export interface PaletteStepPick {
  readonly targetNodeId: string;
  /** Where field definitions are read from: the whole graph (`lib/schema.ts`). */
  readonly schema: SchemaIndex;
  readonly pickedId: string;
  readonly creating: boolean;
  readonly name: string;
}

/**
 * One picker step of the node palette, whole: every step is the same gesture
 * over one picker engine (`lib/picker`), so only the candidate source,
 * whether a new one may be minted, and the write vary.
 */
export interface PaletteStep {
  readonly label: string;
  readonly placeholder: string;
  readonly icon: ReactNode;
  /** Absent ⇒ nothing can be minted from the picker. */
  readonly createLabel?: (name: string) => string;
  readonly candidates: (graph: PaletteStepGraph) => PickerCandidate[];
  /** At most this many rows; absent, every match. */
  readonly limit?: number;
  readonly commit: (pick: PaletteStepPick) => Promise<void>;
}

/**
 * The node palette's picker steps, by id: a node command opens one with
 * `palette.openStep(id)`. A family's steps come and go with it.
 */
export const PaletteStepPoint = Point<PaletteStep>()("ui.palette-steps");

/**
 * Which node a command is about.
 *
 * `nodeId` and `frameId` answer different questions, which is why they are two
 * fields: `nodeId` is "which row is this command about" and includes `sys.*`
 * schema rows, whose hidden props are exactly the ones worth revealing;
 * `frameId` is "which frame owns the view config" and excludes them.
 */
export interface CommandTarget {
  readonly nodeId: string | null;
  readonly frameId: string | null;
}

export interface CommandContext {
  readonly target: CommandTarget;
  readonly outline: OutlineCommandApi;
  readonly prefs: PrefsCommandApi;
  readonly ui: UiCommandApi;
  readonly debugFields: DebugFieldsCommandApi;
  readonly workspace: WorkspaceCommandApi;
  readonly palette: PaletteSurface;
}

type CommandScope = "global" | "node";

/** A command's own label and icon, for commands no node names. */
interface CommandChrome {
  readonly label: string;
  readonly icon: ReactNode;
}

export interface Command {
  readonly id: string;
  readonly scope: CommandScope;
  /** Absent ⇒ a `sys.command` node names this command. */
  readonly chrome?: (ctx: CommandContext) => CommandChrome;
  /** Absent ⇒ always offered. */
  readonly when?: (ctx: CommandContext) => boolean;
  readonly run: (ctx: CommandContext) => void | Promise<void>;
}

/**
 * Commands a plugin contributes beside its views (the chart's "Add chart").
 * The node menu lists them after the views and the default-view rows and
 * before "Filter…", in the order their plugins loaded; the runner finds them
 * by id like any other.
 */
export const CommandPoint = Point<Command>()("ui.commands");

/** One row of the node menu: what to show, and what pressing it does. */
export interface NodeCommandListing {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly run: () => void;
}

/** Run `body` with the target row's id, or do nothing when there is none. */
function onTarget(ctx: CommandContext, body: (nodeId: string) => void): void {
  const nodeId = ctx.target.nodeId;
  if (nodeId === null) return;
  body(nodeId);
}

/** A node command that acts and dismisses the menu. */
export function nodeAction(ctx: CommandContext, body: (nodeId: string) => void): void {
  onTarget(ctx, body);
  ctx.palette.close();
}
