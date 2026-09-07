/**
 * The one command registry, behind both palettes and the runner.
 *
 * A command is registered beside its implementation: an id, when it applies,
 * what it does, and — for commands the graph has no node for — a label and an
 * icon. The ⌘K palette and the node menu are two *queries* over this list, and
 * running a command is a lookup. Before this, the node menu assembled its set
 * inline while rendering and `runPaletteCommand` branched over every id, so the
 * two re-derived availability separately and neither set was enumerable.
 *
 * Two kinds of command live here and the difference is `scope`, not shape:
 *
 * - `global` commands are the `sys.command` nodes. The node is the source of
 *   truth for the title and the keys, so those rows carry no `chrome` — the
 *   registry binds an id to a handler and restates nothing.
 * - `node` commands act on the row the menu is anchored to. Nothing in the
 *   graph names them, so they carry their own label and icon, and their order
 *   in this list is the order the menu shows.
 *
 * The state a command needs arrives as {@link CommandContext} from the palette
 * that already holds it (GAP [[01M1RXMQPVJKREGDS7D37J1MWN]], the run-command
 * third of it): `lib/` is the leaf zone, so it reads no store.
 */
import { ulid } from "ulid";
import {
  ArrowBendUpLeftIcon,
  ArrowRightIcon,
  EyeIcon,
  EyeSlashIcon,
  HashIcon,
  LinkSimpleIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  PushPinIcon,
  PushPinSlashIcon,
  SquaresFourIcon,
  TableIcon,
  TextTIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { present, typeRefsOf } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { mutations } from "@/actions/mutations";
import { isContextualRef } from "@/lib/contextual-ref";
import { listOntologyItems } from "@/lib/ontology-scope";
import { isPinned } from "@/lib/pinned";
import { DEFAULT_QUERY_EDN, isQueryNode } from "@/lib/query-node";
import { navigate, ontologyPath } from "@/lib/router";
import type { ThemePref, WidthPref } from "@/lib/theme";
import { toast } from "@/lib/toast";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID, isSysPrefixed, type NodeMap } from "@/lib/types";
import type { ViewMode } from "@/lib/view-config";

/** The picker a node command can hand the palette to. */
export type NodeCommandStep = "add-tag" | "add-field" | "add-ref";

/** What commands read and drive on the outline store. */
export interface OutlineCommandApi {
  readonly selectedNodeId: string | null;
  readonly rootNodeId: string;
  readonly ontologyId: string | null;
  readonly nodes: NodeMap;
  readonly wireNodes: WireNode[];
  jumpToNode: (id: string) => void;
  zoomTo: (id: string) => void;
  expandAllInScope: () => void;
  collapseAllInScope: () => void;
}

interface PrefsCommandApi {
  readonly theme: ThemePref;
  readonly width: WidthPref;
  setTheme: (theme: ThemePref) => void;
  setWidth: (width: WidthPref) => void;
}

interface UiCommandApi {
  setPrefsOpen: (open: boolean) => void;
  setGlobalPaletteOpen: (open: boolean) => void;
  setFilterPopoverFrameId: (id: string | null) => void;
}

interface DebugFieldsCommandApi {
  readonly ids: ReadonlySet<string>;
  toggle: (nodeId: string) => void;
}

/** The palette shell a command can dismiss or send to a picker step. */
export interface PaletteSurface {
  close: () => void;
  openStep: (step: NodeCommandStep) => void;
}

/**
 * Which node a command is about.
 *
 * `nodeId` and `frameId` answer different questions, which is why they are two
 * fields: `nodeId` is "which row is this command about" and includes `sys.*`
 * schema rows, whose hidden props are exactly the ones worth revealing;
 * `frameId` is "which frame owns the view config" and excludes them.
 */
interface CommandTarget {
  readonly nodeId: string | null;
  readonly frameId: string | null;
}

export interface CommandContext {
  readonly target: CommandTarget;
  readonly outline: OutlineCommandApi;
  readonly prefs: PrefsCommandApi;
  readonly ui: UiCommandApi;
  readonly debugFields: DebugFieldsCommandApi;
  readonly palette: PaletteSurface;
}

type CommandScope = "global" | "node";

/** A command's own label and icon, for commands no node names. */
interface CommandChrome {
  readonly label: string;
  readonly icon: React.ReactNode;
}

interface Command {
  readonly id: string;
  readonly scope: CommandScope;
  /** Absent ⇒ a `sys.command` node names this command. */
  readonly chrome?: (ctx: CommandContext) => CommandChrome;
  /** Absent ⇒ always offered. */
  readonly when?: (ctx: CommandContext) => boolean;
  readonly run: (ctx: CommandContext) => void | Promise<void>;
}

const THEME_CYCLE: ThemePref[] = ["light", "dark", "system"];

function nextTheme(current: ThemePref): ThemePref {
  const i = THEME_CYCLE.indexOf(current);
  return present(THEME_CYCLE[(i + 1) % THEME_CYCLE.length], "theme cycle index is a modulo");
}

/** The selected row, else the zoomed root — "which row is this command about". */
export function commandTargetNodeId(outline: OutlineCommandApi): string | null {
  if (outline.selectedNodeId !== null) return outline.selectedNodeId;
  if (outline.rootNodeId && outline.rootNodeId !== WORKSPACE_ROOT_ID) return outline.rootNodeId;
  return null;
}

/** Zoomed root, else selected non-sys row — "which frame owns the view config". */
export function viewTargetFrameId(outline: OutlineCommandApi): string | null {
  if (outline.rootNodeId && outline.rootNodeId !== WORKSPACE_ROOT_ID) return outline.rootNodeId;
  const selected = outline.selectedNodeId;
  if (selected !== null && !isSysPrefixed(selected)) return selected;
  return null;
}

function targetNode(ctx: CommandContext) {
  const id = ctx.target.nodeId;
  return id === null ? undefined : ctx.outline.nodes.get(id);
}

/** Run `body` with the target row's id, or do nothing when there is none. */
function onTarget(ctx: CommandContext, body: (nodeId: string) => void): void {
  const nodeId = ctx.target.nodeId;
  if (nodeId === null) return;
  body(nodeId);
}

/** A node command that acts and dismisses the menu. */
function nodeAction(ctx: CommandContext, body: (nodeId: string) => void): void {
  onTarget(ctx, body);
  ctx.palette.close();
}

/** The frame a view command edits, or a toast saying there is none. */
function withFrame(ctx: CommandContext, body: (frameId: string) => void | Promise<void>) {
  const frameId = ctx.target.frameId;
  if (frameId === null) {
    toast("select a frame first");
    return undefined;
  }
  return body(frameId);
}

async function setGlobalViewMode(ctx: CommandContext, mode: ViewMode): Promise<void> {
  await withFrame(ctx, (frameId) => mutations.setViewMode(frameId, mode));
}

/** The ontology to enter: the selected or zoomed one, else the first. */
function preferredOntologyId(ctx: CommandContext): string | null {
  const candidates = listOntologyItems(ctx.outline.wireNodes);
  if (candidates.length === 0) {
    toast("No ontologies yet — try “New ontology”");
    return null;
  }
  const preferred =
    [ctx.outline.selectedNodeId, ctx.outline.rootNodeId].find((id) =>
      candidates.some((c) => c.id === id),
    ) ?? candidates[0]?.id;
  return preferred ?? null;
}

/** A global command's four view modes, as rows rather than a nested ternary. */
const GLOBAL_VIEW_MODES: ReadonlyArray<{ id: string; mode: ViewMode }> = [
  { id: SYSTEM_IDS.cmdViewAsList, mode: "list" },
  { id: SYSTEM_IDS.cmdViewAsTable, mode: "table" },
  { id: SYSTEM_IDS.cmdViewAsBoard, mode: "board" },
  { id: SYSTEM_IDS.cmdViewAsCards, mode: "cards" },
];

/** A node command's four view modes: label, icon and mode, one row each. */
const NODE_VIEW_MODES: ReadonlyArray<{
  id: string;
  label: string;
  icon: React.ReactNode;
  mode: ViewMode;
}> = [
  {
    id: "view-as-list",
    label: "View as: List",
    icon: <ListBulletsIcon size={14} />,
    mode: "list",
  },
  { id: "view-as-table", label: "View as: Table", icon: <TableIcon size={14} />, mode: "table" },
  {
    id: "view-as-board",
    label: "View as: Board",
    icon: <SquaresFourIcon size={14} />,
    mode: "board",
  },
  {
    id: "view-as-cards",
    label: "View as: Cards",
    icon: <SquaresFourIcon size={14} weight="duotone" />,
    mode: "cards",
  },
];

const GLOBAL_COMMANDS: readonly Command[] = [
  {
    id: SYSTEM_IDS.cmdAddNode,
    scope: "global",
    run: async (ctx) => {
      const selected = ctx.outline.selectedNodeId;
      if (selected !== null && !isSysPrefixed(selected)) {
        await mutations.createNodeAfter(selected);
        return;
      }
      const newId = ulid();
      if (await mutations.addRootNode("Untitled", newId)) ctx.outline.jumpToNode(newId);
    },
  },
  {
    id: SYSTEM_IDS.cmdAddTag,
    scope: "global",
    run: async (ctx) => {
      const id = await mutations.defineTag("untitled-tag");
      if (id !== null) ctx.outline.zoomTo(id);
    },
  },
  {
    id: SYSTEM_IDS.cmdDefineField,
    scope: "global",
    run: async (ctx) => {
      const id = await mutations.defineField("untitled-field");
      if (id !== null) ctx.outline.zoomTo(id);
    },
  },
  {
    // The Query tab is gone (W8a); saved queries live under sys.queries.
    id: SYSTEM_IDS.cmdGoQuery,
    scope: "global",
    run: (ctx) => ctx.outline.zoomTo(SYSTEM_IDS.queriesRoot),
  },
  {
    // W4: #query tag + sys.f.query starter EDN, zoomed for editing.
    id: SYSTEM_IDS.cmdNewQuery,
    scope: "global",
    run: async (ctx) => {
      const newId = await mutations.newQueryNode();
      if (newId !== null) ctx.outline.zoomTo(newId);
    },
  },
  {
    id: SYSTEM_IDS.cmdNewOntology,
    scope: "global",
    run: async () => {
      const id = await mutations.defineOntology();
      if (id !== null) navigate(ontologyPath(id));
    },
  },
  {
    id: SYSTEM_IDS.cmdEnterOntology,
    scope: "global",
    run: (ctx) => {
      const id = preferredOntologyId(ctx);
      if (id !== null) navigate(ontologyPath(id));
    },
  },
  {
    id: SYSTEM_IDS.cmdExitOntology,
    scope: "global",
    run: (ctx) => {
      if (ctx.outline.ontologyId === null) {
        toast("Not inside an ontology");
        return;
      }
      navigate("/");
    },
  },
  { id: SYSTEM_IDS.cmdPreferences, scope: "global", run: (ctx) => ctx.ui.setPrefsOpen(true) },
  {
    id: SYSTEM_IDS.cmdToggleTheme,
    scope: "global",
    run: (ctx) => ctx.prefs.setTheme(nextTheme(ctx.prefs.theme)),
  },
  {
    id: SYSTEM_IDS.cmdToggleWidth,
    scope: "global",
    run: (ctx) => ctx.prefs.setWidth(ctx.prefs.width === "centered" ? "full" : "centered"),
  },
  {
    id: SYSTEM_IDS.cmdDebugShowFields,
    scope: "global",
    run: (ctx) => {
      const nodeId = ctx.target.nodeId;
      if (nodeId === null) {
        toast("select a node first");
        return;
      }
      ctx.debugFields.toggle(nodeId);
    },
  },
  { id: SYSTEM_IDS.cmdExpandAll, scope: "global", run: (ctx) => ctx.outline.expandAllInScope() },
  {
    id: SYSTEM_IDS.cmdCollapseAll,
    scope: "global",
    run: (ctx) => ctx.outline.collapseAllInScope(),
  },
  ...GLOBAL_VIEW_MODES.map(
    ({ id, mode }): Command => ({
      id,
      scope: "global",
      run: (ctx) => setGlobalViewMode(ctx, mode),
    }),
  ),
  {
    // Portal host (ViewFilterPopoverHost) anchors to toolbar/frame row; if no
    // DOM host exists it toasts and clears — never a silent no-op.
    id: SYSTEM_IDS.cmdViewFilter,
    scope: "global",
    run: (ctx) =>
      withFrame(ctx, (frameId) => {
        ctx.ui.setFilterPopoverFrameId(frameId);
      }),
  },
];

/**
 * The node menu, in the order it shows.
 *
 * The three conditional rows sit where the old splice calls put them, so a
 * static order plus `when` reproduces every combination of conditions.
 */
const NODE_COMMANDS: readonly Command[] = [
  {
    id: "add-tag",
    scope: "node",
    chrome: () => ({ label: "Add tag", icon: <HashIcon size={14} weight="bold" /> }),
    run: (ctx) => ctx.palette.openStep("add-tag"),
  },
  {
    id: "turn-query",
    scope: "node",
    chrome: () => ({
      label: "Turn into query",
      icon: <MagnifyingGlassIcon size={14} weight="bold" />,
    }),
    when: (ctx) => {
      const node = targetNode(ctx);
      return node !== undefined && !isQueryNode(node);
    },
    run: (ctx) =>
      nodeAction(ctx, (nodeId) => {
        // Setting the field is the whole gesture: the field is the kind, so
        // there is no tag to apply alongside it and nothing to keep in sync.
        void mutations.updateProp(nodeId, SYSTEM_IDS.queryField, {
          t: "str",
          v: DEFAULT_QUERY_EDN,
        });
      }),
  },
  {
    id: "turn-ref",
    scope: "node",
    chrome: () => ({
      label: "Turn into reference…",
      icon: <LinkSimpleIcon size={14} weight="bold" />,
    }),
    when: (ctx) => {
      const node = targetNode(ctx);
      return node !== undefined && !isContextualRef(node);
    },
    run: (ctx) => ctx.palette.openStep("add-ref"),
  },
  {
    id: "add-field",
    scope: "node",
    chrome: () => ({ label: "Add field", icon: <TextTIcon size={14} weight="bold" /> }),
    run: (ctx) => ctx.palette.openStep("add-field"),
  },
  {
    // Kind slot, not badges: `resolveTags` never emits `sys.tag`, so reading
    // the display list made every node look like a non-tag and the menu
    // offered "Make supertag" on nodes that already were one.
    id: "make-supertag",
    scope: "node",
    chrome: () => ({ label: "Make supertag", icon: <HashIcon size={14} weight="fill" /> }),
    when: (ctx) => {
      const node = targetNode(ctx);
      return node !== undefined && !typeRefsOf(node).includes(SYSTEM_IDS.tag);
    },
    run: (ctx) =>
      nodeAction(ctx, (nodeId) => {
        void (async () => {
          if (!(await mutations.makeSupertag(nodeId))) return;
          // A supertag is schema, so it leaves the outline forest the moment it
          // becomes one. Zoom to it rather than letting the row vanish — and
          // its field template is the next thing anyone wants anyway.
          ctx.outline.zoomTo(nodeId);
        })();
      }),
  },
  {
    id: "search-all",
    scope: "node",
    chrome: () => ({ label: "Search everything… ⌘S", icon: <MagnifyingGlassIcon size={14} /> }),
    run: (ctx) => {
      ctx.palette.close();
      ctx.ui.setGlobalPaletteOpen(true);
    },
  },
  {
    id: "indent",
    scope: "node",
    chrome: () => ({ label: "Indent", icon: <ArrowRightIcon size={14} /> }),
    run: (ctx) => nodeAction(ctx, (nodeId) => void mutations.indentNode(nodeId)),
  },
  {
    id: "outdent",
    scope: "node",
    chrome: () => ({ label: "Outdent", icon: <ArrowBendUpLeftIcon size={14} /> }),
    run: (ctx) => nodeAction(ctx, (nodeId) => void mutations.outdentNode(nodeId)),
  },
  {
    // Pinning is listing (lib/pinned); the label is the current state so the
    // row reads as a toggle rather than as a fire-and-hope command.
    id: "toggle-pin",
    scope: "node",
    chrome: (ctx) => {
      const nodeId = ctx.target.nodeId;
      const pinned = nodeId !== null && isPinned(ctx.outline.nodes, nodeId);
      return {
        label: pinned ? "Unpin" : "Pin",
        icon: pinned ? (
          <PushPinSlashIcon size={14} weight="bold" />
        ) : (
          <PushPinIcon size={14} weight="bold" />
        ),
      };
    },
    run: (ctx) => nodeAction(ctx, (nodeId) => void mutations.togglePin(nodeId)),
  },
  {
    // Per node, never global: the answer is about the node you are looking at
    // (stores/debug-fields.store).
    id: "toggle-debug-fields",
    scope: "node",
    chrome: (ctx) => {
      const nodeId = ctx.target.nodeId;
      const on = nodeId !== null && ctx.debugFields.ids.has(nodeId);
      return {
        label: on ? "Hide debug fields" : "Show debug fields",
        icon: on ? <EyeSlashIcon size={14} /> : <EyeIcon size={14} />,
      };
    },
    run: (ctx) => nodeAction(ctx, (nodeId) => ctx.debugFields.toggle(nodeId)),
  },
  {
    id: "delete",
    scope: "node",
    chrome: () => ({ label: "Delete node", icon: <TrashIcon size={14} /> }),
    run: (ctx) => nodeAction(ctx, (nodeId) => void mutations.deleteNode(nodeId)),
  },
  ...NODE_VIEW_MODES.map(
    ({ id, label, icon, mode }): Command => ({
      id,
      scope: "node",
      chrome: () => ({ label, icon }),
      run: (ctx) => nodeAction(ctx, (nodeId) => void mutations.setViewMode(nodeId, mode)),
    }),
  ),
  {
    id: "view-filter",
    scope: "node",
    chrome: () => ({ label: "Filter…", icon: <MagnifyingGlassIcon size={14} /> }),
    run: (ctx) => nodeAction(ctx, (nodeId) => ctx.ui.setFilterPopoverFrameId(nodeId)),
  },
];

const COMMANDS: readonly Command[] = [...GLOBAL_COMMANDS, ...NODE_COMMANDS];

const BY_ID: ReadonlyMap<string, Command> = new Map(COMMANDS.map((c) => [c.id, c]));

/** One row of the node menu: what to show, and what pressing it does. */
export interface NodeCommandListing {
  readonly id: string;
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly run: () => void;
}

/**
 * The commands this node offers, in order — the node menu's query over the
 * registry. A command with no `chrome` cannot be a node command, so a
 * `scope: "node"` row without one is a programming error rather than a
 * silently missing row.
 */
export function listNodeCommands(ctx: CommandContext): NodeCommandListing[] {
  return COMMANDS.filter(
    (command) => command.scope === "node" && (command.when?.(ctx) ?? true),
  ).map((command) => {
    const chrome = present(command.chrome, `node command ${command.id} has no chrome`)(ctx);
    return {
      id: command.id,
      label: chrome.label,
      icon: chrome.icon,
      run: () => void runCommand(command.id, ctx),
    };
  });
}

/** Run a command by id — the runner both palettes share. */
export async function runCommand(commandId: string, ctx: CommandContext): Promise<void> {
  const command = BY_ID.get(commandId);
  if (command === undefined) {
    toast(`Unknown command: ${commandId}`);
    return;
  }
  await command.run(ctx);
}
