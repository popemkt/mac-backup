/**
 * The inspector's link row: where the item leads when followed (`link`),
 * written as text and committed as one change — a web address, a node by
 * its reference (`[[id]]`, or a bare id), an item on it after `#`, or an
 * item on this canvas as `#item` — with where it leads said beneath, and
 * the follow (⌘↵) and clear buttons.
 */
import { useState } from "react";
import { withLink, type CanvasItemLink, type CanvasNode, type CanvasWorld } from "@kb/canvas";
import { linkOfText, textOfLink } from "./item-link-text";
import type { CanvasPageTab } from "./canvas-page-strip";

/** Where `link` leads, in words. */
function leadsTo(link: CanvasItemLink, world: CanvasWorld): string {
  if ("url" in link) return `Opens ${link.url}`;
  const item = link.item === undefined ? "" : `, at ${link.item}`;
  if (!("node" in link)) return `Shows ${link.item} on this canvas`;
  const text = world.textOf(link.node);
  return text === undefined
    ? `Leads to ${link.node}, which is gone`
    : `Opens ${text || "∅"}${item}`;
}

export function LinkRow({
  item,
  world,
  pages,
  onChange,
  onFollow,
}: {
  item: CanvasNode;
  world: CanvasWorld;
  /** The board's other pages: a link to one is a pick, not typed. */
  pages: readonly CanvasPageTab[];
  onChange: (item: CanvasNode) => void;
  onFollow: (link: CanvasItemLink) => void;
}) {
  // A new link from outside remounts the row (its `key`), so the draft starts from it.
  const [draft, setDraft] = useState(textOfLink(item.link));
  const [unread, setUnread] = useState(false);
  const commit = () => {
    const link = linkOfText(draft);
    setUnread(link === null);
    if (link === null || textOfLink(link) === textOfLink(item.link)) return;
    onChange(withLink(item, link));
  };
  return (
    <div className="flex flex-col gap-1 px-1.5 pb-1.5">
      <label
        className="flex flex-col gap-0.5"
        title="A web address, [[a node]], [[a canvas]]#item, or #item here"
      >
        <span className="text-meta text-foreground/50">Link</span>
        <input
          aria-label="Link"
          placeholder="https://…, [[node]] or #item"
          aria-invalid={unread}
          className="h-7 w-full rounded-md border border-foreground/10 bg-background px-2 text-ui text-foreground/85 outline-none focus:border-primary/50 aria-[invalid=true]:border-destructive/60"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              e.stopPropagation();
              setDraft(textOfLink(item.link));
              setUnread(false);
            }
          }}
        />
      </label>
      {pages.length > 0 && (
        <select
          aria-label="Link to a page"
          className="h-7 rounded-md border border-foreground/10 bg-background px-1.5 text-label text-foreground/70"
          value=""
          onChange={(e) => {
            if (e.target.value !== "") onChange(withLink(item, { node: e.target.value }));
          }}
        >
          <option value="">Link to a page…</option>
          {pages.map((page) => (
            <option key={page.id} value={page.id}>
              {page.label}
            </option>
          ))}
        </select>
      )}
      {item.link !== undefined && (
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-label text-foreground/45">
            {leadsTo(item.link, world)}
          </span>
          <span className="flex shrink-0 gap-1">
            <button
              type="button"
              className="rounded-md px-1.5 py-0.5 text-label text-foreground/55 hover:bg-foreground/5 hover:text-foreground/85"
              title="Follow (⌘↵)"
              onClick={() => item.link !== undefined && onFollow(item.link)}
            >
              Follow
            </button>
            <button
              type="button"
              className="rounded-md px-1.5 py-0.5 text-label text-foreground/55 hover:bg-foreground/5 hover:text-foreground/85"
              onClick={() => onChange(withLink(item, undefined))}
            >
              Clear
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
