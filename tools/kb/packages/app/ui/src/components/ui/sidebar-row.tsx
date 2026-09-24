import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { hasText } from "@/lib/text";

/** One sidebar entry. A primitive, so every plugin's section draws the same row. */
export function SidebarRow({
  label,
  icon,
  active,
  indented,
  onClick,
  muted,
}: {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  indented?: boolean;
  onClick: () => void;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-meta transition-colors duration-100",
        indented === true && "pl-7",
        active === true
          ? "bg-foreground/[0.08] text-foreground/85"
          : muted === true
            ? "text-foreground/30 hover:bg-foreground/[0.03] hover:text-foreground/50"
            : "text-foreground/55 hover:bg-foreground/[0.04] hover:text-foreground/75",
      )}
    >
      {icon !== undefined && icon !== null ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

export function SidebarSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      {hasText(title) ? (
        <div className="mb-1 px-2 text-caption font-medium uppercase tracking-wide text-foreground/30">
          {title}
        </div>
      ) : null}
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}
