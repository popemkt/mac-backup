import type { Placement } from "../lib/plugins";
import { WorkspaceState } from "./workspace-state";

const TITLE = "This view cannot be shown here";

/**
 * The one "cannot be shown here" state, saying why, drawn at the placement of
 * the slot it stands in for: a workspace state where a page would be, one line
 * among the rows where an inline view would be.
 */
export function ViewUnavailable({
  why,
  placement,
}: {
  readonly why: string;
  readonly placement: Placement;
}) {
  if (placement === "inline")
    return (
      <p className="px-1 py-0.5 text-meta text-foreground/50" data-view-unavailable="true">
        {`${TITLE}. ${why}`}
      </p>
    );
  return <WorkspaceState title={TITLE} description={why} />;
}

/** That state for a view named `label` that this page holds no key for. */
export function ViewNotLoaded({
  label,
  placement,
}: {
  readonly label: string;
  readonly placement: Placement;
}) {
  return (
    <ViewUnavailable
      why={`${label}: its plugin is not loaded, or a pane around it already shows it.`}
      placement={placement}
    />
  );
}
