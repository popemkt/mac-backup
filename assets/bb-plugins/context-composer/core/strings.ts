// Text that came from an inventory (artifact names, descriptions, paths) is untrusted: a name with a newline must not
// start a new line in a system prompt, an outline or a table. Every place that embeds such text goes through here.

/** Whitespace runs, newlines included, collapsed to one space. */
export const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/** At most `n` characters, with an ellipsis when cut. */
export const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

/** An inventory string made safe to embed in one line of generated text. */
export const inline = (s: string, n = 120): string => clip(oneLine(s), n);
