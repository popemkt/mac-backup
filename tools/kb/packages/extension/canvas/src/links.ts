/**
 * Where an item leads when it is followed (`CanvasItemLink`): how a link is
 * read and written on any item, and the link item, a card for a web page
 * (`CanvasLinkNode`), whose address is where it leads.
 */
import type { CanvasNode, CanvasNodeBase } from "./doc.ts";
import { dropExtra } from "./extra.ts";
import { isRecord } from "./fields.ts";

/**
 * Where an item leads when it is followed: a web address (`url`), or a
 * place in kb — a node (a canvas, so a page, or any other node) and an item
 * on that canvas to show; with no `node`, an item on this canvas. A link to
 * a node is a reference (`./references.ts`).
 */
export type CanvasItemLink =
  | { readonly url: string }
  | { readonly node: string; readonly item?: string }
  | { readonly item: string };

/** The schemes a link's web address may have: a page or a mail, never script or data. */
const LINK_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:", "mailto:"]);

/** Whether `raw` is a web address a link may lead to (`LINK_SCHEMES`). */
export function isLinkUrl(raw: string): boolean {
  return URL.canParse(raw) && LINK_SCHEMES.has(new URL(raw).protocol);
}

/** A non-empty id, or undefined. */
const anId = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

/** A link as written: a web address alone, or a node, an item or both, each a non-empty id. */
export function parseItemLink(raw: unknown): CanvasItemLink | undefined {
  if (!isRecord(raw)) return undefined;
  const keys = Object.keys(raw);
  if (keys.length === 1 && typeof raw.url === "string") {
    return isLinkUrl(raw.url) ? { url: raw.url } : undefined;
  }
  if (keys.length === 0 || keys.some((key) => key !== "node" && key !== "item")) return undefined;
  const [node, item] = [anId(raw.node), anId(raw.item)];
  if (
    (raw.node !== undefined && node === undefined) ||
    (raw.item !== undefined && item === undefined)
  )
    return undefined;
  if (node !== undefined) return item === undefined ? { node } : { node, item };
  return item === undefined ? undefined : { item };
}

/**
 * `node` leading where `link` says, or nowhere when it is undefined. A link
 * set here supersedes one this version could not read.
 */
export function withLink<N extends CanvasNode>(node: N, link: CanvasItemLink | undefined): N {
  const next = { ...node };
  if (link === undefined) delete next.link;
  else next.link = link;
  return dropExtra(next, "link");
}

/**
 * A JSON Canvas link item: a card for the web page at `url`, named from the
 * address alone (`linkCard`, `./links.ts`) and followed to it. kb never
 * fetches the page to unfurl it.
 */
export interface CanvasLinkNode extends CanvasNodeBase {
  type: "link";
  url: string;
}

export function isLinkNode(n: CanvasNode): n is CanvasLinkNode {
  return n.type === "link" && "url" in n;
}

/**
 * Where `item` leads when it is followed: its own link, or a link item's
 * page. A link item's address and any item's link are one answer, read
 * here, so following, linting and the inspector never ask which.
 */
export function itemLead(item: CanvasNode): CanvasItemLink | undefined {
  if (item.link !== undefined) return item.link;
  return isLinkNode(item) && isLinkUrl(item.url) ? { url: item.url } : undefined;
}

/** What a link card says of its page: a title, and the host it is on. */
export interface CanvasLinkCard {
  readonly title: string;
  readonly host: string;
}

/** The endings a page's last path segment drops when it names the card. */
const PAGE_ENDING = /\.(?:html?|php|aspx?)$/i;

/**
 * What the card for `url` says, from the address alone (kb never fetches
 * the page): its last path segment as words (`kb-canvas-tldraw-parity` →
 * "kb canvas tldraw parity"), or the host when the path names nothing; a
 * mail address is its own title. An address that does not parse is shown
 * as written, with no host.
 */
export function linkCard(url: string): CanvasLinkCard {
  if (!URL.canParse(url)) return { title: url, host: "" };
  const parsed = new URL(url);
  if (parsed.protocol === "mailto:") return { title: decodeSafely(parsed.pathname), host: "mail" };
  const host = parsed.hostname.replace(/^www\./, "");
  const segment = parsed.pathname.split("/").findLast((part) => part !== "") ?? "";
  const words = decodeSafely(segment)
    .replace(PAGE_ENDING, "")
    .replaceAll(/[-_+]+/g, " ")
    .trim();
  return { title: words === "" ? host : words, host };
}

/** `text` with its percent-escapes read, or as written when they do not read. */
function decodeSafely(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
