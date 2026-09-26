/** Global keyboard shortcut dispatch (DESIGN-RESKIN W8 feel). */
export type GlobalShortcutAction = "global-search" | "node-palette";

/**
 * The global action a key chord means, or null to leave it to the page.
 *
 * ⌘/Ctrl-K is one key with two meanings, and which one is decided here, not
 * at the call site: with an outline row to anchor to (selected or being
 * edited) it opens that node's palette, otherwise the global search. ⌘S is
 * deliberately left to the browser — kb has no save action to bind it to.
 */
export function matchGlobalShortcut(
  e: { metaKey: boolean; ctrlKey: boolean; key: string },
  context: { rowAnchored: boolean },
): GlobalShortcutAction | null {
  if (!e.metaKey && !e.ctrlKey) return null;
  if (e.key.toLowerCase() !== "k") return null;
  return context.rowAnchored ? "node-palette" : "global-search";
}
