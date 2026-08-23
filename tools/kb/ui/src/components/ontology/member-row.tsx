import { ArrowUUpLeft, PushPin, PushPinSlash, X } from "@phosphor-icons/react";
import { describeReason } from "@kb/ontology";
import { cn } from "@/lib/cn";
import type { MemberRowModel } from "@/lib/ontology-scope";

export interface MemberRowProps {
  row: MemberRowModel;
  /** id → display label, for provenance ("via #service"). */
  labelOf: (id: string) => string;
  onOpen?: (id: string) => void;
  onPin?: (id: string) => void;
  onUnpin?: (id: string) => void;
  onExclude?: (id: string) => void;
  onRestore?: (id: string) => void;
  /** Excluded rows render muted with a single Restore affordance. */
  excluded?: boolean;
}

/**
 * One member of an ontology, with its provenance.
 *
 * Provenance is load-bearing: a hybrid membership model (tags + query +
 * explicit + inherited) is unusable unless every row can answer "why am I
 * here?". Removing a tag-derived member says so out loud, because silently
 * untagging a node from a lens is the kind of surprise that destroys trust.
 */
export function MemberRow({
  row,
  labelOf,
  onOpen,
  onPin,
  onUnpin,
  onExclude,
  onRestore,
  excluded = false,
}: MemberRowProps) {
  const provenance = excluded
    ? "excluded"
    : row.reasons.map((r) => describeReason(r, labelOf)).join(" · ") ||
      "member";
  const derived = row.reasons.some((r) => r.kind !== "member");

  return (
    <div
      className={cn(
        "group/member flex h-7 items-center gap-2 rounded-md px-1.5",
        "transition-colors duration-100 hover:bg-foreground/[0.03]",
      )}
      data-member-id={row.id}
      data-member-excluded={excluded ? "true" : undefined}
    >
      <span
        aria-hidden
        className={cn(
          "shrink-0 text-[10px] leading-none",
          excluded ? "text-foreground/20" : "text-foreground/35",
        )}
      >
        {excluded ? "◌" : "⬤"}
      </span>

      <button
        type="button"
        className={cn(
          "min-w-0 flex-1 truncate text-left text-[13px]",
          excluded
            ? "text-foreground/35 line-through decoration-foreground/20"
            : "text-foreground/80 hover:text-foreground",
        )}
        title={row.id}
        onClick={() => onOpen?.(row.id)}
      >
        {row.label}
      </button>

      <span
        className={cn(
          "shrink-0 truncate text-[11px]",
          excluded ? "text-foreground/25" : "text-foreground/35",
        )}
        data-member-provenance="true"
      >
        {provenance}
      </span>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover/member:opacity-100 focus-within:opacity-100">
        {excluded ? (
          <IconButton
            label={`Restore ${row.label}`}
            onClick={() => onRestore?.(row.id)}
          >
            <ArrowUUpLeft size={12} weight="bold" />
          </IconButton>
        ) : (
          <>
            {row.pinned ? (
              <IconButton
                label={`Unpin ${row.label}`}
                title="Pinned explicitly — unpin to keep only derived membership"
                onClick={() => onUnpin?.(row.id)}
              >
                <PushPinSlash size={12} weight="bold" />
              </IconButton>
            ) : (
              <IconButton
                label={`Pin ${row.label}`}
                title="Pin: stay a member even if the tag is removed"
                onClick={() => onPin?.(row.id)}
              >
                <PushPin size={12} weight="bold" />
              </IconButton>
            )}
            <IconButton
              label={`Exclude ${row.label}`}
              title={
                derived
                  ? "Exclude here only — the node keeps its tags"
                  : "Exclude from this ontology"
              }
              onClick={() => onExclude?.(row.id)}
            >
              <X size={12} weight="bold" />
            </IconButton>
          </>
        )}
      </div>

      {row.pinned && !excluded ? (
        <span
          aria-hidden
          className="shrink-0 text-[10px] text-foreground/25 group-hover/member:hidden"
          title="Pinned"
        >
          <PushPin size={11} weight="fill" />
        </span>
      ) : null}
    </div>
  );
}

function IconButton({
  label,
  title,
  onClick,
  children,
}: {
  label: string;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      className="flex h-5 w-5 items-center justify-center rounded-sm text-foreground/40 transition-colors duration-100 hover:bg-foreground/5 hover:text-foreground/70"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
