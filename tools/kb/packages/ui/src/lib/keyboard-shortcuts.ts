/** Global keyboard shortcut dispatch (DESIGN-RESKIN W8 feel). */
export type GlobalShortcutAction = "global-search" | "node-palette";

export function matchGlobalShortcut(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  key: string;
}): GlobalShortcutAction | null {
  if (!e.metaKey && !e.ctrlKey) return null;
  const key = e.key.toLowerCase();
  // ⌘K opens node palette when a row is selected/active, otherwise global search.
  // Callers discriminate on outline active/selected state; this helper just names the key.
  // For now return "node-palette" when the caller has a selection — but we keep the
  // raw discriminant here so App can branch (r9 F15).
  if (key === "k") return "global-search";
  return null;
}
