/**
 * The host that runs a view's scripts (DESIGN.md → Sandbox → Scripts;
 * DESIGN-UI.md → Scripts): the `#script` nodes the view's subjects name
 * (`sys.f.scripts`), each run on the page's one sandbox runner with its node
 * as `kb.subject`, hearing the events the view declares. A script a person
 * has not trusted never runs: it is listed with its code and grant, and
 * trusting it is the person's gesture. A call that asks is a card, as in a
 * code view. Each running script's frame lies over the whole view, see-through
 * and letting every gesture pass, so what it draws stands over the view —
 * on the view's things where it names them (`data-anchor`, `ViewAnchors`).
 * The code family provides it to every view (`ScriptHostService`).
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { CodeIcon } from "@phosphor-icons/react";
import { scriptIdsOf, scriptOf, type ScriptSource } from "@kb/code";
import { ENGINE_LIMITS, engineKindFor, type RunStatus } from "@kb/sandbox";
import {
  browserHost,
  cn,
  logError,
  logWarn,
  toast,
  useGeneration,
  useNode,
  useNodes,
  useSandboxPorts,
  useSandboxTrust,
  SandboxApprovalCard,
  SandboxFrame,
  type ScriptHostProps,
  type SandboxEvents,
  type SandboxRun,
} from "@kb/ui-sdk";

/** One script attached to one subject: what runs, and the node it runs for. */
interface Attached {
  readonly subject: string;
  readonly script: string;
}

/** How a script stands, in a few words. */
function stateText(trusted: boolean | null, status: RunStatus | null): string {
  if (trusted === null) return "Checking…";
  if (!trusted) return "Not trusted: it does not run";
  if (status === null) return "Starting…";
  if (status.state === "running") return "Running";
  return status.end.message;
}

/** The quiet button a script row's gestures share. */
function RowButton({
  title,
  onClick,
  children,
  ...rest
}: {
  readonly title?: string;
  readonly onClick: () => void;
  readonly children: string;
  readonly "aria-expanded"?: boolean;
}) {
  return (
    <button
      type="button"
      className="shrink-0 rounded-sm px-1.5 py-0.5 text-label text-foreground/55 hover:bg-foreground/5"
      title={title}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}

/** What a row needs beyond its script: the view's channels, and the layer over the view its frame lies in. */
type RowProps = Omit<ScriptHostProps, "subjects"> & { readonly overlay: HTMLElement | null };

// GAP [[01M54DFMDJFYRDM8ZZXQB749PQ]] canvas script overlays take no gestures: the frame lets every one pass
function ScriptRow({
  subject,
  script,
  view,
  events,
  anchors,
  overlay,
}: { readonly subject: string; readonly script: ScriptSource } & RowProps) {
  const generation = useGeneration();
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [open, setOpen] = useState(false);
  const { trust, refresh } = useSandboxTrust(script.code, script.grant);
  const { ports, asking } = useSandboxPorts();
  const [told] = useState<SandboxEvents>(() => ({
    status: setStatus,
    log: (level, text) =>
      (level === "error" ? logError : logWarn)(`[script ${script.label} ${level}] ${text}`),
  }));
  const engine = engineKindFor(true);
  const run: SandboxRun = {
    input: {
      code: script.code,
      subject,
      events: view.events,
      engine,
      limits: ENGINE_LIMITS[engine],
    },
    grant: script.grant,
  };
  const setTrusted = async (trusted: boolean) => {
    if (trust === null) return;
    const receipt = await browserHost().sandbox.setTrusted(trust.digest, trusted);
    if (receipt.status === "failed") toast(receipt.message);
    setStatus(null);
    refresh();
  };
  /** Run it once more against its node, where kb runs code (`ext.code.script.run`), as the person. */
  const runOnce = async () => {
    const receipt = await browserHost().invoke("ext.code.script.run", {
      script: script.id,
      subject,
    });
    if (receipt.status === "failed") toast(receipt.message);
  };
  const { reads, actions } = script.grant;
  return (
    <li
      className="flex flex-col gap-1"
      data-script={script.id}
      data-script-trust={trust === null ? "checking" : trust.trusted ? "trusted" : "untrusted"}
    >
      <div className="flex items-center gap-2">
        <CodeIcon size={12} className="shrink-0 text-foreground/40" aria-hidden />
        <span className="min-w-0 truncate text-label text-foreground/80">{script.label}</span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-label",
            status?.state === "ended" ? "text-destructive" : "text-muted-foreground",
          )}
          role="status"
        >
          {stateText(trust?.trusted ?? null, status)}
        </span>
        <RowButton aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Review"}
        </RowButton>
        {trust?.trusted === true ? (
          <RowButton
            title="Run it once more against this node, from the start"
            onClick={() => void runOnce()}
          >
            Run once
          </RowButton>
        ) : null}
        {trust === null ? null : (
          <RowButton
            title={
              trust.trusted
                ? "Stop it, and run it no more until it is trusted again"
                : "You have read this script: run it here, with its grant"
            }
            onClick={() => void setTrusted(!trust.trusted)}
          >
            {trust.trusted ? "Stop trusting" : "Trust"}
          </RowButton>
        )}
      </div>
      {open ? (
        <div className="flex flex-col gap-1">
          <p className="text-label text-muted-foreground">
            It reads {reads === "none" ? "nothing" : `its ${reads}`} and may call{" "}
            {actions.length === 0 ? "no other action" : actions.join(", ")}.
          </p>
          <pre className="max-h-40 overflow-auto rounded-sm border border-foreground/10 bg-background p-2 font-mono text-label text-foreground">
            {script.code}
          </pre>
        </div>
      ) : null}
      {/* An untrusted script never runs; a trusted one runs, over the view, while it is shown. */}
      {trust?.trusted === true && overlay !== null
        ? createPortal(
            <SandboxFrame
              run={run}
              ports={ports}
              events={told}
              generation={generation}
              title={`${script.label}, a sandboxed script`}
              listen={events.listen}
              anchored={anchors.listen}
              className="pointer-events-none absolute inset-0 size-full border-0 bg-transparent"
            />,
            overlay,
            trust.digest,
          )
        : null}
      {asking[0] === undefined ? null : <SandboxApprovalCard asking={asking[0]} />}
    </li>
  );
}

/** One attached script by its node; nothing while the node is not a script kb can run. */
function AttachedScript({ attached, ...rest }: { readonly attached: Attached } & RowProps) {
  const node = useNode(attached.script);
  const script = node === undefined ? null : scriptOf(node);
  return script === null ? null : (
    <ScriptRow subject={attached.subject} script={script} {...rest} />
  );
}

export function ScriptsHost({ subjects, view, events, anchors }: ScriptHostProps) {
  const nodes = useNodes();
  const [overlay, setOverlay] = useState<HTMLElement | null>(null);
  const attached: Attached[] = subjects.flatMap((subject) =>
    scriptIdsOf(nodes.get(subject)).map((script) => ({ subject, script })),
  );
  if (attached.length === 0) return null;
  return (
    <>
      <div
        ref={setOverlay}
        className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
        data-script-overlays="true"
      />
      <section
        aria-label="Scripts"
        className="pointer-events-auto absolute bottom-3 left-3 z-20 w-80 max-w-[calc(100%-1.5rem)] rounded-md border border-foreground/10 bg-popover/95 p-2 shadow-raised"
        data-scripts-host="true"
      >
        <ul className="flex flex-col gap-1.5">
          {attached.map((one) => (
            <AttachedScript
              key={`${one.subject}:${one.script}`}
              attached={one}
              view={view}
              events={events}
              anchors={anchors}
              overlay={overlay}
            />
          ))}
        </ul>
      </section>
    </>
  );
}
