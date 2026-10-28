// Linked items, the shared drawing: the scope tabs and one selectable row, the same in the Canvases panel and the
// kb canvases panel (see rows.ts; panel.tsx puts them together). React only, so it bundles into either plugin;
// selection and navigation are the caller's, passed in.
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

/** The row's checkbox: drawn here, since the plugins' own controls do not resolve in this folder. */
function Check({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cls(
        "flex size-4 shrink-0 items-center justify-center rounded border",
        checked ? "border-foreground bg-foreground text-background" : "border-muted-foreground",
      )}
    >
      {checked ? (
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2.5 6.5 5 9l4.5-6" />
        </svg>
      ) : null}
    </span>
  );
}

export function LinkedRow({
  row,
  chips,
  threadId,
  titles,
  now,
  selected,
  onToggle,
  onThread,
}: {
  row: LinkRow;
  /** Show the threads that link it (Project, All, and search beyond the scope). */
  chips: boolean;
  threadId: string;
  titles: Readonly<Record<string, string | null>>;
  now: number;
  selected: boolean;
  onToggle: (row: LinkRow) => void;
  onThread: (id: string) => void;
}) {
  const ids = threadIds(row);
  const claimedBy = (id: string) => onlyClaimed(row, id);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggle(row);
    }
  };
  return (
    <li>
      <div
        role="checkbox"
        aria-checked={selected}
        tabIndex={0}
        onClick={() => onToggle(row)}
        onKeyDown={onKeyDown}
        title={row.title}
        className={cls(
          "group cursor-pointer space-y-1 rounded-md px-2 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          selected ? "bg-state-active" : "hover:bg-state-hover",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Check checked={selected} />
          <span className={cls("min-w-0 flex-1 truncate text-sm", row.gone !== null && "text-muted-foreground line-through")}>{row.name}</span>
          {row.open !== null ? <span aria-label={row.open} title={row.open} className="size-2 shrink-0 rounded-full bg-success" /> : null}
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{timeLabel(row, now)}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 pl-6 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{row.where}</span>
          {row.notes.map(note => (
            <span key={note} className="shrink-0">
              · {note}
            </span>
          ))}
          {row.gone !== null ? <span className="shrink-0 text-warning">{row.gone}</span> : null}
        </div>
        {chips && (ids.length > 0 || row.tags.length > 0) ? (
          <div className="flex flex-wrap items-center gap-1 pl-6">
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
