// Linked items, the shared drawing: the scope tabs and one row, the same in the Canvases panel and the kb
// canvases panel (see rows.ts). React only, so it bundles into either plugin; navigation and opening are the
// caller's, passed in.
import type { KeyboardEvent } from "react";
import { SCOPE_LABELS, SCOPES, onlyClaimed, threadIds, timeLabel, type LinkRow, type Scope } from "./rows";

const cls = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export function ScopeTabs({ current, onSelect }: { current: Scope; onSelect: (s: Scope) => void }) {
  return (
    <div className="flex flex-1 items-center gap-0.5 rounded-lg bg-muted/50 p-0.5" role="toolbar" aria-label="Scope">
      {SCOPES.map(scope => (
        <button
          key={scope}
          type="button"
          aria-pressed={scope === current}
          onClick={() => onSelect(scope)}
          className={cls(
            "flex-1 cursor-pointer rounded-md px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            scope === current ? "bg-state-active text-foreground" : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
          )}
        >
          {SCOPE_LABELS[scope]}
        </button>
      ))}
    </div>
  );
}

function ThreadChip({
  id,
  title,
  isCurrent,
  claimed,
  onThread,
}: {
  id: string;
  title: string | null | undefined;
  isCurrent: boolean;
  claimed: boolean;
  onThread: (id: string) => void;
}) {
  const name = title ?? id;
  // A claimed link rests on a label the thread's own writes carried, which nothing checks.
  const claim = claimed ? " · claimed by the thread's own label, not checked" : "";
  return (
    <button
      type="button"
      title={isCurrent ? `${id}${claim}` : `Go to ${name}${claim}`}
      disabled={isCurrent}
      onClick={event => {
        event.stopPropagation();
        onThread(id);
      }}
      className={cls(
        "max-w-40 truncate rounded border px-1.5 py-px text-[11px] leading-4",
        claimed ? "border-dashed border-border" : "border-border",
        isCurrent ? "text-muted-foreground" : "cursor-pointer text-foreground hover:bg-state-hover",
      )}
    >
      {isCurrent ? "this thread" : name}
    </button>
  );
}

export function LinkedRow({
  row,
  scope,
  threadId,
  titles,
  now,
  onOpen,
  onThread,
}: {
  row: LinkRow;
  scope: Scope;
  threadId: string;
  titles: Readonly<Record<string, string | null>>;
  now: number;
  onOpen: (row: LinkRow) => void;
  onThread: (id: string) => void;
}) {
  const ids = threadIds(row);
  const claimedBy = (id: string) => onlyClaimed(row, id);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(row);
    }
  };
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(row)}
        onKeyDown={onKeyDown}
        title={row.title}
        className="group cursor-pointer space-y-1 rounded-md px-2 py-1.5 hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span aria-label={row.open ?? undefined} className={cls("size-2 shrink-0 rounded-full", row.open !== null ? "bg-success" : "bg-transparent")} />
          <span className={cls("min-w-0 flex-1 truncate text-sm", row.gone !== null && "text-muted-foreground line-through")}>{row.name}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{timeLabel(row, now)}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 pl-4 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{row.where}</span>
          {row.notes.map(note => (
            <span key={note} className="shrink-0">
              · {note}
            </span>
          ))}
          {row.gone !== null ? <span className="shrink-0 text-warning">{row.gone}</span> : null}
        </div>
        {scope !== "session" && (ids.length > 0 || row.tags.length > 0) ? (
          <div className="flex flex-wrap items-center gap-1 pl-4">
            {ids.slice(0, 3).map(id => (
              <ThreadChip key={id} id={id} title={titles[id]} isCurrent={id === threadId} claimed={claimedBy(id)} onThread={onThread} />
            ))}
            {ids.length > 3 ? <span className="text-[11px] text-muted-foreground">+{ids.length - 3} threads</span> : null}
            {row.tags.map(tag => (
              <span key={tag} className="rounded bg-muted px-1.5 py-px text-[11px] leading-4 text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}
