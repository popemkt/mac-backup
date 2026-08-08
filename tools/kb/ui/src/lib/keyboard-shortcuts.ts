/** Global keyboard shortcut dispatch (DESIGN-RESKIN W8 feel). */
export type GlobalShortcutAction = "node-palette" | "global-search";

export function matchGlobalShortcut(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  key: string;
}): GlobalShortcutAction | null {
  if (!e.metaKey && !e.ctrlKey) return null;
  const key = e.key.toLowerCase();
  if (key === "k") return "node-palette";
  if (key === "s") return "global-search";
  return null;
}
