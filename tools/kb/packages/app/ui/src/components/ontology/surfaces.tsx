import { lazy, useEffect, useMemo, useState } from "react";
import { Result } from "effect";
import { HexagonIcon, PlusIcon } from "@phosphor-icons/react";
import { OntologyScopeBar } from "@/components/ontology/ontology-scope-bar";
import {
  OntologyListView,
  OntologyScopeView,
  type OntologyScopeParams,
  paramsFrom,
  resolveDefaultViewType,
  viewNamed,
} from "@kb/views";
import { isOntologyNode } from "@kb/model";
import {
  browserHost,
  listOntologyItems,
  logWarn,
  type MatchedRoute,
  navigate,
  NotFound,
  ontologyPath,
  paramsOf,
  schemaOf,
  SidebarRow,
  SidebarSection,
  textOr,
  ViewErrorBoundary,
  type ViewProps,
  ViewSlot,
  ViewNotLoaded,
} from "@kb/ui-sdk";
import { usePageCatalog } from "@/lib/view-catalog";
import { useGraphStore } from "@/stores/graph.store";

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
  const wireNodes = useGraphStore((s) => s.wireNodes);
  return useMemo(() => wireNodes.find((n) => n.id === id && isOntologyNode(n)), [wireNodes, id]);
}

/** Scope chip fed from the store's resolved membership; none for an ontology that is not there. */
export function OntologyChrome({ params }: { readonly params: OntologyScopeParams }) {
  const { id } = params;
  const members = useGraphStore((s) => s.ontologyMembers);
  const warnings = useGraphStore((s) => s.ontologyWarnings);
  const onto = useOntologyNode(id);
  if (onto === undefined) return null;
  const label = textOr(onto.text.trim(), "Untitled ontology");
  return (
    <OntologyScopeBar
      ontologyId={id}
      label={label}
      memberCount={members?.size ?? 0}
      warnings={warnings}
      view={params.view}
      onExit={() => navigate("/")}
    />
  );
}

/**
 * An ontology's scope, projected onto the view the URL names. The scope lives
 * in the URL; the store follows it while this view is mounted. The outline
 * and the graph are other plugins' views, embedded by key.
 */
export function OntologySurface({ params }: ViewProps<OntologyScopeParams>) {
  const { id, view } = params;
  const setOntologyScope = useGraphStore((s) => s.setOntologyScope);
  const exists = useOntologyNode(id) !== undefined;
  useEffect(() => {
    if (!exists) return undefined;
    setOntologyScope(id);
    return () => setOntologyScope(null);
  }, [id, exists, setOntologyScope]);

  if (!exists)
    return <NotFound what="Ontology" id={id} back={{ label: "All ontologies", path: "/o" }} />;
  if (view === "graph") return <OntologyGraph ontologyId={id} />;
  return (
    <ViewErrorBoundary title="Ontology crashed" resetKey={`${id}:${view}`}>
      {view === "page" ? <OntologyPage ontologyId={id} /> : <ScopeDefaultView ontologyId={id} />}
    </ViewErrorBoundary>
  );
}

/**
 * The graph's page, by its id: the graph is a family that may be off, so the
 * ontology names its view softly, through the page's catalog, and imports
 * nothing of it. While the graph is off its view is listed by no key, and the
 * tab says it cannot be shown here, by the label its option node carries.
 */
const GRAPH_PAGE = "graph.page";

function OntologyGraph({ ontologyId }: { readonly ontologyId: string }) {
  const catalog = usePageCatalog();
  const wireNodes = useGraphStore((s) => s.wireNodes);
  const key = catalog.keyOf(GRAPH_PAGE);
  const label = useMemo(
    () => viewNamed(GRAPH_PAGE, catalog, (id) => wireNodes.find((n) => n.id === id))?.label,
    [catalog, wireNodes],
  );
  const unavailable = <ViewNotLoaded label={label ?? "Graph"} />;
  if (key === null) return unavailable;
  return (
    <ViewSlot
      view={key}
      params={{ ontology: ontologyId }}
      placement="page"
      fallback={unavailable}
    />
  );
}

/**
 * The scope's nodes as a node that names no view opens: the store's default
 * view type (`resolveDefaultViewType`), shown for no node, so the ontology
 * names no other plugin's view. Its plugin off, or the data naming none, it
 * says which it cannot show, as the graph's tab does.
 */
function ScopeDefaultView({ ontologyId }: { readonly ontologyId: string }) {
  const schema = useGraphStore(schemaOf);
  const catalog = usePageCatalog();
  const target = useMemo(() => {
    const resolved = resolveDefaultViewType(
      ontologyId,
      catalog,
      (node) => schema.get(node),
      (warning) => logWarn(`[kb/ontology] ${ontologyId}: ${warning}`),
    );
    if (Result.isFailure(resolved) || resolved.success.key === null) return null;
    const { key, input, subject } = resolved.success;
    const params = paramsFrom(key, input);
    return Result.isSuccess(params) ? { key, params: params.success, subject } : null;
  }, [ontologyId, catalog, schema]);
  if (target === null) return <ViewNotLoaded label="Default view" />;
  return (
    <ViewSlot
      view={target.key}
      params={target.params}
      placement="page"
      subject={target.subject}
      fallback={<ViewNotLoaded label={target.key.label} />}
    />
  );
}

export function OntologyListSurface() {
  return (
    <ViewErrorBoundary title="Ontologies crashed" resetKey="ontology-list">
      <OntologyListPage />
    </ViewErrorBoundary>
  );
}

export function OntologySection({ route }: { readonly route: MatchedRoute | null }) {
  const scope = paramsOf(route, OntologyScopeView);
  const wireNodes = useGraphStore((s) => s.wireNodes);
  const ontologies = useMemo(() => listOntologyItems(wireNodes), [wireNodes]);
  const [creating, setCreating] = useState(false);
  const onNew = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const id = await browserHost().writes.defineOntology();
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
        active={paramsOf(route, OntologyListView) !== null}
        onClick={() => navigate("/o")}
      />
      {ontologies.map((o) => (
        <SidebarRow
          key={o.id}
          label={o.label}
          indented
          active={scope?.id === o.id}
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
