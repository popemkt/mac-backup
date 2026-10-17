/**
 * A call a sandboxed run made that needs a person's approval (DESIGN.md →
 * Sandbox → Grants and the script actor): the action and its input, and
 * the person's answer. Approve once makes the same call as the run's with
 * `approved`; Decline makes it without, so the invoke core refuses it
 * again and the run is told so (`useSandboxPorts`).
 */
import { cn } from "../lib/cn";
import type { Asking } from "../sandbox-run";

const BUTTON = cn(
  "rounded-sm px-2 py-1 text-label font-medium outline-none transition duration-100",
  "focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-default disabled:opacity-40",
);

export function SandboxApprovalCard({ asking }: { readonly asking: Asking }) {
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
