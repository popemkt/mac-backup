import { Suspense, type ReactNode } from "react";
import { WorkspaceState } from "@/components/ui/workspace-state";

/** Data and lazy code share one loading surface, then one undelayed reveal. */
export function WorkspaceBoundary({
  title,
  pending = false,
  children,
}: {
  title: string;
  pending?: boolean;
  children: ReactNode;
}) {
  const fallback = <WorkspaceState title={title} loading />;
  if (pending) return fallback;
  return (
    <Suspense fallback={fallback}>
      <div className="kb-workspace-reveal flex h-full min-h-0 flex-1 flex-col">{children}</div>
    </Suspense>
  );
}
