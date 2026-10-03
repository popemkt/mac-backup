/**
 * The view catalog as a point (DESIGN.md → Extension families → the view
 * catalog is a point): each plugin that provides a view contributes its
 * {@link ViewDef} to {@link ViewKeyPoint} under the view's id, and the
 * {@link ViewCatalog} service is the one reading of what was contributed.
 * The server provides it from its registry's kernel; the page derives it from
 * `kb.manifest.views`, so both list only what the server loaded.
 */
import { Context, type Effect } from "effect";
import type { KbNode } from "@kb/model";
import { Point } from "@kb/plugin";
import type { ViewCatalogOf, ViewKey } from "@kb/views";
import type { KbContext } from "./session.ts";

/**
 * How a view says itself on a surface that shows text (DESIGN.md → Extension
 * families → a view's text is part of its contribution), from the settings
 * its key read for the node it is shown for. A view without one is shown as
 * its settings and its subject, the generic body.
 */
export interface ViewText<P> {
  /** The markdown lines under the view's heading. */
  body(ctx: KbContext, params: P, host: KbNode | null): readonly string[];
  /** Html a page draws above the text (a chart's SVG); null when there is nothing to draw. */
  figure?(ctx: KbContext, params: P, host: KbNode | null): Effect.Effect<string | null>;
}

/** One view a family provides: its key, which names its option in the seed, and its text. */
export interface ViewDef<P> {
  readonly key: ViewKey<P>;
  readonly text?: ViewText<P>;
}

/** A view's contribution: its key, and the text that reads that key's params. */
export function viewDef<P>(key: ViewKey<P>, text?: ViewText<P>): ViewDef<P> {
  return text === undefined ? { key } : { key, text };
}

/** Every view a loaded plugin provides, by view id. */
export const ViewKeyPoint = Point<ViewDef<unknown>>()("kb.views");

/** The views the host's loaded plugins provide: what `view.propose`, `render.view` and `kb.manifest` read. */
export class ViewCatalog extends Context.Service<ViewCatalog, ViewCatalogOf<ViewDef<unknown>>>()(
  "kb/ViewCatalog",
) {}
