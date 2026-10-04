/** A frame's name as the canvas shows it: its label, or `fallback` when it has none. */
export function frameName(
  frame: { readonly id: string; readonly label?: string } | undefined,
  fallback: string,
): string {
  const label = frame?.label;
  return label !== undefined && label.trim() !== "" ? label : fallback;
}
