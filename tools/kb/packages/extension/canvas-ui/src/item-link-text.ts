/**
 * A link as the inspector's link row writes it (`item-link-row.tsx`): a web
 * address, a node by its reference (`[[id]]`, or a bare id), an item on it
 * after `#`, or an item on this canvas as `#item`.
 */
import { isLinkUrl, type CanvasItemLink } from "@kb/canvas";
import { extractMentions } from "@kb/model";

/** A node as the row takes it: one `[[id]]` token, or a bare id. */
function nodeOfText(text: string): string | undefined {
  const [token, ...more] = extractMentions(text);
  if (token !== undefined)
    return more.length === 0 && text.startsWith("[[") && text.endsWith("]]") ? token : undefined;
  return /^[^\s#[\]]+$/.test(text) ? text : undefined;
}

/**
 * The link `text` writes: undefined for none (the row emptied), null for
 * text that is no link.
 */
export function linkOfText(raw: string): CanvasItemLink | undefined | null {
  const text = raw.trim();
  if (text === "") return undefined;
  if (isLinkUrl(text)) return { url: text };
  // An address of another scheme is no link (`isLinkUrl`), never a node of that name.
  if (URL.canParse(text)) return null;
  const hash = text.lastIndexOf("#");
  const [head, tail] = hash < 0 ? [text, undefined] : [text.slice(0, hash), text.slice(hash + 1)];
  if (tail === "") return null;
  if (head === "") return tail === undefined ? null : { item: tail };
  const node = nodeOfText(head);
  if (node === undefined) return null;
  return tail === undefined ? { node } : { node, item: tail };
}

/** `link` as the row writes it, which {@link linkOfText} reads back. */
export function textOfLink(link: CanvasItemLink | undefined): string {
  if (link === undefined) return "";
  if ("url" in link) return link.url;
  const item = link.item === undefined ? "" : `#${link.item}`;
  return "node" in link ? `[[${link.node}]]${item}` : item;
}
