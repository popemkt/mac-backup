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
 * that already holds it: `lib/` is the leaf zone, so it reads no store.
 */
import { ulid } from "ulid";
import {
  ArrowBendUpLeftIcon,
  ArrowRightIcon,
  EyeIcon,
  EyeSlashIcon,
  HashIcon,
  LinkSimpleIcon,
  MagnifyingGlassIcon,
  PushPinIcon,
  PushPinSlashIcon,
  SidebarSimpleIcon,
  SquaresFourIcon,
  StarIcon,
  TextTIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { hostViewIds, isQueryNode, isViewNode, present, typeRefsOf, viewOptionOf } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { Point } from "@kb/plugin";
import { mutations } from "@/actions/mutations";
import { isContextualRef } from "@/lib/contextual-ref";
import { listOntologyItems } from "@/lib/ontology-scope";
import { isPinned } from "@/lib/pinned";
import { currentContributions } from "@/lib/plugins";
import { DEFAULT_QUERY_EDN } from "@/lib/query-node";
import { navigate, nodePath, ontologyPath } from "@/lib/router";
import {
  DESIGN_SYSTEM_IDS,
  type DesignSystemId,
  type ThemePref,
  type WidthPref,
} from "@/lib/theme";
import { toast } from "@/lib/toast";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID, isSysPrefixed, type NodeMap } from "@/lib/types";
import {
  LayoutView,
  layoutPanes,
  localIdOf,
  paramsFromProps,
  type FrameViewKey,
  type LayoutTree,
} from "@kb/views";
import { Result } from "effect";
import type { FamilyView } from "@/lib/view-key";

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
  /** The frame views provided, in their pickers' order. */
  frameViews: () => readonly FamilyView<FrameViewKey>[];
}

interface PrefsCommandApi {
  readonly theme: ThemePref;
  readonly designSystem: DesignSystemId;
  readonly width: WidthPref;
  setTheme: (theme: ThemePref) => void;
  setDesignSystem: (designSystem: DesignSystemId) => void;
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
  readonly workspace: WorkspaceCommandApi;
  readonly palette: PaletteSurface;
}

type CommandScope = "global" | "node";

/** A command's own label and icon, for commands no node names. */
interface CommandChrome {
  readonly label: string;
  readonly icon: React.ReactNode;
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

const THEME_CYCLE: readonly ThemePref[] = ["light", "dark", "system"];

/** The member after `current` in a closed cycle. */
function nextIn<T>(cycle: readonly T[], current: T): T {
  const i = cycle.indexOf(current);
  return present(cycle[(i + 1) % cycle.length], "cycle index is a modulo");
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
export function nodeAction(ctx: CommandContext, body: (nodeId: string) => void): void {
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

async function setGlobalFrameView(ctx: CommandContext, view: FrameViewKey): Promise<void> {
  await withFrame(ctx, (frameId) => mutations.setFrameView(frameId, view));
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
    run: (ctx) => ctx.prefs.setTheme(nextIn(THEME_CYCLE, ctx.prefs.theme)),
  },
  {
    id: SYSTEM_IDS.cmdSwitchDesignSystem,
    scope: "global",
    run: (ctx) => ctx.prefs.setDesignSystem(nextIn(DESIGN_SYSTEM_IDS, ctx.prefs.designSystem)),
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
  {
    id: SYSTEM_IDS.cmdSaveWorkspace,
    scope: "global",
    run: async (ctx) => {
      const count = layoutPanes(ctx.workspace.layout).length;
      await ctx.workspace.save(`Workspace · ${count} ${count === 1 ? "pane" : "panes"}`);
    },
  },
  {
    id: SYSTEM_IDS.cmdClosePane,
    scope: "global",
    when: (ctx) => layoutPanes(ctx.workspace.layout).length > 1,
    run: (ctx) => ctx.workspace.close(ctx.workspace.focused),
  },
];

/** The arrangement a layout view node holds, when the node is one and holds a legal one. */
function layoutOf(ctx: CommandContext): LayoutTree | null {
  const node = targetNode(ctx);
  if (node === undefined || viewOptionOf(node) !== LayoutView.option) return null;
  const params = paramsFromProps(LayoutView, node.props, null, () => {});
  return Result.isSuccess(params) ? params.success.root : null;
}

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
    // Tana's panels: the node in a new pane to the right of the focused one.
    id: "open-beside",
    scope: "node",
    chrome: () => ({ label: "Open in panel", icon: <SidebarSimpleIcon size={14} mirrored /> }),
    run: (ctx) =>
      nodeAction(ctx, (nodeId) => {
        ctx.workspace.openBeside(ctx.workspace.focused, nodePath(nodeId));
      }),
  },
  {
    // A saved layout opened as the whole screen, its panes movable again.
    id: "open-as-workspace",
    scope: "node",
    chrome: () => ({ label: "Open as workspace", icon: <SquaresFourIcon size={14} /> }),
    when: (ctx) => layoutOf(ctx) !== null,
    run: (ctx) => {
      const layout = layoutOf(ctx);
      if (layout !== null) ctx.workspace.replace(layout);
      ctx.palette.close();
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
];

/** What the node menu offers last, after the views and what plugins contribute. */
const NODE_COMMANDS_AFTER_VIEWS: readonly Command[] = [
  {
    id: "view-filter",
    scope: "node",
    chrome: () => ({ label: "Filter…", icon: <MagnifyingGlassIcon size={14} /> }),
    run: (ctx) => nodeAction(ctx, (nodeId) => ctx.ui.setFilterPopoverFrameId(nodeId)),
  },
];

/**
 * The frame views provided, as commands: each view's `sys.command` node, and a
 * node-menu row named and drawn by its picker, in the pickers' order.
 */
function frameViewCommands(ctx: CommandContext): {
  readonly global: readonly Command[];
  readonly node: readonly Command[];
} {
  const views = ctx.outline.frameViews();
  return {
    global: views.flatMap(({ key, picker }): Command[] =>
      picker.command === undefined
        ? []
        : [{ id: picker.command, scope: "global", run: (c) => setGlobalFrameView(c, key) }],
    ),
    node: views.map(
      ({ key, picker }): Command => ({
        id: `view-as-${localIdOf(key)}`,
        scope: "node",
        chrome: () => {
          const Icon = picker.icon;
          return {
            label: `View as: ${picker.label}`,
            icon: Icon === undefined ? null : <Icon size={14} weight={picker.iconWeight} />,
          };
        },
        run: (c) => nodeAction(c, (nodeId) => void mutations.setFrameView(nodeId, key)),
      }),
    ),
  };
}

/** What a menu calls a view node: its text, else the label of the view it names. */
function viewLabel(byId: ReadonlyMap<string, WireNode>, viewId: string): string {
  const view = byId.get(viewId);
  const text = view?.text.trim() ?? "";
  if (text !== "") return text;
  const option = viewOptionOf(view);
  return (option === null ? undefined : byId.get(option)?.text) ?? viewId;
}

/**
 * "Make default view" for the target (DESIGN.md → View nodes): on a host, a
 * row for each view it names after its default; on a view node, a row for
 * each host that names it after another view. Each moves the view first in
 * that host's `sys.f.views`.
 */
function defaultViewCommands(ctx: CommandContext): readonly Command[] {
  const targetId = ctx.target.nodeId;
  if (targetId === null) return [];
  const wires = ctx.outline.wireNodes;
  const byId = new Map(wires.map((n) => [n.id, n]));
  const target = byId.get(targetId);
  const ofHost = hostViewIds(target)
    .slice(1)
    .map((viewId) => ({
      hostId: targetId,
      viewId,
      label: `Make default view: ${viewLabel(byId, viewId)}`,
    }));
  const ofView = isViewNode(target)
    ? wires
        .filter((host) => hostViewIds(host).indexOf(targetId) > 0)
        .map((host) => ({
          hostId: host.id,
          viewId: targetId,
          label: `Make default view of ${host.text.trim() || host.id}`,
        }))
    : [];
  return [...ofHost, ...ofView].map(
    ({ hostId, viewId, label }): Command => ({
      id: `make-default-view:${hostId}:${viewId}`,
      scope: "node",
      chrome: () => ({ label, icon: <StarIcon size={14} /> }),
      run: async (c) => {
        c.palette.close();
        await mutations.makeDefaultView(hostId, viewId);
      },
    }),
  );
}

/** Every command, in order: the static ones, with the views' where they sit. */
function commandsFor(ctx: CommandContext): readonly Command[] {
  const views = frameViewCommands(ctx);
  return [
    ...GLOBAL_COMMANDS,
    ...views.global,
    ...NODE_COMMANDS,
    ...views.node,
    ...defaultViewCommands(ctx),
    ...currentContributions(CommandPoint).map(({ value }) => value),
    ...NODE_COMMANDS_AFTER_VIEWS,
  ];
}

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
  return commandsFor(ctx)
    .filter((command) => command.scope === "node" && (command.when?.(ctx) ?? true))
    .map((command) => {
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
  const command = commandsFor(ctx).find((c) => c.id === commandId);
  if (command === undefined) {
    toast(`Unknown command: ${commandId}`);
    return;
  }
  await command.run(ctx);
}
