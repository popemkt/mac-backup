import { useMemo, useState } from "react";
import { mutations } from "@/actions/mutations";
import { listOntologyItems } from "@/lib/ontology-scope";
import { navigate, ontologyPath } from "@/lib/router";
import { useOutlineStore } from "@/stores/outline.store";

/**
 * All ontologies. No default ontology is seeded — an empty list is a legitimate
 * empty state, so this page also has to teach what an ontology is for.
 */
export function OntologyListPage() {
  const wireNodes = useOutlineStore((s) => s.wireNodes);
  const items = useMemo(() => listOntologyItems(wireNodes), [wireNodes]);
  const [busy, setBusy] = useState(false);

  const onNew = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const id = await mutations.defineOntology();
      if (id) navigate(ontologyPath(id));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <button
            type="button"
            className="mb-1 text-[12px] text-foreground/40 hover:text-foreground/70"
            onClick={() => navigate("/")}
          >
            ← outline
          </button>
          <h2 className="text-[13px] font-medium text-foreground/80">
            Ontologies
          </h2>
          <p className="mt-0.5 max-w-md text-[12px] text-foreground/40">
            A named set of nodes — tags, pins, a query, or other ontologies.
            Enter one and you see only its members and how they connect.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          className="shrink-0 rounded-md border border-foreground/10 px-3 py-1.5 text-[12px] text-foreground/70 hover:bg-foreground/5 disabled:opacity-50"
          onClick={() => void onNew()}
        >
          New ontology
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-[13px] text-foreground/40">
          No ontologies yet.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {items.map((o) => (
            <button
              key={o.id}
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors duration-100 hover:bg-foreground/[0.03]"
              onClick={() => navigate(ontologyPath(o.id))}
            >
              <span aria-hidden className="shrink-0 text-[11px] text-foreground/35">
                ⬡
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/80">
                {o.label}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-foreground/25">
                {o.id}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
