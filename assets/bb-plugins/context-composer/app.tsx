// bb-plugin-context-composer — the frontend. A page of its own (a nav panel, not tied to a thread) that composes a
// thread's context, and a thread panel that is only a shortcut into it. Rules live in core/; views in views/; data
// comes from server.ts over RPC.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  definePluginApp,
  experimental_ProviderModelPicker as ProviderModelPicker,
  ThreadChat,
  useBbNavigate,
  useRpc,
  type ExperimentalProviderModelPickerValue,
  type PluginNavPanelProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { BasisInfo, rpcContract } from "./server";
import { kbOutline, kbSchemaCommands } from "./core/kb.ts";
import { decide, decideSource, diff, emptyManifest, totals, type Artifact, type Composition, type Manifest } from "./core/model.ts";
import { bbTargetFor, commandLine, compile, itemLever, TARGETS, type Lever, type Plan, type Target } from "./core/targets.ts";
import { applyProposal, parseProposals } from "./core/trajectory.ts";
import { VIEWS } from "./views/index.ts";
import { LeverBadge } from "./views/parts.tsx";

const PAGE = "composer";
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const newId = () => `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const n = (x: number) => x.toLocaleString("en-US");

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

type PickerValue = ExperimentalProviderModelPickerValue;

// ------------------------------------------------------------------ data

function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    load().then(
      v => live && (setValue(v), setError(null)),
      e => live && setError(message(e)),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { value, error, reload: () => setTick(t => t + 1) };
}

/** The composition: bb's inventory first (fast), then with the provider's own view (Claude Code starts a probe). */
function useComposition(rpc: Rpc, threadId: string) {
  const [c, setC] = useState<Composition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const load = useCallback(
    (fresh: boolean) => {
      setFull(false);
      rpc.call("compose", { threadId, fresh }).then(setC, e => setError(message(e)));
      rpc.call("compose", { threadId, withProvider: true, fresh }).then(
        v => (setC(v), setFull(true)),
        e => setError(message(e)),
      );
    },
    [rpc, threadId],
  );
  useEffect(() => load(false), [load]);
  return { composition: c, error, full, refresh: () => load(true) };
}

// ------------------------------------------------------------------ the page

function ComposerPage({ subPath }: PluginNavPanelProps) {
  const [kind, threadId, manifestId] = subPath.split("/");
  if (kind === "thread" && threadId !== undefined && threadId !== "") return <Workspace key={`${threadId}/${manifestId ?? ""}`} threadId={threadId} manifestId={manifestId ?? null} />;
  return <Home />;
}

function Home() {
  const rpc = useRpc<typeof rpcContract>();
  const nav = useBbNavigate();
  const overview = useAsync(() => rpc.call("overview", {}), [rpc]);
  const manifests = useAsync(() => rpc.call("manifests", {}), [rpc]);
  const open = (sub: string) => nav.toPluginPanel(PAGE, { subPath: sub });
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 text-sm">
      <header>
        <h1 className="text-lg font-semibold">Context composer</h1>
        <p className="text-muted-foreground">
          Everything that feeds an agent, as one composition: keep or drop each artifact, ask what it does to the trajectory, and start a thread with it. Each change says whether the
          host enforces it or the agent is only told.
        </p>
      </header>
      {overview.error !== null ? <p className="text-destructive">{overview.error}</p> : null}
      <section>
        <h2 className="mb-2 font-medium">Compose from a thread</h2>
        <ul className="divide-y divide-border rounded-md border border-border">
          {(overview.value?.threads ?? []).map(t => (
            <li key={t.id}>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-state-hover" onClick={() => open(`thread/${t.id}`)}>
                <span className="truncate">{t.title ?? t.id}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{t.providerId}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-2 font-medium">Saved manifests</h2>
        {(manifests.value ?? []).length === 0 ? <p className="text-muted-foreground">None yet. A manifest is saved when you save it or spawn with it.</p> : null}
        <ul className="divide-y divide-border rounded-md border border-border empty:hidden">
          {(manifests.value ?? []).map(m => (
            <li key={m.id} className="flex items-center gap-2 px-3 py-1.5">
              <button type="button" className="truncate text-left hover:underline" disabled={m.basisThreadId === null} onClick={() => open(`thread/${m.basisThreadId}/${m.id}`)}>
                {m.title}
              </button>
              <span className="text-xs text-muted-foreground">{Object.keys(m.decisions).length} decisions</span>
              <button
                type="button"
                className="ml-auto text-xs text-muted-foreground hover:text-destructive"
                onClick={() => rpc.call("deleteManifest", { id: m.id }).then(manifests.reload)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-2 font-medium">Started from a composition</h2>
        {(overview.value?.spawned ?? []).length === 0 ? <p className="text-muted-foreground">No threads yet.</p> : null}
        <ul className="divide-y divide-border rounded-md border border-border empty:hidden">
          {(overview.value?.spawned ?? []).map(s => (
            <li key={s.id} className="flex items-center gap-2 px-3 py-1.5">
              <button type="button" className="truncate text-left hover:underline" onClick={() => nav.toThread(s.id)}>
                {s.title ?? s.id}
              </button>
              <span className="shrink-0 text-xs text-muted-foreground">
                {s.record.role === "composed" ? `${s.record.manifestTitle} · ${s.record.targetId} · −${s.record.excluded.length} +${s.record.included.length}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Workspace({ threadId, manifestId }: { threadId: string; manifestId: string | null }) {
  const rpc = useRpc<typeof rpcContract>();
  const nav = useBbNavigate();
  const { composition: c, error, full, refresh } = useComposition(rpc, threadId);
  const basis = useAsync(() => rpc.call("basis", { threadId }), [rpc, threadId]);
  const [manifest, setManifest] = useState<Manifest>(() => emptyManifest({ id: newId(), title: "Untitled composition", basisThreadId: threadId, now: Date.now() }));
  const [targetId, setTargetId] = useState<string | null>(null);
  const [viewId, setViewId] = useState(VIEWS[0]!.id);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (manifestId === null) return;
    rpc.call("manifests", {}).then(all => {
      const m = all.find(x => x.id === manifestId);
      if (m !== undefined) setManifest(m);
    });
  }, [rpc, manifestId]);

  const target: Target | null = useMemo(() => {
    if (c === null) return null;
    return TARGETS.find(t => t.id === targetId) ?? bbTargetFor(c.basis.providerId);
  }, [c, targetId]);
  const plan: Plan | null = useMemo(() => (c === null || target === null ? null : compile(target, c, manifest)), [c, target, manifest]);
  const planned = useMemo(() => new Map((plan?.steps ?? []).map(s => [s.artifact.id, s.lever])), [plan]);
  const sources = useMemo(() => new Map((c?.sources ?? []).map(s => [s.id, s])), [c]);

  if (error !== null && c === null) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (c === null || target === null || plan === null) return <p className="p-6 text-sm text-muted-foreground">Reading what feeds this thread…</p>;

  const leverOf = (a: Artifact): Lever => planned.get(a.id) ?? itemLever(target, a, sources.get(a.sourceId) ?? { id: a.sourceId, label: a.sourceId, injector: "provider", scope: "user" });
  const now = () => Date.now();
  const View = VIEWS.find(v => v.id === viewId)!.component;
  const t = totals(c, manifest);
  const d = diff(c, manifest);

  const save = () => rpc.call("saveManifest", { manifest }).then(m => (setManifest(m), setNotice("Saved.")), e => setNotice(message(e)));
  const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => setNotice(`${what} copied.`), e => setNotice(message(e)));

  return (
    <div className="flex h-full min-h-0 flex-col text-sm">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => nav.toPluginPanel(PAGE, { subPath: "" })}>
          Composer
        </button>
        <span className="text-muted-foreground">/</span>
        <button type="button" className="truncate font-medium hover:underline" onClick={() => nav.toThread(threadId)}>
          {basis.value?.title ?? threadId}
        </button>
        <span className="text-xs text-muted-foreground">
          {c.basis.providerName}
          {c.basis.model === null ? "" : `, ${c.basis.model}`}
          {full ? "" : " · reading the provider's own view…"}
        </span>
        <input
          className="h-7 w-56 rounded-md border border-input bg-transparent px-2 text-xs"
          value={manifest.title}
          onChange={e => setManifest({ ...manifest, title: e.target.value, updatedAt: now() })}
          aria-label="Manifest title"
        />
        <select className="h-7 rounded-md border border-input bg-transparent px-1 text-xs" value={target.id} onChange={e => setTargetId(e.target.value)} aria-label="Compile target">
          {TARGETS.map(x => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <button type="button" className="rounded px-2 py-1 hover:bg-state-hover" onClick={refresh}>
            Refresh
          </button>
          <button type="button" className="rounded px-2 py-1 hover:bg-state-hover" onClick={() => setManifest({ ...manifest, decisions: {}, updatedAt: now() })}>
            Reset
          </button>
          <button type="button" className="rounded px-2 py-1 hover:bg-state-hover" onClick={() => copy([...kbSchemaCommands(), "", kbOutline(c, manifest, target, manifest.title)].join("\n"), "kb outline and schema")}>
            Copy for kb
          </button>
          <button type="button" className="rounded bg-foreground px-2 py-1 text-background hover:bg-foreground/90" onClick={save}>
            Save
          </button>
        </div>
      </header>
      {notice !== null ? (
        <p className="border-b border-border px-4 py-1 text-xs text-muted-foreground" onClick={() => setNotice(null)}>
          {notice}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-auto p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
            {VIEWS.map(v => (
              <button key={v.id} type="button" aria-pressed={viewId === v.id} onClick={() => setViewId(v.id)} className="rounded px-2 py-1 hover:bg-state-hover aria-pressed:bg-state-active">
                {v.label}
              </button>
            ))}
            <span className="ml-auto tabular-nums text-muted-foreground">
              {n(t.included)} tok kept at start · {n(t.onDemand)} on demand · {n(t.excluded)} dropped{t.unknownWeight > 0 ? ` · ${t.unknownWeight} unweighed` : ""}
              {c.context === null ? "" : ` · thread uses ${n(c.context.usedTokens)} of ${n(c.context.window)}`}
            </span>
          </div>
          {c.problems.length > 0 ? <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">{c.problems.join(" · ")}</p> : null}
          <View
            composition={c}
            manifest={manifest}
            target={target}
            leverOf={leverOf}
            toggle={a => setManifest(m => decide(m, a, m.decisions[a.id] === undefined ? (a.active ? "exclude" : "include") : a.active ? "include" : "exclude", now()))}
            toggleSource={s => setManifest(m => decideSource(m, c, s.id, now()))}
          />
        </main>
        <aside className="flex w-[420px] shrink-0 flex-col gap-4 overflow-auto border-l border-border p-4">
          <PlanCard plan={plan} target={target} removed={d.removed.length} added={d.added.length} copy={copy} />
          <section className="flex flex-col gap-1">
            <h3 className="text-xs font-medium">Add instructions</h3>
            <textarea
              className="min-h-20 rounded-md border border-input bg-transparent p-2 text-xs"
              placeholder="Text every agent started from this composition gets (enforced: bb appends it to the system prompt)."
              value={manifest.additions.instructions}
              onChange={e => setManifest({ ...manifest, additions: { instructions: e.target.value }, updatedAt: now() })}
            />
          </section>
          {basis.value !== null ? <SpawnCard rpc={rpc} basis={basis.value} manifest={manifest} onSpawned={id => nav.toThread(id)} setNotice={setNotice} /> : null}
          <Advisor rpc={rpc} threadId={threadId} manifest={manifest} composition={c} apply={setManifest} setNotice={setNotice} />
        </aside>
      </div>
    </div>
  );
}

function PlanCard({ plan, target, removed, added, copy }: { plan: Plan; target: Target; removed: number; added: number; copy: (text: string, what: string) => void }) {
  const cli = commandLine(target, plan, "<your prompt>");
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border p-3 text-xs">
      <h3 className="font-medium">On {target.label}</h3>
      <p className="text-muted-foreground">
        {removed} dropped, {added} added: {plan.counts.enforced} enforced, {plan.counts.advisory} advisory, {plan.counts.none} cannot change. Additions: {target.additions.enforcement}{" "}
        ({target.additions.via}).
      </p>
      {Object.keys(plan.env).length > 0 ? (
        <div>
          <div className="text-muted-foreground">Env {target.surface === "bb" ? "the plugin contributes to the thread" : "for the command"}:</div>
          <code className="block break-all">{Object.entries(plan.env).map(([k, v]) => `${k}=${v}`).join(" ")}</code>
        </div>
      ) : null}
      {plan.steps.length > 0 ? (
        <ul className="max-h-40 overflow-auto">
          {plan.steps.map(s => (
            <li key={s.artifact.id} className="flex items-center gap-1">
              <span>{s.change === "remove" ? "−" : "+"}</span>
              <span className="truncate">{s.artifact.name}</span>
              <span className="ml-auto">
                <LeverBadge lever={s.lever} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {plan.warnings.map(w => (
        <p key={w} className="text-amber-600 dark:text-amber-400">
          {w}
        </p>
      ))}
      {target.notes.map(note => (
        <p key={note} className="text-muted-foreground">
          {note}
        </p>
      ))}
      {plan.instructions !== "" ? (
        <details>
          <summary className="cursor-pointer text-muted-foreground">Instruction text ({plan.instructions.length} chars)</summary>
          <pre className="whitespace-pre-wrap">{plan.instructions}</pre>
        </details>
      ) : null}
      {cli !== null ? (
        <button type="button" className="self-start rounded border border-border px-2 py-1 hover:bg-state-hover" onClick={() => copy(cli, "Command")}>
          Copy command
        </button>
      ) : null}
    </section>
  );
}

function SpawnCard({ rpc, basis, manifest, onSpawned, setNotice }: { rpc: Rpc; basis: BasisInfo; manifest: Manifest; onSpawned: (id: string) => void; setNotice: (s: string) => void }) {
  const [value, setValue] = useState<PickerValue>({ providerId: basis.providerId, model: basis.model ?? "", reasoningLevel: "medium" });
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const target = bbTargetFor(value.providerId);
  const spawn = () => {
    setBusy(true);
    rpc
      .call("spawn", {
        basisThreadId: basis.threadId,
        manifest,
        prompt,
        providerId: value.providerId,
        model: value.model,
        reasoningLevel: value.reasoningLevel,
        ...(value.serviceTier === undefined ? {} : { serviceTier: value.serviceTier }),
      })
      .then(
        r => onSpawned(r.threadId),
        e => setNotice(message(e)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border p-3 text-xs">
      <h3 className="font-medium">Start a thread with this context</h3>
      <ProviderModelPicker value={value} onChange={setValue} routing={basis.environmentId === null ? undefined : { kind: "environment", environmentId: basis.environmentId }} />
      <p className="text-muted-foreground">
        Compiles for {target.label}, in the same workspace. The new thread starts without this thread's conversation.
      </p>
      <textarea className="min-h-16 rounded-md border border-input bg-transparent p-2" placeholder="First prompt" value={prompt} onChange={e => setPrompt(e.target.value)} />
      <button type="button" disabled={busy || prompt.trim() === "" || value.model === ""} className="self-start rounded bg-foreground px-2 py-1 text-background disabled:opacity-50" onClick={spawn}>
        {busy ? "Starting…" : "Spawn"}
      </button>
    </section>
  );
}

/** The trajectory side chat: a hidden advisor thread, briefed with the composition and the thread's recent messages. */
function Advisor({ rpc, threadId, manifest, composition, apply, setNotice }: { rpc: Rpc; threadId: string; manifest: Manifest; composition: Composition; apply: (m: Manifest) => void; setNotice: (s: string) => void }) {
  const [advisorId, setAdvisorId] = useState<string | null>(null);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const start = (restart: boolean) => {
    setBusy(true);
    rpc
      .call("advisor", { basisThreadId: threadId, manifest, goal, restart })
      .then(r => setAdvisorId(r.threadId), e => setNotice(message(e)))
      .finally(() => setBusy(false));
  };
  const close = () => rpc.call("closeAdvisor", { basisThreadId: threadId }).then(() => setAdvisorId(null), e => setNotice(message(e)));
  return (
    <section className="flex min-h-0 flex-col gap-2 rounded-md border border-border p-3 text-xs">
      <h3 className="font-medium">Trajectory</h3>
      {advisorId === null ? (
        <>
          <p className="text-muted-foreground">
            A side chat (a hidden thread on this thread's provider) gets the composition, the manifest and the thread's recent messages. Ask what this context will do to the
            trajectory, or describe the trajectory you want; apply its proposals with one click.
          </p>
          <textarea className="min-h-12 rounded-md border border-input bg-transparent p-2" placeholder="Optional: the trajectory you want" value={goal} onChange={e => setGoal(e.target.value)} />
          <button type="button" disabled={busy} className="self-start rounded border border-border px-2 py-1 hover:bg-state-hover disabled:opacity-50" onClick={() => start(false)}>
            {busy ? "Starting…" : "Ask"}
          </button>
        </>
      ) : (
        <>
          <div className="h-[460px] min-h-0">
            <ThreadChat
              threadId={advisorId}
              variant="compact"
              messageActions={[
                {
                  id: "apply-proposal",
                  title: "Apply proposal",
                  icon: "Check",
                  roles: ["assistant"],
                  run: msg => {
                    const proposals = parseProposals(msg.text);
                    if (proposals.length === 0) return setNotice("No composer-proposal block in that message.");
                    let m = manifest;
                    const ignored: string[] = [];
                    for (const p of proposals) {
                      const r = applyProposal(m, composition, p, Date.now());
                      m = r.manifest;
                      ignored.push(...r.ignored);
                    }
                    apply(m);
                    setNotice(`Applied ${proposals.length} proposal(s)${ignored.length > 0 ? `; ignored ${ignored.length} unknown or fixed id(s)` : ""}.`);
                  },
                },
              ]}
            />
          </div>
          <div className="flex gap-2">
            <button type="button" className="rounded border border-border px-2 py-1 hover:bg-state-hover" onClick={() => start(true)}>
              Restart with current manifest
            </button>
            <button type="button" className="rounded px-2 py-1 text-muted-foreground hover:bg-state-hover" onClick={close}>
              Close
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ the thread shortcut

function ThreadShortcut({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const nav = useBbNavigate();
  const c = useAsync(() => rpc.call("compose", { threadId }), [rpc, threadId]);
  const heaviest = (c.value?.artifacts ?? []).filter(a => a.active).sort((a, b) => (b.tokens.value ?? 0) - (a.tokens.value ?? 0)).slice(0, 6);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <button type="button" className="self-start rounded bg-foreground px-3 py-1.5 text-background" onClick={() => nav.toPluginPanel(PAGE, { subPath: `thread/${threadId}` })}>
        Open in the composer
      </button>
      {c.error !== null ? <p className="text-destructive">{c.error}</p> : null}
      {c.value !== null ? (
        <>
          <p className="text-muted-foreground">
            {c.value.artifacts.filter(a => a.active).length} artifacts feed this thread's agent. Heaviest:
          </p>
          <ul className="text-xs">
            {heaviest.map(a => (
              <li key={a.id} className="flex gap-2">
                <span className="truncate">{a.name}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">{a.tokens.value === null ? "?" : n(a.tokens.value)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

// GAP [[01M5QKD89DMW3BR5RS6SYZD3RJ]] this page, spawn and the advisor have only run in the fake plugin host.
export default definePluginApp(app => {
  app.slots.navPanel({ id: "composer", title: "Context composer", icon: "Layers", path: PAGE, component: ComposerPage });
  app.slots.threadPanelAction({
    id: "compose",
    title: "Compose context",
    icon: "Layers",
    layout: "padded",
    component: ThreadShortcut,
    run: ({ openPanel }) => {
      openPanel({ title: "Compose context" });
    },
  });
});
