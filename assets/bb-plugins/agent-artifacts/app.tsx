// bb-plugin-agent-artifacts — the frontend. A thread side-panel tab listing what shapes the thread's agent, and a
// header chip that counts it and opens the tab. All data comes from server.ts over RPC; the inventory's rules
// live in lib/inventory.ts, and this file only draws it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import {
  definePluginApp,
  experimental_copyToClipboard as copyToClipboard,
  experimental_FileLink as FileLink,
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginThreadHeaderActionProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { InventorySummary, rpcContract } from "./server";
import { bySource, claudeMarkdown, itemMatches, type ClaudeInventory, type Group, type Item, type Status } from "./lib/claude";
import { CLAUDE_CHANNEL, INVENTORY_CHANNEL, type ClaudeSignal, type InventorySignal } from "./lib/signals";
import {
  inventoryMarkdown,
  skillGroup,
  type ContextCategory,
  type Health,
  type Instruction,
  type Inventory,
  type Plugin,
  type Skill,
  type Tier,
  type Tool,
} from "./lib/inventory";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PANEL_ACTION = "artifacts";
const PANEL_TITLE = "Agent artifacts";

// ------------------------------------------------------------------ data

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Copies text through bb's own clipboard writer (works in bb Desktop without focus), with a toast either way. */
async function copy(text: string, done = "Copied") {
  if (await copyToClipboard({ text })) toast.success(done);
  else toast.error("Could not copy to the clipboard");
}

/** Realtime signals are untyped on the wire: read one field without trusting the rest. */
const field = (payload: unknown, key: string): unknown => (typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>)[key] : undefined);

/**
 * The thread's inventory. Only the latest request may land (a slow answer for a previous thread, or an older
 * refresh, is dropped), and a rebuild announced by the server (another panel, the chip, `bb artifacts`) is picked up.
 */
function useInventory(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [inv, setInv] = useState<Inventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);
  const builtAt = useRef(0);
  const load = useCallback(
    (fresh: boolean) => {
      const ticket = ++latest.current;
      setLoading(true);
      rpc.call("inventory", { threadId, fresh }).then(
        next => {
          if (ticket !== latest.current) return;
          builtAt.current = next.builtAt;
          setInv(next);
          setError(null);
          setLoading(false);
        },
        cause => {
          if (ticket !== latest.current) return;
          setError(message(cause));
          setLoading(false);
        },
      );
    },
    [rpc, threadId],
  );
  useEffect(() => {
    setInv(null);
    setError(null);
    builtAt.current = 0;
    load(false);
  }, [load]);
  useRealtime(INVENTORY_CHANNEL, payload => {
    const built = field(payload, "builtAt" satisfies keyof InventorySignal);
    if (field(payload, "threadId") === threadId && typeof built === "number" && built > builtAt.current) load(false);
  });
  return { inv, error, loading, refresh: () => load(true) };
}

/**
 * Claude Code's own view of the workspace. Slower than the inventory (it starts a Claude Code session), so apart.
 * The server answers at once with its last probe and probes again behind it when that one is old; the new probe is
 * announced over realtime and picked up here.
 */
function useClaude(threadId: string, workspace: { hostId: string; path: string | null } | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [answer, setAnswer] = useState<{ inventory: ClaudeInventory | null; reason: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);
  const isOn = workspace !== null;
  const load = useCallback(
    (fresh: boolean) => {
      const ticket = ++latest.current;
      setLoading(true);
      rpc.call("claude", { threadId, fresh }).then(
        next => {
          if (ticket !== latest.current) return;
          setAnswer(next);
          setError(null);
          setLoading(false);
        },
        cause => {
          if (ticket !== latest.current) return;
          setError(message(cause));
          setLoading(false);
        },
      );
    },
    [rpc, threadId],
  );
  useEffect(() => {
    setAnswer(null);
    setError(null);
    if (isOn) load(false);
    else latest.current++;
  }, [load, isOn]);
  useRealtime(CLAUDE_CHANNEL, payload => {
    if (workspace === null || field(payload, "hostId" satisfies keyof ClaudeSignal) !== workspace.hostId || field(payload, "path") !== workspace.path) return;
    const probedAt = answer?.inventory?.probedAt ?? 0;
    // Our own fresh probe lands through `load` too; only a newer one than what is shown is worth a fetch.
    if (Date.now() - probedAt > 1000) load(false);
  });
  return { claude: answer?.inventory ?? null, reason: answer?.reason ?? null, error, loading, refresh: () => isOn && load(true) };
}

// ------------------------------------------------------------------ small pieces

const matches = (query: string, ...fields: (string | null | undefined)[]) => {
  if (query === "") return true;
  const q = query.toLowerCase();
  return fields.some(f => f != null && f.toLowerCase().includes(q));
};

/** What the filter matches in each kind, shared by the lists and the tab counts. */
const hit = {
  instruction: (q: string, i: Instruction) => matches(q, i.label, i.path, i.note),
  skill: (q: string, s: Skill) => matches(q, s.name, s.description, s.source),
  tool: (q: string, t: Tool) => matches(q, t.name, t.detail, t.pluginName),
  command: (q: string, c: Inventory["cliCommands"][number]) => matches(q, c.command, c.summary, c.pluginName),
  plugin: (q: string, p: Plugin) => matches(q, p.name, p.id, p.description, p.cli, ...p.tools, ...p.skills),
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const tokens = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

function Chip({ children, tone = "muted", title }: { children: ReactNode; tone?: "muted" | "primary" | "warning" | "danger" | "success"; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-[11px] font-medium leading-4",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "primary" && "bg-primary/10 text-primary",
        tone === "warning" && "bg-warning/10 text-warning",
        tone === "danger" && "bg-destructive/10 text-destructive",
        tone === "success" && "bg-success/10 text-success",
      )}
    >
      {children}
    </span>
  );
}

const HEALTH_DOT: Record<Health, string> = {
  ok: "bg-success",
  warning: "bg-warning",
  error: "bg-destructive",
  off: "bg-muted-foreground/40",
};

function Dot({ className, title }: { className: string; title?: string }) {
  return <span title={title} aria-label={title} className={cn("inline-block size-1.5 shrink-0 rounded-full", className)} />;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
      aria-label={label}
      onClick={event => {
        event.stopPropagation();
        void copy(text);
      }}
    >
      <Icon name="Copy" className="size-3.5" />
    </Button>
  );
}

/** A path that opens in bb's preview when bb knows the host, and stays plain text when it does not. */
function PathLink({ path, hostId }: { path: string; hostId: string | null }) {
  const text = <span className="truncate font-mono text-[11px]">{path}</span>;
  if (hostId === null) return <span className="min-w-0 truncate text-muted-foreground" title={path}>{text}</span>;
  return (
    <FileLink
      target={{ kind: "host", hostId, path }}
      className="min-w-0 truncate text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      title={`Open ${path}`}
      onClick={event => event.stopPropagation()}
    >
      {text}
    </FileLink>
  );
}

/** A row that expands in place to show its details. */
function Row({ summary, children, isOpen, onToggle }: { summary: ReactNode; children?: ReactNode; isOpen: boolean; onToggle: () => void }) {
  const canOpen = children != null;
  return (
    <li className={cn("rounded-md", isOpen && "bg-muted/40")}>
      <div
        role={canOpen ? "button" : undefined}
        tabIndex={canOpen ? 0 : undefined}
        aria-expanded={canOpen ? isOpen : undefined}
        onClick={canOpen ? onToggle : undefined}
        onKeyDown={event => {
          if (canOpen && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onToggle();
          }
        }}
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm",
          canOpen && "cursor-pointer hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        {summary}
      </div>
      {isOpen && canOpen ? <div className="space-y-2 px-2 pb-2.5 pl-6 text-xs text-muted-foreground">{children}</div> : null}
    </li>
  );
}

function Section({
  title,
  icon,
  count,
  isOpen,
  onToggle,
  aside,
  children,
}: {
  title: string;
  icon: string;
  count: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-left text-sm font-medium hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon name={isOpen ? "ChevronDown" : "ChevronRight"} className="size-3.5 shrink-0 text-muted-foreground" />
          <Icon name={icon} className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{title}</span>
          <span className="text-xs font-normal tabular-nums text-muted-foreground">{count}</span>
        </button>
        {aside}
      </div>
      {isOpen ? <div className="border-t border-border px-1.5 py-1.5">{children}</div> : null}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-2 py-2 text-xs text-muted-foreground">{children}</p>;
}

// ------------------------------------------------------------------ header: thread, workspace, context

const SEGMENT = ["bg-primary", "bg-primary/75", "bg-primary/55", "bg-primary/40", "bg-primary/25"];

function ContextMeter({ context }: { context: NonNullable<Inventory["context"]> }) {
  const [isOpen, setOpen] = useState(false);
  const used = context.categories.filter(c => c.kind === "used" && c.tokens > 0).sort((a, b) => b.tokens - a.tokens);
  const pct = Math.round(context.ratio * 100);
  const segments: (ContextCategory & { color: string })[] = used.map((c, i) => ({ ...c, color: SEGMENT[Math.min(i, SEGMENT.length - 1)]! }));
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        disabled={segments.length === 0}
        onClick={() => setOpen(v => !v)}
        className="block w-full cursor-pointer space-y-1 text-left disabled:cursor-default"
        aria-expanded={segments.length === 0 ? undefined : isOpen}
        title={segments.length === 0 ? undefined : "Show the context breakdown"}
      >
        <div className="flex items-baseline justify-between text-xs text-muted-foreground">
          <span>
            Context {context.estimated ? "(estimated)" : ""}
          </span>
          <span className="tabular-nums">
            {tokens(context.usedTokens)} / {tokens(context.window)} · {pct}%
          </span>
        </div>
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Context used">
          {segments.length === 0 ? (
            <div className={cn("h-full", pct >= 85 ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} />
          ) : (
            segments.map(s => <div key={s.id} className={cn("h-full", s.color)} style={{ width: `${(s.tokens / context.window) * 100}%` }} title={`${s.label}: ${tokens(s.tokens)}`} />)
          )}
        </div>
      </button>
      {isOpen && segments.length > 0 ? (
        <ul className="space-y-0.5 text-xs">
          {segments.map(s => (
            <li key={s.id} className="flex items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-sm", s.color)} />
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              <span className="tabular-nums text-muted-foreground">{tokens(s.tokens)}</span>
            </li>
          ))}
          {context.autoCompactAtTokens === null ? null : (
            <li className="pt-0.5 text-muted-foreground">Auto-compacts at {tokens(context.autoCompactAtTokens)}</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

function ThreadHeader({ inv }: { inv: Inventory }) {
  const t = inv.thread;
  const o = t.options;
  const env = inv.environment;
  return (
    <div className="space-y-2.5 border-b border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold">{t.providerName}</span>
        {t.providerAvailable ? null : <Chip tone="danger">unavailable</Chip>}
        {t.model === null ? null : <Chip title="Model">{t.model}</Chip>}
        {o === null ? null : (
          <>
            <Chip title="Reasoning">{o.reasoningLevel}</Chip>
            <Chip title="Permission mode">{o.permissionMode}</Chip>
            {o.from === "project default" ? <Chip title="Read from the project defaults, not the thread">project default</Chip> : null}
          </>
        )}
      </div>
      {env === null ? null : (
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name={env.isWorktree ? "Worktree" : "Folder"} className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate font-mono text-[11px]" title={env.path ?? undefined}>
            {env.path ?? "workspace not on disk yet"}
          </span>
          {env.branchName === null ? null : (
            <Chip>
              <Icon name="GitBranch" className="size-3" />
              {env.branchName}
            </Chip>
          )}
        </div>
      )}
      {inv.context === null ? null : <ContextMeter context={inv.context} />}
    </div>
  );
}

// ------------------------------------------------------------------ sections

const KIND_LABEL: Record<Instruction["kind"], { text: string; tone: "primary" | "muted" | "warning" }> = {
  "bb-user": { text: "bb", tone: "primary" },
  "bb-workspace": { text: "bb", tone: "primary" },
  provider: { text: "native", tone: "muted" },
  "env-hook": { text: "hook", tone: "warning" },
};

function InstructionsList({ inv, query }: { inv: Inventory; query: string }) {
  const items = inv.instructions.filter(i => hit.instruction(query, i));
  if (items.length === 0) {
    return <Empty>{query === "" ? "No instruction files found." : "No matches."}</Empty>;
  }
  return (
    <ul className="space-y-0.5">
      {items.map(i => (
        <li key={i.path} className="flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-sm">
          <Icon name={i.kind === "env-hook" ? "Terminal" : "FileText"} className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{i.label}</span>
              <Chip tone={KIND_LABEL[i.kind].tone}>{KIND_LABEL[i.kind].text}</Chip>
            </div>
            <div className="flex min-w-0 items-center gap-1.5 text-xs">
              <PathLink path={i.path} hostId={i.hostId} />
            </div>
            {i.note === undefined ? null : <div className="text-xs text-muted-foreground">{i.note}</div>}
          </div>
          {i.approxTokens === null ? null : (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground" title={`${i.sizeBytes} bytes`}>
              ~{tokens(i.approxTokens)} tok
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

const TIER_TITLE: Record<Tier, (provider: string) => string> = {
  bb: () => "Injected by bb · every provider",
  provider: provider => `${provider} native`,
  "other-provider": () => "Other providers · not in this thread",
};

function SkillBadges({ skill }: { skill: Skill }) {
  return (
    <>
      {skill.status === "shadowed" ? <Chip tone="warning" title={`Replaced by ${skill.shadowedBy}`}>shadowed</Chip> : null}
      {skill.status === "collision" ? <Chip tone="danger" title="Two skills of this name in one bb source: bb drops both">collision</Chip> : null}
      {skill.alsoIn === undefined ? null : <Chip title={`Also defined in ${skill.alsoIn.join(", ")}`}>duplicate</Chip>}
    </>
  );
}

/** What a row adds to its group's heading: the plugin, when the group gathers several sources. */
const sourceWithin = (s: Skill, group: string) => (s.source === group ? null : s.source.replace(/^bb plugin /, ""));

/** A group's name under its tier heading, which already names the provider. */
const withoutPrefix = (text: string, prefix: string) => (text.startsWith(prefix) ? text.slice(prefix.length) : text);

function SkillGroup({
  group,
  label,
  skills,
  hostId,
  query,
  open,
  toggle,
}: {
  group: string;
  label: string;
  skills: Skill[];
  hostId: string | null;
  query: string;
  open: Set<string>;
  toggle: (key: string) => void;
}) {
  const key = `group:${group}`;
  const isOpen = query !== "" || open.has(key);
  const active = skills.filter(s => s.status === "active").length;
  return (
    <div>
      <button
        type="button"
        onClick={() => toggle(key)}
        aria-expanded={isOpen}
        className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Icon name={isOpen ? "ChevronDown" : "ChevronRight"} className="size-3 shrink-0" />
        <span className="truncate font-medium text-foreground/80">{label}</span>
        <span className="tabular-nums">
          {active}
          {active === skills.length ? "" : ` of ${skills.length}`}
        </span>
      </button>
      {isOpen ? (
        <ul className="pl-3">
          {skills.map(s => (
            <Row
              key={s.id}
              isOpen={open.has(s.id)}
              onToggle={() => toggle(s.id)}
              summary={
                <>
                  <span className={cn("shrink-0 truncate font-medium", s.status !== "active" && s.status !== "other-provider" && "text-muted-foreground line-through")}>{s.name}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{s.description}</span>
                  {sourceWithin(s, group) === null ? null : <Chip>{sourceWithin(s, group)}</Chip>}
                  <SkillBadges skill={s} />
                </>
              }
            >
              {s.description === "" ? null : <p className="whitespace-pre-wrap text-foreground/80">{s.description}</p>}
              {s.status === "shadowed" ? <p>Replaced by the same name in {s.shadowedBy}.</p> : null}
              {s.status === "collision" ? <p>Another skill in {s.source} has this name; bb drops both.</p> : null}
              {s.alsoIn === undefined ? null : <p>Also defined in {s.alsoIn.join(", ")}: both reach the agent, which one it prefers is up to the provider.</p>}
              <div className="flex min-w-0 items-center gap-1">
                <PathLink path={s.filePath} hostId={hostId} />
                <CopyButton text={s.filePath} label="Copy path" />
              </div>
            </Row>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SkillsList({ inv, query, showOthers, open, toggle }: { inv: Inventory; query: string; showOthers: boolean; open: Set<string>; toggle: (key: string) => void }) {
  const hostId = inv.environment?.hostId ?? null;
  const tiers = useMemo(() => {
    const out = new Map<Tier, Map<string, Skill[]>>();
    for (const s of inv.skills) {
      if (s.tier === "other-provider" && !showOthers) continue;
      if (!hit.skill(query, s)) continue;
      const byGroup = out.get(s.tier) ?? new Map<string, Skill[]>();
      byGroup.set(skillGroup(s), [...(byGroup.get(skillGroup(s)) ?? []), s]);
      out.set(s.tier, byGroup);
    }
    return out;
  }, [inv.skills, query, showOthers]);
  if (tiers.size === 0) return <Empty>{query === "" ? "No skills." : "No matches."}</Empty>;
  return (
    <div className="space-y-2">
      {[...tiers].map(([tier, byGroup]) => (
        <div key={tier} className="space-y-0.5">
          <div className="px-2 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{TIER_TITLE[tier](inv.thread.providerName)}</div>
          {[...byGroup].map(([group, skills]) => (
            <SkillGroup
              key={group}
              group={group}
              label={tier === "provider" ? withoutPrefix(group, `${inv.thread.providerName} `) : group}
              skills={skills}
              hostId={hostId}
              query={query}
              open={open}
              toggle={toggle}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function ToolsList({ tools, query, open, toggle }: { tools: Tool[]; query: string; open: Set<string>; toggle: (key: string) => void }) {
  const items = tools.filter(t => hit.tool(query, t));
  if (items.length === 0) return <Empty>{query === "" ? "No plugin adds agent tools." : "No matches."}</Empty>;
  return (
    <ul className="space-y-0.5">
      {items.map(t => {
        const key = `tool:${t.pluginId}:${t.name}`;
        return (
          <Row
            key={key}
            isOpen={open.has(key)}
            onToggle={() => toggle(key)}
            summary={
              <>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{t.name}</span>
                <Chip>{t.pluginName}</Chip>
              </>
            }
          >
            {t.detail === "" ? null : <p className="whitespace-pre-wrap text-foreground/80">{t.detail}</p>}
          </Row>
        );
      })}
    </ul>
  );
}

function CommandsList({ inv, query }: { inv: Inventory; query: string }) {
  const items = inv.cliCommands.filter(c => hit.command(query, c));
  if (items.length === 0) return <Empty>{query === "" ? "No plugin adds a bb command." : "No matches."}</Empty>;
  return (
    <ul className="space-y-0.5">
      {items.map(c => (
        <li key={c.command} className="group flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-state-hover">
          <code className="shrink-0 font-mono text-xs">{c.command}</code>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={c.summary}>
            {c.summary}
          </span>
          <span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <CopyButton text={c.command} label={`Copy ${c.command}`} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function PluginRow({ p, isOpen, onToggle }: { p: Plugin; isOpen: boolean; onToggle: () => void }) {
  const healthTitle = p.health === "ok" ? "running" : p.status;
  return (
    <Row
      isOpen={isOpen}
      onToggle={onToggle}
      summary={
        <>
          <Icon name={p.icon ?? "Plug02"} className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{p.name}</span>
          <Dot className={HEALTH_DOT[p.health]} title={healthTitle} />
          <span className="flex min-w-0 flex-1 flex-wrap justify-end gap-1">
            {p.isThreadProvider ? <Chip tone="primary">runs this thread</Chip> : null}
            {p.tools.length > 0 ? <Chip>{plural(p.tools.length, "tool")}</Chip> : null}
            {p.skills.length > 0 ? <Chip>{plural(p.skills.length, "skill")}</Chip> : null}
            {p.cli === null ? null : <Chip>{p.cli}</Chip>}
            {p.health === "error" || p.health === "warning" ? <Chip tone={p.health === "error" ? "danger" : "warning"}>{p.status}</Chip> : null}
          </span>
        </>
      }
    >
      {p.description === "" ? null : <p className="text-foreground/80">{p.description}</p>}
      {p.statusDetail === null ? null : <p className={p.health === "error" ? "text-destructive" : undefined}>{p.statusDetail}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt>Source</dt>
        <dd className="truncate">
          {p.provenance}
          {p.version === null ? "" : ` · v${p.version}`}
        </dd>
        {p.tools.length > 0 ? (
          <>
            <dt>Tools</dt>
            <dd className="font-mono">{p.tools.join(", ")}</dd>
          </>
        ) : null}
        {p.skills.length > 0 ? (
          <>
            <dt>Skills</dt>
            <dd>{p.skills.join(", ")}</dd>
          </>
        ) : null}
        {p.integrations.length > 0 ? (
          <>
            <dt>Thread hooks</dt>
            <dd>{p.integrations.join(", ")}</dd>
          </>
        ) : null}
        {p.services.length > 0 ? (
          <>
            <dt>Services</dt>
            <dd>{p.services.map(s => `${s.name} (${s.state})`).join(", ")}</dd>
          </>
        ) : null}
        {p.scheduleCount > 0 ? (
          <>
            <dt>Schedules</dt>
            <dd>{p.scheduleCount}</dd>
          </>
        ) : null}
        {p.hasApp ? (
          <>
            <dt>UI</dt>
            <dd>adds app UI</dd>
          </>
        ) : null}
      </dl>
    </Row>
  );
}

function PluginsList({ inv, query, open, toggle }: { inv: Inventory; query: string; open: Set<string>; toggle: (key: string) => void }) {
  const items = inv.plugins.filter(p => hit.plugin(query, p));
  const reaching = items.filter(p => p.reachesAgent);
  const rest = items.filter(p => !p.reachesAgent);
  const restKey = "plugins:rest";
  const isRestOpen = query !== "" || open.has(restKey);
  if (items.length === 0) return <Empty>No matches.</Empty>;
  return (
    <div className="space-y-1">
      <ul className="space-y-0.5">
        {reaching.map(p => (
          <PluginRow key={p.id} p={p} isOpen={open.has(`plugin:${p.id}`)} onToggle={() => toggle(`plugin:${p.id}`)} />
        ))}
      </ul>
      {rest.length === 0 ? null : (
        <div>
          <button
            type="button"
            onClick={() => toggle(restKey)}
            aria-expanded={isRestOpen}
            className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-state-hover"
          >
            <Icon name={isRestOpen ? "ChevronDown" : "ChevronRight"} className="size-3 shrink-0" />
            Not reaching the agent (UI-only, stopped, failed) · {rest.length}
          </button>
          {isRestOpen ? (
            <ul className="space-y-0.5 pl-3">
              {rest.map(p => (
                <PluginRow key={p.id} p={p} isOpen={open.has(`plugin:${p.id}`)} onToggle={() => toggle(`plugin:${p.id}`)} />
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Claude Code's own view

const STATUS_TONE: Record<Status, "success" | "danger" | "warning" | "muted"> = {
  on: "success",
  connected: "success",
  failed: "danger",
  "needs-auth": "warning",
  pending: "warning",
  "no-tools": "warning",
  off: "muted",
  disabled: "muted",
};

const STATUS_TEXT: Partial<Record<Status, string>> = { "needs-auth": "needs sign-in" };

/** A group's one-line status: how many items are in each notable state. */
function groupSummary(group: Group): ReactNode {
  if (group.kind !== "mcp" && group.kind !== "plugins") return null;
  const counts = new Map<Status, number>();
  for (const i of group.items) if (i.status !== undefined) counts.set(i.status, (counts.get(i.status) ?? 0) + 1);
  return (
    <span className="inline-flex gap-1">
      {[...counts].map(([status, n]) => (
        <Chip key={status} tone={STATUS_TONE[status]}>
          {n} {STATUS_TEXT[status] ?? status}
        </Chip>
      ))}
    </span>
  );
}

function ClaudeItemRow({ item, hostId, isOpen, onToggle, revealed }: { item: Item; hostId: string | null; isOpen: boolean; onToggle: () => void; revealed: string | undefined }) {
  const hasMore = item.description !== undefined || item.list !== undefined || item.path !== undefined;
  return (
    <Row
      isOpen={isOpen}
      onToggle={onToggle}
      summary={
        <>
          <span className={cn("shrink-0 truncate font-medium", (item.status === "off" || item.status === "disabled") && "text-muted-foreground")}>{item.name}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {item.masked === undefined ? (item.detail ?? (item.description === undefined ? "" : item.description.split("\n", 1)[0])) : (revealed ?? item.masked)}
          </span>
          {item.tokens === undefined ? null : <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{tokens(item.tokens)} tok</span>}
          {item.fromDisk ? <Chip title="Read from a file now, not reported by the session">file</Chip> : null}
          {item.status === undefined || item.status === "on" ? null : <Chip tone={STATUS_TONE[item.status]}>{STATUS_TEXT[item.status] ?? item.status}</Chip>}
        </>
      }
    >
      {hasMore ? (
        <>
          {item.description === undefined ? null : (
            <p className={cn("whitespace-pre-wrap break-words", item.status === "failed" ? "text-destructive" : "text-foreground/80")}>{item.description}</p>
          )}
          {item.list === undefined ? null : (
            <div className="flex flex-wrap gap-1">
              {item.list.map(name => (
                <span key={name} className="rounded bg-muted px-1 font-mono text-[10px]">
                  {name}
                </span>
              ))}
            </div>
          )}
          {item.path === undefined ? null : (
            <div className="flex min-w-0 items-center gap-1">
              <PathLink path={item.path} hostId={hostId} />
              <CopyButton text={item.path} label="Copy path" />
            </div>
          )}
        </>
      ) : null}
    </Row>
  );
}

/** Env values are fetched only when the user reveals them, and forgotten when masked again. */
function useRevealedEnv(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = () => {
    if (values !== null) return setValues(null);
    setBusy(true);
    rpc.call("claudeEnv", { threadId }).then(
      next => (setValues(next), setBusy(false)),
      cause => (toast.error(message(cause)), setBusy(false)),
    );
  };
  useEffect(() => setValues(null), [threadId]);
  return { values, busy, toggle };
}

function ClaudeGroup({
  group,
  threadId,
  hostId,
  query,
  open,
  toggle,
}: {
  group: Group;
  threadId: string;
  hostId: string | null;
  query: string;
  open: Set<string>;
  toggle: (key: string) => void;
}) {
  const env = useRevealedEnv(threadId);
  const reveal = env.values !== null;
  const items = group.items.filter(i => itemMatches(i, query));
  if (query !== "" && items.length === 0) return null;
  const key = `cc:${group.kind}`;
  const isOpen = query !== "" || open.has(key);
  const runs = bySource(items);
  return (
    <Section
      title={group.title}
      icon={group.icon}
      count={
        <span className="inline-flex items-center gap-1.5">
          {query === "" ? items.length : `${items.length} of ${group.items.length}`}
          {groupSummary(group)}
        </span>
      }
      isOpen={isOpen}
      onToggle={() => toggle(key)}
      aside={
        group.kind === "env" && group.items.length > 0 ? (
          <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground" aria-label={reveal ? "Mask values" : "Reveal values"} disabled={env.busy} onClick={env.toggle}>
            <Icon name={env.busy ? "Spinner" : reveal ? "EyeOff" : "Eye"} className={cn("size-3.5", env.busy && "animate-spin")} />
          </Button>
        ) : null
      }
    >
      {group.note === undefined ? null : <p className="px-2 pb-1 text-[11px] text-muted-foreground">{group.note}</p>}
      {items.length === 0 ? <Empty>None.</Empty> : null}
      <div className="space-y-1">
        {runs.map((run, r) => (
          <div key={`${run.source}:${r}`}>
            {runs.length > 1 || run.source !== "user" ? (
              <div className="px-2 pt-1 text-[11px] font-medium text-muted-foreground">
                {run.source} <span className="tabular-nums opacity-70">{run.items.length}</span>
              </div>
            ) : null}
            <ul className="space-y-0.5">
              {run.items.map(item => (
                <ClaudeItemRow key={item.id} item={item} hostId={hostId} isOpen={open.has(`${key}:${item.id}`)} onToggle={() => toggle(`${key}:${item.id}`)} revealed={env.values?.[item.id]} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ClaudeView({
  threadId,
  claude,
  reason,
  error,
  loading,
  hostId,
  query,
  open,
  toggle,
}: {
  threadId: string;
  claude: ClaudeInventory | null;
  reason: string | null;
  error: string | null;
  loading: boolean;
  hostId: string | null;
  query: string;
  open: Set<string>;
  toggle: (key: string) => void;
}) {
  if (claude === null) {
    return (
      <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
        {error !== null ? (
          <span className="text-destructive">Could not ask Claude Code: {error}</span>
        ) : loading ? (
          <span className="inline-flex items-center gap-2">
            <Icon name="Spinner" className="size-3.5 animate-spin" /> Asking Claude Code what it loads here (a session with no prompt, no model call)…
          </span>
        ) : (
          (reason ?? "Claude Code's own view is not available.")
        )}
      </div>
    );
  }
  const a = claude.account;
  const errorLine = error === null ? null : <p className="px-1 text-xs text-destructive">Could not ask Claude Code again: {error}</p>;
  const groups = claude.groups.filter(g => query === "" || g.items.some(i => itemMatches(i, query)));
  return (
    <div className="space-y-2">
      <div className="space-y-1 px-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>Claude Code's own view{claude.version === null ? "" : ` · ${claude.version}`}</span>
          {loading ? <Icon name="Spinner" className="size-3 animate-spin" /> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {a?.email === undefined ? null : <Chip title={a.organization}>{a.email}</Chip>}
          {a?.subscriptionType === undefined ? null : <Chip>{a.subscriptionType}</Chip>}
          {a?.apiProvider === undefined || a.apiProvider === "firstParty" ? null : <Chip>{a.apiProvider}</Chip>}
          {claude.baseline === null ? null : (
            <Chip title={`What a fresh session in this workspace starts with, on ${claude.baseline.model}`}>
              starts at {tokens(claude.baseline.totalTokens)} / {tokens(claude.baseline.maxTokens)}
            </Chip>
          )}
          <Chip title="When Claude Code was asked; refresh to ask again" tone={Date.now() - claude.probedAt > 120_000 ? "warning" : "muted"}>
            {new Date(claude.probedAt).toLocaleTimeString()} · {(claude.probeMs / 1000).toFixed(1)}s
          </Chip>
        </div>
      </div>
      {errorLine}
      {claude.attention.length > 0 && query === "" ? (
        <div role="alert" className="space-y-0.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-warning">
            <Icon name="AlertTriangle" className="size-3.5" /> {plural(claude.attention.length, "thing needs", "things need")} a look
          </div>
          {claude.attention.map(line => (
            <p key={line} className="break-words">
              {line}
            </p>
          ))}
        </div>
      ) : null}
      {claude.problems.length > 0 && query === "" ? (
        <details className="px-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">{plural(claude.problems.length, "file or call", "files or calls")} could not be read</summary>
          <ul className="mt-1 space-y-0.5">
            {claude.problems.map(p => (
              <li key={p} className="break-words">
                {p}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {groups.map(g => (
        <ClaudeGroup key={g.kind} group={g} threadId={threadId} hostId={hostId} query={query} open={open} toggle={toggle} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ the panel

type View = "all" | "instructions" | "skills" | "tools" | "commands" | "plugins" | "claude";

function ViewTab({ view, current, onSelect, label, count }: { view: View; current: View; onSelect: (v: View) => void; label: string; count?: number }) {
  const isOn = view === current;
  return (
    <button
      type="button"
      aria-pressed={isOn}
      onClick={() => onSelect(view)}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        isOn ? "bg-state-active text-foreground" : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
      )}
    >
      {label}
      {count === undefined ? null : <span className="tabular-nums opacity-70">{count}</span>}
    </button>
  );
}

function ArtifactsPanel({ threadId }: PluginThreadPanelProps) {
  const { inv, error, loading, refresh: refreshInventory } = useInventory(threadId);
  const isClaude = inv?.thread.providerId === "claude-code";
  const env = inv?.environment ?? null;
  const workspace = useMemo(() => (isClaude && env !== null ? { hostId: env.hostId, path: env.path } : null), [isClaude, env?.hostId, env?.path]);
  const cc = useClaude(threadId, workspace);
  const busy = loading || cc.loading;
  const refresh = () => {
    refreshInventory();
    cc.refresh();
  };
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("all");
  const [showOthers, setShowOthers] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set(["sec:instructions", "sec:skills", "sec:tools", "sec:commands"]));
  const search = useRef<HTMLInputElement>(null);
  const toggle = useCallback((key: string) => {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const isTyping = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if (event.key === "/" && !isTyping) {
      event.preventDefault();
      search.current?.focus();
    }
  };

  if (inv === null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {error === null ? (
          <span className="inline-flex items-center gap-2">
            <Icon name="Spinner" className="size-4 animate-spin" /> Reading what this agent runs with…
          </span>
        ) : (
          <div className="space-y-3 text-center">
            <p className="text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={refresh}>
              Try again
            </Button>
          </div>
        )}
      </div>
    );
  }

  const k = inv.counts;
  // While filtering, each tab counts its matches; otherwise what reaches the agent.
  const tab = {
    instructions: inv.instructions.filter(i => hit.instruction(query, i)).length,
    skills: inv.skills.filter(s => (s.status === "active" || (query !== "" && showOthers && s.tier === "other-provider")) && hit.skill(query, s)).length,
    tools: inv.tools.filter(t => hit.tool(query, t)).length,
    commands: inv.cliCommands.filter(c => hit.command(query, c)).length,
    plugins: inv.plugins.filter(p => (query !== "" || p.reachesAgent) && hit.plugin(query, p)).length,
    claude: (cc.claude?.groups ?? []).reduce((n, g) => n + g.items.filter(i => itemMatches(i, query)).length, 0),
  };
  // While filtering in All, a section with no matches is left out rather than repeating "No matches".
  const show = (v: Exclude<View, "all">) => view === v || (view === "all" && (query === "" || tab[v] > 0));
  const nothingMatches = view === "all" && query !== "" && Object.values(tab).every(n => n === 0);
  const isSectionOpen = (id: string) => view !== "all" || query !== "" || open.has(`sec:${id}`);
  const troubled = inv.plugins.filter(p => p.health === "error" || p.health === "warning");
  const otherCount = inv.skills.filter(s => s.tier === "other-provider").length;
  const copyAll = () =>
    copy(
      [inventoryMarkdown(inv, { full: true, otherProviders: showOthers }), ...(cc.claude === null ? [] : [claudeMarkdown(cc.claude, { full: true })])].join("\n\n"),
      "Copied the inventory as Markdown",
    );

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <ThreadHeader inv={inv} />

      <div className="space-y-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
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
              placeholder={isClaude ? "Filter skills, MCP, hooks, files…  ( / )" : "Filter skills, tools, files…  ( / )"}
              aria-label="Filter"
              className="h-8 pl-8 text-sm"
            />
          </div>
          <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={refresh} disabled={busy} aria-label={cc.loading && !loading ? "Asking Claude Code…" : "Refresh"}>
            <Icon name="RotateCcw" className={cn("size-4", busy && "animate-spin")} />
          </Button>
          <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={copyAll} aria-label="Copy as Markdown">
            <Icon name="Copy" className="size-4" />
          </Button>
        </div>
        <div className="-mx-1 flex items-center gap-0.5 overflow-x-auto px-1" role="toolbar" aria-label="Show">
          <ViewTab view="all" current={view} onSelect={setView} label="All" />
          <ViewTab view="instructions" current={view} onSelect={setView} label="Files" count={tab.instructions} />
          <ViewTab view="skills" current={view} onSelect={setView} label="Skills" count={tab.skills} />
          <ViewTab view="tools" current={view} onSelect={setView} label="Tools" count={tab.tools} />
          <ViewTab view="commands" current={view} onSelect={setView} label="Commands" count={tab.commands} />
          <ViewTab view="plugins" current={view} onSelect={setView} label="Plugins" count={tab.plugins} />
          {isClaude ? <ViewTab view="claude" current={view} onSelect={setView} label="Claude Code" count={cc.claude === null ? undefined : tab.claude} /> : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {troubled.length > 0 || inv.problems.length > 0 ? (
          <div role="alert" className="space-y-1 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
            <div className="flex items-center gap-1.5 font-medium text-warning">
              <Icon name="AlertTriangle" className="size-3.5" /> Something is off
            </div>
            {troubled.map(p => (
              <p key={p.id}>
                <span className="font-medium">{p.name}</span> is {p.status}
                {p.statusDetail === null ? "" : `: ${p.statusDetail}`}
              </p>
            ))}
            {inv.problems.map(p => (
              <p key={p}>Could not read {p}</p>
            ))}
          </div>
        ) : null}

        {error === null ? null : <p className="px-1 text-xs text-destructive">Could not refresh: {error}</p>}

        {nothingMatches ? <Empty>Nothing matches “{query}”. Other providers' skills are searched only when shown.</Empty> : null}

        {show("instructions") ? (
          <Section title="Instruction files and hooks" icon="FileText" count={tab.instructions} isOpen={isSectionOpen("instructions")} onToggle={() => toggle("sec:instructions")}>
            <InstructionsList inv={inv} query={query} />
            {inv.missingInstructions.length === 0 || query !== "" ? null : (
              <details className="px-2 pb-1 pt-1 text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none">Also looked for {inv.missingInstructions.length} files that are not there</summary>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                  {inv.missingInstructions.map(p => (
                    <li key={p} className="truncate" title={p}>
                      {p}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Section>
        ) : null}

        {show("skills") ? (
          <Section
            title="Skills"
            icon="Brain"
            count={tab.skills}
            isOpen={isSectionOpen("skills")}
            onToggle={() => toggle("sec:skills")}
            aside={
              otherCount === 0 ? null : (
                <button
                  type="button"
                  aria-pressed={showOthers}
                  onClick={() => setShowOthers(v => !v)}
                  className={cn(
                    "shrink-0 cursor-pointer rounded-md px-2 py-1 text-xs",
                    showOthers ? "bg-state-active text-foreground" : "text-muted-foreground hover:bg-state-hover",
                  )}
                  title="List the skills other providers would get, for comparison"
                >
                  + other providers {otherCount}
                </button>
              )
            }
          >
            <SkillsList inv={inv} query={query} showOthers={showOthers} open={open} toggle={toggle} />
          </Section>
        ) : null}

        {show("tools") ? (
          <Section title="Plugin tools" icon="Toolbox" count={tab.tools} isOpen={isSectionOpen("tools")} onToggle={() => toggle("sec:tools")}>
            <ToolsList tools={inv.tools} query={query} open={open} toggle={toggle} />
          </Section>
        ) : null}

        {show("commands") ? (
          <Section title="Plugin bb commands" icon="Terminal" count={tab.commands} isOpen={isSectionOpen("commands")} onToggle={() => toggle("sec:commands")}>
            <CommandsList inv={inv} query={query} />
          </Section>
        ) : null}

        {show("plugins") ? (
          <Section
            title="Plugins"
            icon="Plug02"
            count={
              <>
                {query === "" ? `${tab.plugins} reach the agent` : plural(tab.plugins, "match", "matches")}
                {k.pluginProblems > 0 ? <Dot className="ml-1.5 bg-warning" title={`${k.pluginProblems} with problems`} /> : null}
              </>
            }
            isOpen={isSectionOpen("plugins")}
            onToggle={() => toggle("sec:plugins")}
          >
            <PluginsList inv={inv} query={query} open={open} toggle={toggle} />
          </Section>
        ) : null}

        {isClaude && show("claude") ? (
          <div className={cn(view === "all" && "pt-2")}>
            <ClaudeView threadId={threadId} claude={cc.claude} reason={cc.reason} error={cc.error} loading={cc.loading} hostId={inv.environment?.hostId ?? null} query={query} open={open} toggle={toggle} />
          </div>
        ) : null}
      </div>

      <footer className="border-t border-border px-4 py-2 text-[11px] leading-4 text-muted-foreground">
        Read {new Date(inv.builtAt).toLocaleTimeString()} · bb sees the skills and instruction files it injects and the provider's own skills and files.
        {isClaude
          ? " Claude Code's own view comes from a session started in this workspace with no prompt (no model call, hooks off); bb's own skills and tools are added on top of it in this thread."
          : " The provider's MCP servers, hooks and permissions are not visible to bb yet."}
      </footer>
    </div>
  );
}

// ------------------------------------------------------------------ header chip

function HeaderChip({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let isCurrent = true;
    rpc.call("summary", { threadId }).then(
      next => isCurrent && setSummary(next),
      () => isCurrent && setSummary(null),
    );
    return () => {
      isCurrent = false;
    };
  }, [rpc, threadId, version]);
  // A rebuilt inventory (the panel's refresh, `bb artifacts`) updates the count; the RPC hits the server's cache.
  useRealtime(INVENTORY_CHANNEL, payload => {
    if (field(payload, "threadId") === threadId) setVersion(v => v + 1);
  });
  const total = summary === null ? null : summary.activeSkills + summary.tools + summary.instructions;
  const title =
    summary === null
      ? PANEL_TITLE
      : `${PANEL_TITLE}: ${summary.instructions} files, ${summary.activeSkills} skills, ${summary.tools} plugin tools${summary.pluginProblems > 0 ? `, ${summary.pluginProblems} plugins with problems` : ""}`;
  return (
    <span title={title} className="inline-flex">
      <Button
        variant="ghost"
        size="sm"
        className="relative h-7 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
        aria-label={title}
        onClick={() => {
          if (!navigate.openThreadPanel({ actionId: PANEL_ACTION, title: PANEL_TITLE })) toast.error("This view has no side panel.");
        }}
      >
        <Icon name="Layers" className="size-4" />
        {isCompactViewport || total === null ? null : <span className="text-xs tabular-nums">{total}</span>}
        {summary !== null && summary.pluginProblems > 0 ? <Dot className="absolute right-1 top-1 bg-warning" /> : null}
      </Button>
    </span>
  );
}

export default definePluginApp(app => {
  app.slots.threadPanelAction({
    id: PANEL_ACTION,
    title: PANEL_TITLE,
    icon: "Layers",
    layout: "flush",
    component: ArtifactsPanel,
    run: ({ openPanel }) => {
      openPanel({ title: PANEL_TITLE });
    },
  });
  app.slots.experimental_threadHeaderAction({
    id: "artifacts-chip",
    title: PANEL_TITLE,
    component: HeaderChip,
  });
});
