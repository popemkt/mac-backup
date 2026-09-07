import { parseInlineMd } from "./md-inline";
export const GRAPH_LABEL_FONT = "Outfit Variable, ui-sans-serif, system-ui, sans-serif";
export const GRAPH_LABEL_WIDTH = 220;

/** Text space is measured in screen pixels, independently of node importance. */
export function fitGraphLabel(
  label: string,
  measure: (text: string) => number,
  maxWidth = GRAPH_LABEL_WIDTH,
): string {
  const line = label.replace(/\s+/g, " ").trim() || "untitled";
  if (measure(line) <= maxWidth) return line;
  const chars = Array.from(line);
  let low = 0,
    high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(chars.slice(0, mid).join("") + "…") <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return chars.slice(0, low).join("") + "…";
}

/** Wrap tree text into measured columns; long words split without losing text. */
export function wrapGraphLabel(
  label: string,
  measure: (text: string) => number,
  maxWidth = GRAPH_LABEL_WIDTH,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const char of Array.from(label.replace(/\s+/g, " ").trim() || "untitled")) {
    if (line && measure(line + char) > maxWidth) {
      const space = line.lastIndexOf(" ");
      if (space > 0) {
        lines.push(line.slice(0, space));
        line = line.slice(space + 1) + char;
      } else {
        lines.push(line);
        line = char;
      }
    } else line += char;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

/** Project existing rich node text into a readable graph label using the shared parser. */
export function graphDisplayText(
  text: string,
  resolve: (id: string) => string | undefined = () => undefined,
  seen = new Set<string>(),
): string {
  return (
    parseInlineMd(text)
      .map((segment) => {
        if (segment.t === "ref") {
          if (segment.label !== segment.id) return segment.label;
          const target = resolve(segment.id);
          if (target === undefined || target.length === 0 || seen.has(segment.id))
            return "Untitled";
          return graphDisplayText(target, resolve, new Set([...seen, segment.id]));
        }
        if (segment.t === "link") return segment.label;
        if (segment.t === "media") return segment.alt || segment.kind;
        return segment.v;
      })
      .join("")
      .trim() || "Untitled"
  );
}
