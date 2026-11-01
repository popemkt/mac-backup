// The concierge conversation's own record: final transcript lines in the plugin's storage, bounded.

export interface TranscriptLine {
  at: number;
  /** "user", "assistant" or "system". */
  role: string;
  text: string;
}

/** Lines kept; one kv value holds them (bb caps a value at 256 KB). */
export const MAX_LINES = 400;
const MAX_TEXT = 2_000;

/** Appends a line, merging an exact repeat of the previous one (Codex can report a user turn twice). */
export function appendLine(lines: TranscriptLine[], next: TranscriptLine, max = MAX_LINES): TranscriptLine[] {
  const text = next.text.length > MAX_TEXT ? `${next.text.slice(0, MAX_TEXT - 1)}…` : next.text;
  const last = lines.at(-1);
  if (last !== undefined && last.role === next.role && last.text === text && next.at - last.at < 10_000) return lines;
  const out = [...lines, { ...next, text }];
  return out.length > max ? out.slice(out.length - max) : out;
}
