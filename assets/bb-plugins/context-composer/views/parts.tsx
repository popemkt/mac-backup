// Small pieces the views share.
import type { Artifact } from "../core/model.ts";
import type { Enforcement, Lever } from "../core/targets.ts";

export const tokensLabel = (a: Artifact): string =>
  a.tokens.value === null
    ? "? tok"
    : `${a.tokens.basis === "estimated" ? "~" : ""}${a.tokens.value.toLocaleString("en-US")} tok${a.deferred === true ? " on demand" : ""}`;

const TONE: Record<Enforcement, string> = {
  enforced: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  advisory: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  none: "border-border text-muted-foreground",
};

/** What removing it does on the target: enforced, advisory or none, with how in the tooltip. */
export function LeverBadge({ lever }: { lever: Lever }) {
  return (
    <span className={`shrink-0 rounded border px-1 text-[10px] leading-4 ${TONE[lever.enforcement]}`} title={lever.via}>
      {lever.enforcement}
      {lever.experimental === true ? "*" : ""}
    </span>
  );
}
