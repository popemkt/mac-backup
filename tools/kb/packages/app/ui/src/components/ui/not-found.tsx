import { WorkspaceState } from "@/components/ui/workspace-state";
import { navigate } from "@/lib/router";

/**
 * The one not-found state, for every route: a path no surface owns, and an
 * id a surface owns the shape of but the workspace does not hold (a canvas,
 * an ontology, a graph perspective). It draws no chrome of the thing it did
 * not find, and always offers one way back.
 */
export function NotFound({
  what,
  id,
  back,
}: {
  /** What was looked for, capitalised: "Page", "Canvas", "Ontology". */
  what: string;
  /** The id the URL named, when it named one. */
  id?: string;
  back: { label: string; path: string };
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12" data-not-found={what}>
      <WorkspaceState
        title={`${what} not found`}
        description={
          id === undefined
            ? "Nothing in this workspace lives at this address."
            : `“${id}” is not in this workspace.`
        }
      />
      <button
        type="button"
        className="rounded-md border border-foreground/10 px-3 py-1.5 text-meta text-foreground transition-colors hover:bg-foreground/5"
        onClick={() => navigate(back.path)}
      >
        {back.label}
      </button>
    </div>
  );
}
