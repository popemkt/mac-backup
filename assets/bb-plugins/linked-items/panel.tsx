// Linked items, the whole panel: scope tabs, a search over every item (linked or not), rows to select, and the
// actions on a selection (Link to this thread, Unlink, Open). One shell for the Canvases panel (canvas-links) and
// the kb canvases panel (kb): each plugin hands in its data source and actions, and its own Button, Input and
// Icon, which resolve only inside a plugin's root (their "@/…" and SDK imports do not from this folder).
// GAP [[01M5QJFW217ZNBXHEX74VG7VYP]]: bb's build makes a plugin's Tailwind classes from its own folder only, so a
// class used only here (and in row.tsx) must be one bb's own stylesheet already has.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, KeyboardEvent, ReactNode, Ref } from "react";
import { LinkedRow, ScopeTabs } from "./row";
import { searchSections, targets, type Action, type LinkRow, type Scope } from "./rows";

/** One read of a source: its rows, the titles of the threads they link to, and why it may be wrong or empty. */
export type Listed = {
  rows: LinkRow[];
  titles: Readonly<Record<string, string | null>>;
  error: string | null;
  /** A line under the list ("central log unreachable", "may be incomplete", …); for `available`, shown in search. */
  note: ReactNode;
};

export type Outcome = { ok: boolean; message: string };

/** What a plugin supplies: where its rows come from, and what each action does to the rows it applies to. */
export type LinkedSource = {
  /** The rows a scope shows for the thread. */
  list(scope: Scope): Promise<Listed>;
  /** Every item one could link, linked or not: what search looks through beyond the scope. */
  available(): Promise<Listed>;
  /** Run an action on the rows `targets` chose for it. */
  run(action: Action, rows: LinkRow[]): Promise<Outcome>;
};

/** The plugin's own controls, as far as the panel uses them. */
export type PanelUi = {
  Button: ComponentType<{
    variant?: "outline" | "ghost" | "default";
    size?: "sm" | "icon";
    className?: string;
    disabled?: boolean;
    onClick?: () => void;
    "aria-label"?: string;
    children?: ReactNode;
  }>;
  Input: ComponentType<{
    ref?: Ref<HTMLInputElement>;
    value: string;
    onChange: (event: { target: { value: string } }) => void;
    onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
    placeholder?: string;
    "aria-label"?: string;
    className?: string;
  }>;
  Icon: ComponentType<{ name: string; className?: string }>;
  notify: { success(message: string): void; error(message: string): void };
};

const cls = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const LINKED_HEADING: Record<Scope, string> = {
  session: "Linked to this thread",
  project: "Linked in this project",
  all: "Linked anywhere",
};

/** One source read, newest wins: a scope switch or refresh drops an answer still on its way. */
function useRead(read: (() => Promise<Listed>) | null) {
  const [answer, setAnswer] = useState<Listed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const load = useCallback(() => {
    if (read === null) return;
    const mine = ++generation.current;
    setLoading(true);
    read()
      .then(
        next => {
          if (mine !== generation.current) return;
          setAnswer(next);
          setError(next.error);
        },
        cause => mine === generation.current && setError(message(cause)),
      )
      .finally(() => mine === generation.current && setLoading(false));
  }, [read]);
  useEffect(() => {
    setAnswer(null);
    setError(null);
    load();
  }, [load]);
  return { answer, error, loading, refresh: load };
}

const ACTIONS: { action: Action; label: string; icon: string; variant: "default" | "outline" }[] = [
  { action: "link", label: "Link to this thread", icon: "Link", variant: "default" },
  { action: "unlink", label: "Unlink", icon: "Minus", variant: "outline" },
  { action: "open", label: "Open", icon: "ExternalLink", variant: "outline" },
];

export function LinkedItemsPanel({
  threadId,
  source,
  ui,
  noun,
  empty,
  openMany,
  onThread,
}: {
  threadId: string;
  source: LinkedSource;
  ui: PanelUi;
  /** How the panel names its items: { one: "canvas", many: "canvases" }. */
  noun: { one: string; many: string };
  /** What an empty scope says. */
  empty: Record<Scope, string>;
  /** Whether Open takes several rows at once (the kb tab shows one canvas at a time). */
  openMany: boolean;
  onThread: (id: string) => void;
}) {
  const { Button, Input, Icon, notify } = ui;
  const [scope, setScope] = useState<Scope>("session");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<Action | null>(null);
  const searching = query.trim() !== "";
  // Read every item only once someone searches; then keep it until a refresh or an action.
  const [wantAll, setWantAll] = useState(false);
  useEffect(() => {
    if (searching) setWantAll(true);
  }, [searching]);

  const listScope = useCallback(() => source.list(scope), [source, scope]);
  const listAll = useCallback(() => source.available(), [source]);
  const linked = useRead(listScope);
  const all = useRead(wantAll ? listAll : null);
  const search = useRef<HTMLInputElement>(null);
  const now = Date.now();

  const titles = useMemo(() => ({ ...all.answer?.titles, ...linked.answer?.titles }), [all.answer, linked.answer]);
  const sections = useMemo(
    () => searchSections(linked.answer?.rows ?? [], all.answer?.rows ?? [], query, titles),
    [linked.answer, all.answer, query, titles],
  );
  // Selected rows by key, from what is listed now: a selection outlives a search it was made in.
  const chosen = useMemo(() => {
    const known = new Map([...(all.answer?.rows ?? []), ...(linked.answer?.rows ?? [])].map(r => [r.key, r]));
    return [...selected].flatMap(key => known.get(key) ?? []);
  }, [selected, all.answer, linked.answer]);

  const refresh = () => {
    linked.refresh();
    all.refresh();
  };

  const toggle = (row: LinkRow) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (!next.delete(row.key)) next.add(row.key);
      return next;
    });

  const act = (action: Action) => {
    const rows = targets(action, chosen, threadId);
    if (rows.length === 0) return;
    setBusy(action);
    source
      .run(action, rows)
      .then(
        r => {
          if (!r.ok) {
            notify.error(r.message);
            return;
          }
          if (action !== "open") {
            notify.success(r.message);
            setSelected(new Set());
          }
          refresh();
        },
        cause => notify.error(message(cause)),
      )
      .finally(() => setBusy(null));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const isTyping = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if (event.key === "/" && !isTyping) {
      event.preventDefault();
      search.current?.focus();
    } else if (event.key === "Escape" && !isTyping && selected.size > 0) {
      event.stopPropagation();
      setSelected(new Set());
    }
  };

  const rowsOf = (rows: LinkRow[], chips: boolean) => (
    <ul className="space-y-0.5">
      {rows.map(r => (
        <LinkedRow
          key={r.key}
          row={r}
          chips={chips}
          threadId={threadId}
          titles={titles}
          now={now}
          selected={selected.has(r.key)}
          onToggle={toggle}
          onThread={onThread}
        />
      ))}
    </ul>
  );
  const heading = (text: string) => <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{text}</p>;

  const error = linked.error ?? (searching ? all.error : null);
  const stale = error !== null && linked.answer !== null && linked.answer.rows.length > 0;
  const note = stale ? `${error} Showing the links as last read.` : (linked.answer?.note ?? null);

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <div className="space-y-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <ScopeTabs current={scope} onSelect={setScope} />
          <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={refresh} disabled={linked.loading || all.loading} aria-label="Refresh">
            <Icon name="RotateCcw" className={cls("size-4", (linked.loading || all.loading) && "animate-spin")} />
          </Button>
        </div>
        <div className="relative">
          <Icon name="Search" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={search}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Escape" && query !== "") {
                event.stopPropagation();
                setQuery("");
              }
            }}
            placeholder={`Search all ${noun.many} to link…  ( / )`}
            aria-label={`Search ${noun.many}`}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        {error !== null && !stale ? (
          <div role="alert" className="mx-2 my-1 space-y-2 rounded-lg border border-warning bg-warning/5 px-3 py-2 text-xs">
            <p>{error}</p>
            <Button size="sm" variant="outline" onClick={refresh}>
              Try again
            </Button>
          </div>
        ) : linked.answer === null ? (
          <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
            <Icon name="Spinner" className="size-4 animate-spin" /> Reading links…
          </div>
        ) : !searching ? (
          sections.linked.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{empty[scope]}</p>
          ) : (
            rowsOf(sections.linked, scope !== "session")
          )
        ) : (
          <>
            {heading(LINKED_HEADING[scope])}
            {sections.linked.length === 0 ? <p className="px-2 pb-1 text-xs text-muted-foreground">No linked {noun.one} matches.</p> : rowsOf(sections.linked, scope !== "session")}
            {heading(`Other ${noun.many}`)}
            {all.answer?.note != null ? <p className="px-2 pb-1 text-xs text-muted-foreground">{all.answer.note}</p> : null}
            {all.answer === null ? (
              <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                <Icon name="Spinner" className="size-3.5 animate-spin" /> Searching every {noun.one}…
              </div>
            ) : sections.more.length === 0 ? (
              <p className="px-2 pb-1 text-xs text-muted-foreground">No other {noun.one} matches.</p>
            ) : (
              rowsOf(sections.more, true)
            )}
          </>
        )}
      </div>

      {chosen.length > 0 ? (
        <div className="space-y-1.5 border-t border-border px-3 py-2" role="toolbar" aria-label="Selection">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{chosen.length} selected</span>
            <button type="button" className="cursor-pointer hover:text-foreground" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ACTIONS.map(({ action, label, icon, variant }) => {
              const n = targets(action, chosen, threadId).length;
              const disabled = busy !== null || n === 0 || (action === "open" && !openMany && n > 1);
              return (
                <Button key={action} variant={variant} size="sm" className="flex-1" disabled={disabled} onClick={() => act(action)}>
                  <Icon name={busy === action ? "Spinner" : icon} className={cls("size-3.5", busy === action && "animate-spin")} />
                  {label}
                  {n > 0 && n < chosen.length ? ` (${n})` : ""}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      {note !== null ? <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">{note}</p> : null}
    </div>
  );
}
