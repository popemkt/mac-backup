/**
 * What the UI adds to a view's key (`@kb/views`): how a picker names it, and
 * the slot chain a nested view is checked against. Nothing here knows the
 * plugin kernel, React or a store. How views are contributed and rendered is
 * `lib/plugins.ts`; the contract of both is stated once, in DESIGN-UI.md → UI
 * points: routes and views.
 */
import type { Icon, IconWeight } from "@phosphor-icons/react";
import type { ViewKey } from "@kb/views";

/**
 * How a picker names a view of a family: part of the view's contribution, not
 * of its key, because it is presentation. `order` is where it sits among its
 * family (lower first); `glyph` is the toolbar's text mark, `icon` the menu's,
 * and `command` the `sys.command` node that switches to it, where the family
 * has those.
 */
export interface ViewPicker {
  readonly label: string;
  readonly order: number;
  readonly glyph?: string;
  readonly icon?: Icon;
  readonly iconWeight?: IconWeight;
  readonly command?: string;
}

/** One view of a family as a picker lists it: its key, and how it is named. */
export interface FamilyView<K extends ViewKey<unknown>> {
  readonly key: K;
  readonly picker: ViewPicker;
}

/**
 * The slots around a point of the tree, outermost first: each one's view and
 * the subject it shows it for (`slotLink`). A slot renders its view only when
 * {@link slotRenders} says so; the keyboard walk asks the same question of the
 * chain it walks, so it never offers a row a slot refused to render.
 */
export type SlotChain = readonly string[];

/**
 * How deep slots may nest at all: a safety net against runaway nesting of
 * ever-new subjects, since a repeat is caught exactly. The chain above a
 * frame's rows is the shell's page, an ontology, its outline and the root
 * frame's view (four), then one slot per frame the outline nests below the
 * root, and one more for a projected view at the bottom. This repo's deepest outline nests four
 * frames, so a chain of nine; 32 leaves room for an outline 27 frames deep.
 */
export const MAX_VIEW_DEPTH = 32;

/** One link of a slot chain: a view, and what it is shown for. */
export function slotLink(key: ViewKey<unknown>, subject: string | undefined): string {
  return subject === undefined ? key.id : `${key.id}:${subject}`;
}

/**
 * Whether a slot for `link` renders inside `chain`: not when a slot around it
 * already shows the same view for the same subject (a cycle, however many
 * other views lie between), and not past {@link MAX_VIEW_DEPTH}.
 */
export function slotRenders(chain: SlotChain, link: string): boolean {
  return chain.length < MAX_VIEW_DEPTH && !chain.includes(link);
}
