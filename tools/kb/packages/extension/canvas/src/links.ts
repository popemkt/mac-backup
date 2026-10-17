/**
 * Where an item leads when it is followed (`CanvasItemLink`): how a link is
 * read and written on any item.
 */
import type { CanvasNode } from "./doc.ts";
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
