import type { NodeId } from "./model.ts";

/**
 * The reference token in text: `[[node-id|label]]` or bare `[[node-id]]`.
 * This module is the one statement of its grammar: a reader of tokens scans
 * with it, so a token one reader sees is a token every reader sees.
 *
 * The `[[` completion scan in `@kb/ui-sdk`'s `lib/refs.ts` is a different
 * concept and does not belong here: it looks for an *open* token — a `[[`
 * the person is still typing, with no `]]` yet — which this grammar by
 * definition never matches.
 *
 * The id group excludes `[` as well as `]`/`|`: a real id is ULID/`sys.*`
 * shaped and never contains one, and excluding it lets the scan re-sync to a
 * genuine `[[id]]` marker after a stray extra `[` in surrounding prose (e.g.
 * `[[[id]]`) instead of swallowing that `[` into the captured id.
 */
const MENTION_RE = /\[\[([^[\]|]+)(?:\|([^\]]*))?\]\]/g;

/** One token as it sits in a text: its span, its target and its label. */
export interface MentionSpan {
  /** Index of the first `[`. */
  start: number;
  /** Index just past the closing `]]`. */
  end: number;
  /** The target as written, surrounding whitespace trimmed. */
  id: NodeId;
  /** The text after `|`; `undefined` for a bare `[[id]]`. */
  label: string | undefined;
}

/** Every token in `text`, in order, with repeats. */
export function mentionSpans(text: string): MentionSpan[] {
  const out: MentionSpan[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    const raw = m[1] ?? "";
    out.push({ start: m.index, end: m.index + m[0].length, id: raw.trim(), label: m[2] });
  }
  return out;
}

/** The ids `text` mentions, in order, with repeats. */
export function extractMentions(text: string): NodeId[] {
  return mentionSpans(text).map((span) => span.id);
}

/** `text` with each token replaced by what `replace` makes of it. */
export function replaceMentions(text: string, replace: (span: MentionSpan) => string): string {
  let out = "";
  let at = 0;
  for (const span of mentionSpans(text)) {
    out += text.slice(at, span.start) + replace(span);
    at = span.end;
  }
  return out + text.slice(at);
}
