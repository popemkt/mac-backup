import { WorkspaceState } from "./workspace-state";

/** The one "cannot be shown here" state, saying why. */
export function ViewUnavailable({ why }: { readonly why: string }) {
  return <WorkspaceState title="This view cannot be shown here" description={why} />;
}

/** That state for a view named `label` that this page holds no key for. */
export function ViewNotLoaded({ label }: { readonly label: string }) {
  return (
    <ViewUnavailable
      why={`${label}: its plugin is not loaded, or a pane around it already shows it.`}
    />
  );
}
