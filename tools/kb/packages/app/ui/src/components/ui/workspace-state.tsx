/** Decorative node character. Its motion finishes; it never holds up readiness. */
function NodeCompanion() {
  return (
    <div className="kb-companion" aria-hidden="true">
      <svg className="kb-companion-thread" viewBox="0 0 160 120" fill="none">
        <path d="M24 78C4 105 71 110 58 69S116 23 136 43" />
        <circle cx="136" cy="43" r="4" />
      </svg>
      <div className="kb-companion-shadow" />
      <div className="kb-companion-body">
        <div className="kb-companion-face">
          <span className="kb-companion-eye" />
          <span className="kb-companion-eye" />
        </div>
      </div>
      <div className="kb-companion-satellite" />
    </div>
  );
}

/** One presentation for a workspace waiting for data or its first content. */
export function WorkspaceState({
  title,
  description,
  loading = false,
}: {
  title: string;
  description?: string;
  loading?: boolean;
}) {
  return (
    <div className="kb-workspace-state">
      <NodeCompanion />
      <div role={loading ? "status" : undefined} aria-live={loading ? "polite" : undefined}>
        <p className="text-[13px] font-medium text-foreground/75">{title}</p>
        {description !== undefined && description !== "" ? (
          <p className="mx-auto mt-1.5 max-w-xs text-[12px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
