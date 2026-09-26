import { lazy, useEffect, useMemo, useState } from "react";
import { HexagonIcon, PlusIcon } from "@phosphor-icons/react";
import { mutations } from "@/actions/mutations";
import { OntologyScopeBar } from "@/components/ontology/ontology-scope-bar";
import { ONTOLOGY_LIST_SURFACE, ONTOLOGY_SURFACE, viewOf } from "@/components/ontology/routes";
import { isOntologyNode } from "@kb/model";
import { ContributedSurface } from "@/components/ui/contributed-surface";
import { NotFound } from "@/components/ui/not-found";
import { SidebarRow, SidebarSection } from "@/components/ui/sidebar-row";
import { ViewErrorBoundary } from "@/components/view-error-boundary";
import type { MatchedRoute, SurfaceParams } from "@/lib/plugins";
import { navigate, ontologyPath } from "@/lib/router";
import { listOntologyNavItems } from "@/lib/sidebar-nav";
import { textOr } from "@/lib/text";
import { useOutlineStore } from "@/stores/outline.store";

/** Other plugins' surfaces this one embeds, by id (the kernel resolves them). */
const GRAPH_SURFACE = "graph.page";
const OUTLINE_SURFACE = "outline.main";

const OntologyPage = lazy(() =>
  import("@/components/ontology/ontology-page").then((m) => ({ default: m.OntologyPage })),
);
const OntologyListPage = lazy(() =>
  import("@/components/ontology/ontology-list-page").then((m) => ({
    default: m.OntologyListPage,
  })),
);

/** The `#ontology` node the URL names, or undefined when the workspace holds none by that id. */
function useOntologyNode(id: string) {
  const wireNodes = useOutlineStore((s) => s.wireNodes);
  return useMemo(() => wireNodes.find((n) => n.id === id && isOntologyNode(n)), [wireNodes, id]);
}

/** Scope chip fed from the store's resolved membership; none for an ontology that is not there. */
export function OntologyChrome({ params }: { readonly params: SurfaceParams }) {
  const id = params["id"] ?? "";
  const members = useOutlineStore((s) => s.ontologyMembers);
  const warnings = useOutlineStore((s) => s.ontologyWarnings);
  const onto = useOntologyNode(id);
  if (onto === undefined) return null;
  const label = textOr(onto.text.trim(), "Untitled ontology");
  return (
    <OntologyScopeBar
      ontologyId={id}
      label={label}
      memberCount={members?.size ?? 0}
      warnings={warnings}
      view={viewOf(params)}
      onExit={() => navigate("/")}
    />
  );
}

/**
 * An ontology's scope, projected onto the view the URL names. The scope lives
 * in the URL; the store follows it while this surface is mounted. The outline
 * and the graph are other plugins' surfaces, rendered by id.
 */
export function OntologySurface({ params }: { readonly params: SurfaceParams }) {
  const id = params["id"] ?? "";
  const view = viewOf(params);
  const setOntologyScope = useOutlineStore((s) => s.setOntologyScope);
  const exists = useOntologyNode(id) !== undefined;
  useEffect(() => {
    if (!exists) return undefined;
    setOntologyScope(id);
    return () => setOntologyScope(null);
  }, [id, exists, setOntologyScope]);

  if (!exists)
    return <NotFound what="Ontology" id={id} back={{ label: "All ontologies", path: "/o" }} />;
  if (view === "graph") return <ContributedSurface id={GRAPH_SURFACE} params={{ ontology: id }} />;
  return (
    <ViewErrorBoundary title="Ontology crashed" resetKey={`${id}:${view}`}>
      {view === "page" ? (
        <OntologyPage ontologyId={id} />
      ) : (
        <ContributedSurface id={OUTLINE_SURFACE} params={{}} />
      )}
    </ViewErrorBoundary>
  );
}

export function OntologyListSurface() {
  return (
    <ViewErrorBoundary title="Ontologies crashed" resetKey="ontology-list">
      <OntologyListPage />
    </ViewErrorBoundary>
  );
}

export function OntologySection({ route }: { readonly route: MatchedRoute }) {
  const wireNodes = useOutlineStore((s) => s.wireNodes);
  const ontologies = useMemo(() => listOntologyNavItems(wireNodes), [wireNodes]);
  const [creating, setCreating] = useState(false);
  const onNew = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const id = await mutations.defineOntology();
      if (id !== null) navigate(ontologyPath(id));
    } finally {
      setCreating(false);
    }
  };
  return (
    <SidebarSection>
      <SidebarRow
        label="Ontologies"
        icon={<HexagonIcon size={14} />}
        active={route.surface === ONTOLOGY_LIST_SURFACE}
        onClick={() => navigate("/o")}
      />
      {ontologies.map((o) => (
        <SidebarRow
          key={o.id}
          label={o.label}
          indented
          active={route.surface === ONTOLOGY_SURFACE && route.params["id"] === o.id}
          onClick={() => navigate(ontologyPath(o.id))}
        />
      ))}
      <SidebarRow
        label={creating ? "Creating…" : "New ontology"}
        icon={<PlusIcon size={14} />}
        indented
        muted
        onClick={() => void onNew()}
      />
    </SidebarSection>
  );
}
