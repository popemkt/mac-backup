/** Global keyboard shortcut dispatch (DESIGN-RESKIN W8 feel). */
export type GlobalShortcutAction = "global-search";

export function matchGlobalShortcut(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  key: string;
}): GlobalShortcutAction | null {
  if (!e.metaKey && !e.ctrlKey) return null;
  const key = e.key.toLowerCase();
  // ⌘K is the app-wide search/open surface. Do not capture ⌘S: browsers and
  // native shells reserve it for save, and kb has no corresponding action.
  if (key === "k") return "global-search";
  return null;
}
