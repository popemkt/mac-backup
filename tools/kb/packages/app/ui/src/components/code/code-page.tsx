/**
 * The code view (DESIGN-UI.md → Code views): a view node's code, run in a
 * sandbox frame that fills the box its host gives it. Above it, which engine
 * runs it and how the run stands; beside it, the code itself, so a person
 * sees what runs. A write the code makes that asks for a person is asked
 * here, as a card: approving makes the same call, as the script's, with the
 * person's approval.
 */
import { useMemo, useState } from "react";
import { ArrowClockwiseIcon, CodeIcon, ShieldWarningIcon } from "@phosphor-icons/react";
import type { ActionInvocation } from "@kb/contracts";
import { ENGINE_LIMITS, type EngineKind, type RunStatus } from "@kb/sandbox";
import type { CodeParams } from "@kb/views";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";
import { textOr } from "@/lib/text";
import type { ViewProps } from "@/lib/plugins";
import {
  invokeAsScript,
  type SandboxEvents,
  type SandboxPorts,
  type SandboxRun,
} from "@/lib/sandbox-host";
import { logError, logWarn } from "@/lib/log";
import { useOutlineStore } from "@/stores/outline.store";
import { SandboxFrame } from "./sandbox-frame";

const BUTTON = cn(
  "rounded-sm px-2 py-1 text-label font-medium outline-none transition duration-100",
  "focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-default disabled:opacity-40",
);

/** A call the code made that waits for the person's answer. */
interface Asking {
  readonly invocation: ActionInvocation;
  readonly answer: (approved: boolean) => void;
}

const ENGINE_LABEL: Readonly<Record<EngineKind, string>> = {
  quickjs: "Untrusted · QuickJS",
  worker: "Trusted · Worker",
};

/** How a run stands, in a few words. */
function statusText(status: RunStatus | null): string {
  if (status === null) return "Starting…";
  if (status.state === "running") return "Running";
  return status.end.message;
}

function ApprovalCard({ asking }: { readonly asking: Asking }) {
  const { invocation, answer } = asking;
  return (
    <section
      aria-label="The code asks for approval"
      className="mx-3 mb-3 shrink-0 rounded-sm border border-foreground/10 bg-card p-3"
      data-sandbox-approval="true"
    >
      <p className="text-ui text-foreground/80">
        This code asks to run <code className="font-mono">{invocation.id}</code>, which needs your
        approval.
      </p>
      <pre className="mt-2 max-h-32 overflow-auto rounded-sm bg-background p-2 font-mono text-label text-foreground/70">
        {JSON.stringify(invocation.input, null, 2)}
      </pre>
      <div className="mt-2 flex justify-end gap-1">
        <button
          type="button"
          className={cn(BUTTON, "text-foreground/60 hover:bg-foreground/[0.06]")}
          onClick={() => answer(false)}
        >
          Decline
        </button>
        <button
          type="button"
          className={cn(BUTTON, "bg-primary text-primary-foreground hover:bg-primary/90")}
          onClick={() => answer(true)}
        >
          Approve once
        </button>
      </div>
    </section>
  );
}

function CodePanel({ params }: { readonly params: CodeParams }) {
  const { reads, actions } = params.grant;
  return (
    <section
      aria-label="The code this view runs"
      className="flex max-h-[45%] min-h-32 shrink-0 flex-col border-t border-foreground/10 bg-card"
      data-sandbox-code="true"
    >
      <p className="px-3 pt-2 pb-1.5 text-label text-muted-foreground">
        It reads {reads === "none" ? "nothing" : `its ${reads}`} and may call{" "}
        {actions.length === 0 ? "no other action" : actions.join(", ")}.
      </p>
      <pre className="mx-3 mb-3 min-h-0 flex-1 overflow-auto rounded-sm border border-foreground/10 bg-background p-2 font-mono text-label leading-relaxed text-foreground">
        {params.code}
      </pre>
    </section>
  );
}

export function CodePage({ params, host }: ViewProps<CodeParams>) {
  const viewNode = useOutlineStore((s) =>
    host.viewNode === undefined ? undefined : s.nodes.get(host.viewNode),
  );
  const generation = useOutlineStore((s) => s.index?.generation ?? 0);
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [round, setRound] = useState(0);
  const [asking, setAsking] = useState<readonly Asking[]>([]);
  const engine: EngineKind = "quickjs";
  const title = textOr(viewNode?.text.trim(), "Code");

  const run: SandboxRun = useMemo(
    () => ({
      input: {
        code: params.code,
        subject: params.source ?? null,
        engine,
        limits: ENGINE_LIMITS[engine],
      },
      grant: params.grant,
    }),
    [params.code, params.source, params.grant],
  );

  // Stable for the page's life: a frame reads its ports and events once.
  const [ports] = useState<SandboxPorts>(() => ({
    node: (id) => useOutlineStore.getState().nodes.get(id),
    invoke: async (invocation) => {
      const receipt = await invokeAsScript(invocation);
      if (receipt.status !== "failed" || receipt.code !== "approval_required") return receipt;
      const approved = await new Promise<boolean>((resolve) => {
        const entry: Asking = {
          invocation,
          answer: (answer) => {
            setAsking((queue) => queue.filter((waiting) => waiting !== entry));
            resolve(answer);
          },
        };
        setAsking((queue) => [...queue, entry]);
      });
      // Declining is the same call without approval: the invoke core refuses it again.
      return invokeAsScript(approved ? { ...invocation, approved: true } : invocation);
    },
  }));
  const [events] = useState<SandboxEvents>(() => ({
    status: setStatus,
    // The code's console, in the page's: the one log seam the UI has.
    log: (level, text) => (level === "error" ? logError : logWarn)(`[code ${level}] ${text}`),
  }));

  const ended = status?.state === "ended";
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-code-view="true">
      <header className="flex h-9 shrink-0 items-center gap-2 px-3">
        <CodeIcon size={14} className="shrink-0 text-foreground/40" aria-hidden />
        <h2 className="min-w-0 truncate text-ui font-medium text-foreground/80">{title}</h2>
        <span
          className="flex shrink-0 items-center gap-1 text-label text-muted-foreground"
          data-sandbox-engine={engine}
        >
          <ShieldWarningIcon size={12} aria-hidden />
          {ENGINE_LABEL[engine]}
        </span>
        <span
          className={cn(
            "min-w-0 truncate text-label",
            ended ? "text-destructive" : "text-muted-foreground",
          )}
          role="status"
          data-sandbox-status={status?.state ?? "starting"}
        >
          {statusText(status)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            label="Run again"
            icon={ArrowClockwiseIcon}
            size="md"
            onClick={() => {
              setStatus(null);
              setRound(round + 1);
            }}
          />
          <IconButton
            label={showCode ? "Hide the code" : "Show the code"}
            icon={CodeIcon}
            size="md"
            aria-pressed={showCode}
            onClick={() => setShowCode(!showCode)}
          />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
        <SandboxFrame
          key={`${String(round)}:${engine}:${params.source ?? ""}:${params.code}:${JSON.stringify(params.grant)}`}
          run={run}
          ports={ports}
          events={events}
          generation={generation}
          title={`${title}, sandboxed`}
        />
      </div>
      {asking[0] === undefined ? null : <ApprovalCard asking={asking[0]} />}
      {showCode ? <CodePanel params={params} /> : null}
    </div>
  );
}
