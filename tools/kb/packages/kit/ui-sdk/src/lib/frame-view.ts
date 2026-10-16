/**
 * A frame's view, read from the graph: the view node a frame shows its
 * children through, the settings that node holds, and which of the frame
 * views provided it names. The page's writes read a frame's settings
 * through it (`frameConfigOf`), and the frame views lay the frame out by
 * what it resolves.
 */
import { Result } from "effect";
import { familyViewIdOf, viewOptionId, viewOptionOf, type NodeProps } from "@kb/model";
import {
  decodeFrameConfig,
  FRAME_VIEW_FAMILY,
  type FrameViewKey,
  type FrameViewParams,
  paramsFromProps,
  type ViewConfig,
} from "@kb/views";
import { logWarn } from "./log";
import type { OutlineNode } from "./types";
import type { SchemaIndex } from "./schema";
import { viewKeyOfNode } from "./view-node";

/**
 * A view frame's configuration (`@kb/views`' `decodeFrameConfig`), with what
 * it had to ignore reported through the ui log seam.
 */
export function getViewConfig(props?: NodeProps): ViewConfig {
  return decodeFrameConfig(props, frameReport);
}

/** Where a frame setting the UI had to ignore goes: the log. */
export function frameReport(warning: string): void {
  logWarn(`[view-config] ${warning}`);
}

/** A frame's view, resolved: which one, and the settings it renders from. */
export interface FrameView {
  readonly key: FrameViewKey;
  readonly params: FrameViewParams;
}

/** A node as the frame-view readers need it: its id and props. */
interface ViewCarrier {
  readonly id: string;
  readonly props: NodeProps;
}

/**
 * The view node a frame shows its children through: the first view node its
 * `sys.f.views` names whose view is a frame view (`familyViewIdOf`, DESIGN.md
 * → View nodes). That is its default unless it names another kind of view
 * first (a snippet, a neighbourhood), which a frame edit never rewrites. Null
 * when it names none.
 *
 * This is the one test of what a frame's view node is, so every reader (the
 * frame's slot, its walk, its toolbar, its writes) agrees: a node that names
 * no view (no `sys.f.view`), or names a view no option node in the graph says
 * is a frame view, is not one, and a frame that names only such nodes has no
 * frame view node.
 *
 * It is read from the schema, the whole graph: how a frame is shown is what
 * its content means, not content an ontology scope chooses, so a frame in a
 * scope keeps a view node that is no member of it.
 */
export function frameViewNodeOf(
  frame: { readonly props: NodeProps } | undefined,
  schema: SchemaIndex,
): OutlineNode | null {
  const id = familyViewIdOf(frame, FRAME_VIEW_FAMILY, (node) => schema.get(node));
  return (id === null ? undefined : schema.get(id)) ?? null;
}

/** Every frame setting a frame's view node holds, decoded (the defaults when it has none). */
export function frameConfigOf(
  frame: { readonly props: NodeProps } | undefined,
  schema: SchemaIndex,
): ViewConfig {
  return getViewConfig(frameViewNodeOf(frame, schema)?.props);
}

/** What a frame is shown as while its view node names no frame view: the list. */
const LIST_OPTION = viewOptionId("outline.list");

/**
 * The view a frame shows its children in, among the frame views provided
 * (`views`, as `ViewPoint` lists them), with the view node's props decoded
 * through that view's params for the frame, so it carries exactly the
 * settings the view reads. Two cases differ:
 *
 * - A frame with no frame view node ({@link frameViewNodeOf}: it names
 *   none, or only nodes that name no frame view) shows the list.
 * - A frame whose view node names a frame view that is not provided (its
 *   family switched off, or its plugin not loaded) resolves to null: the
 *   frame shows that it cannot be shown here, and offers no rows, rather
 *   than another view.
 *
 * Null too while not even the list is provided.
 */
export function frameViewOf(
  frame: ViewCarrier | undefined,
  schema: SchemaIndex,
  views: readonly FrameViewKey[],
): FrameView | null {
  return frameViewThrough(frame, frameViewNodeOf(frame, schema), views);
}

/** {@link frameViewOf}, given the frame's view node ({@link frameViewNodeOf}) already looked up. */
export function frameViewThrough(
  frame: ViewCarrier | undefined,
  node: ViewCarrier | null,
  views: readonly FrameViewKey[],
): FrameView | null {
  const asked = viewKeyOfNode(node ?? undefined, views);
  if (node !== null && asked === null) {
    logWarn(`[view-config] ${node.id}: ${viewOptionOf(node)} is no frame view provided here`);
    return null;
  }
  const key = asked ?? views.find((view) => view.option === LIST_OPTION);
  if (key === undefined) return null;
  const params = paramsFromProps(key, node?.props ?? {}, frame?.id ?? null, frameReport);
  if (Result.isSuccess(params)) return { key, params: params.success };
  // Unreachable while every setting is decoded by the schema the params are made of.
  logWarn(`[view-config] ${key.id} cannot read this frame: ${params.failure}`);
  return null;
}

/**
 * The label of the view a frame's view node names, read from that view's
 * option node, which the seed names every view by whether or not its plugin
 * is loaded: how a frame says which view it cannot show here. Null when the
 * node names no option the graph holds.
 */
export function frameViewLabelOf(
  node: ViewCarrier | undefined,
  schema: SchemaIndex,
): string | null {
  const option = viewOptionOf(node);
  return (option === null ? undefined : schema.get(option)?.text) ?? null;
}
