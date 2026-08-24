import { useEffect, useMemo, useState } from "react";
import { X } from "@phosphor-icons/react";
import type { WireNode } from "@kb/protocol";
import {
  ontologyRefs,
  ontologyStr,
  wouldCreateExtendsCycle,
} from "@kb/ontology";
import { mutations } from "@/actions/mutations";
import { MemberRow } from "@/components/ontology/member-row";
import { RefAddPopover } from "@/components/ontology/ref-add-popover";
import { cn } from "@/lib/cn";
import {
  excludedRows,
  memberRows,
  resolveScope,
} from "@/lib/ontology-scope";
import { navigate } from "@/lib/router";
import { resolveTagColor } from "@/lib/tag-color";
import { SYSTEM_IDS } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";

export interface OntologyPageProps {
  ontologyId: string;
}

/**
 * The ontology page — the editing experience the owner's "probably a new node
 * with a new editing experience" asked for.
 *
 * Core ships the Members tab only: the membership algebra plus the provenance
 * that makes it legible. Schema / Relations / View (r5 §1.5) are parked.
 */
export function OntologyPage({ ontologyId }: OntologyPageProps) {
  const wireNodes = useOutlineStore((s) => s.wireNodes);
  const nodes = useOutlineStore((s) => s.nodes);
  const queryDb = useOutlineStore((s) => s.queryDb);
  const rev = useOutlineStore((s) => s.rev);
  const jumpToNode = useOutlineStore((s) => s.jumpToNode);

  const byId = useMemo(
    () => new Map(wireNodes.map((n) => [n.id, n])),
    [wireNodes],
  );
  const onto = byId.get(ontologyId);

  const labelFor = (id: string): string =>
    byId.get(id)?.text?.trim() || nodes.get(id)?.text?.trim() || id;

  const resolution = useMemo(
    () => resolveScope(wireNodes, ontologyId, queryDb, rev),
    [wireNodes, ontologyId, queryDb, rev],
  );

  const members = useMemo(
    () => memberRows(resolution, nodes),
    [resolution, nodes],
  );
  const excluded = useMemo(
    () => excludedRows(resolution, nodes),
    [resolution, nodes],
  );

  const includeTags = onto
    ? ontologyRefs(onto, SYSTEM_IDS.ontoIncludeField)
    : [];
  const extendsIds = onto
    ? ontologyRefs(onto, SYSTEM_IDS.ontoExtendsField)
    : [];
  const closure = onto
    ? ontologyStr(onto, SYSTEM_IDS.ontoClosureField) === "descendants"
      ? "descendants"
      : "none"
    : "none";
  const storedQuery = onto
    ? (ontologyStr(onto, SYSTEM_IDS.ontoQueryField) ?? "")
    : "";

  const tagCandidates = useMemo(() => {
    const taken = new Set(includeTags);
    return wireNodes
      .filter((n) => isTagNode(n))
      .map((n) => ({
        id: n.id,
        label: n.text || n.id,
        note: taken.has(n.id) ? "included" : undefined,
        disabled: taken.has(n.id),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [wireNodes, includeTags.join(",")]);

  const ontologyCandidates = useMemo(() => {
    const taken = new Set(extendsIds);
    return wireNodes
      .filter(
        (n) =>
          n.id !== ontologyId &&
          (n.props[SYSTEM_IDS.typeField] ?? []).some(
            (v) => v.t === "ref" && v.v === SYSTEM_IDS.ontologyTag,
          ),
      )
      .map((n) => {
        const cycles = wouldCreateExtendsCycle(wireNodes, ontologyId, n.id);
        return {
          id: n.id,
          label: n.text || n.id,
          note: taken.has(n.id)
            ? "extended"
            : cycles
              ? "would cycle"
              : undefined,
          disabled: taken.has(n.id) || cycles,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [wireNodes, ontologyId, extendsIds.join(",")]);

  if (!onto) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <h2 className="kb-text font-medium text-foreground/80">
          Ontology not found
        </h2>
        <p className="mt-1 text-[13px] text-foreground/45">
          <span className="font-mono text-[12px]">{ontologyId}</span> is not in
          this workspace.
        </p>
        <button
          type="button"
          className="mt-3 rounded-md border border-foreground/10 px-3 py-1.5 text-[12px] text-foreground/70 hover:bg-foreground/5"
          onClick={() => navigate("/o")}
        >
          All ontologies
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
      <OntologyTitle id={ontologyId} text={onto.text} />

      <section className="flex flex-col gap-2">
        <DefinitionRow label="include">
          {includeTags.length === 0 ? (
            <EmptyHint>no tags yet — every instance of a tag joins</EmptyHint>
          ) : (
            includeTags.map((tagId) => (
              <Chip
                key={tagId}
                label={`#${labelFor(tagId)}`}
                color={resolveTagColor(tagId, explicitTagColor(byId.get(tagId)))}
                onRemove={() => void mutations.ontologyRemoveInclude(ontologyId, tagId)}
                removeLabel={`Remove include ${labelFor(tagId)}`}
              />
            ))
          )}
          <RefAddPopover
            trigger="tag"
            title="Include tag"
            candidates={tagCandidates}
            emptyHint="No tags defined yet"
            onPick={(id) => void mutations.ontologyAddInclude(ontologyId, id)}
          />
        </DefinitionRow>

        <DefinitionRow label="extends">
          {extendsIds.length === 0 ? (
            <EmptyHint>
              no parents — extending an ontology inherits its members
            </EmptyHint>
          ) : (
            extendsIds.map((parentId) => (
              <Chip
                key={parentId}
                label={`⬡ ${labelFor(parentId)}`}
                onRemove={() =>
                  void mutations.ontologyRemoveExtends(ontologyId, parentId)
                }
                removeLabel={`Remove extends ${labelFor(parentId)}`}
              />
            ))
          )}
          <RefAddPopover
            trigger="ontology"
            title="Extend ontology"
            candidates={ontologyCandidates}
            emptyHint="No other ontologies yet"
            onPick={(id) => void mutations.ontologyAddExtends(ontologyId, id)}
          />
        </DefinitionRow>

        <DefinitionRow label="query" align="start">
          <QueryEditor
            ontologyId={ontologyId}
            value={storedQuery}
            warning={resolution.warnings.find((w) =>
              w.startsWith("onto.query"),
            )}
          />
        </DefinitionRow>

        <DefinitionRow label="closure">
          <Segmented
            options={[
              { key: "none", label: "none" },
              { key: "descendants", label: "descendants" },
            ]}
            value={closure}
            onChange={(v) =>
              void mutations.ontologySetClosure(
                ontologyId,
                v as "none" | "descendants",
              )
            }
          />
          <span className="text-[11px] text-foreground/30">
            pull whole subtrees of members in
          </span>
        </DefinitionRow>
      </section>

      {resolution.warnings.length > 0 ? (
        <ul
          className="flex flex-col gap-0.5 rounded-md border border-warning/25 bg-warning/[0.06] px-2.5 py-1.5"
          data-ontology-page-warnings="true"
        >
          {resolution.warnings.map((w) => (
            <li key={w} className="text-[11px] text-warning">
              {w}
            </li>
          ))}
        </ul>
      ) : null}

      <section>
        <SectionTitle count={members.length}>Members</SectionTitle>
        {members.length === 0 ? (
          <p className="px-1.5 py-1 text-[12px] text-foreground/35">
            Nothing here yet. Include a tag, extend another ontology, or pin
            nodes from the outline.
          </p>
        ) : (
          <div className="flex flex-col">
            {members.map((row) => (
              <MemberRow
                key={row.id}
                row={row}
                labelOf={labelFor}
                onOpen={(id) => {
                  navigate("/");
                  jumpToNode(id);
                }}
                onPin={(id) => void mutations.ontologyAddMember(ontologyId, id)}
                onUnpin={(id) =>
                  void mutations.ontologyRemoveMember(ontologyId, id)
                }
                onExclude={(id) => void mutations.ontologyExclude(ontologyId, id)}
              />
            ))}
          </div>
        )}
      </section>

      {excluded.length > 0 ? (
        <section>
          <SectionTitle count={excluded.length}>Excluded</SectionTitle>
          <div className="flex flex-col">
            {excluded.map((row) => (
              <MemberRow
                key={row.id}
                row={row}
                labelOf={labelFor}
                excluded
                onRestore={(id) =>
                  void mutations.ontologyUnexclude(ontologyId, id)
                }
              />
            ))}
          </div>
          <p className="mt-1 px-1.5 text-[11px] text-foreground/30">
            Excluded nodes keep their tags — they are hidden from this ontology
            only.
          </p>
        </section>
      ) : null}
    </div>
  );
}

// ── pieces ─────────────────────────────────────────────────────────────────

/**
 * Inline rename. An ontology is minted as "New ontology" and named here — the
 * page you land on after creating one has to be the place you can name it.
 */
function OntologyTitle({ id, text }: { id: string; text: string }) {
  const [draft, setDraft] = useState(text);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(text);
  }, [text, editing]);

  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className="text-[13px] text-foreground/35">
        ⬡
      </span>
      <input
        value={draft}
        aria-label="Ontology name"
        placeholder="Untitled ontology"
        spellCheck={false}
        className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-[20px] font-medium text-foreground/85 outline-none placeholder:text-foreground/25 hover:bg-foreground/[0.03] focus:bg-foreground/[0.04]"
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setDraft(e.target.value);
          mutations.updateNodeContent(id, e.target.value);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setDraft(text);
            mutations.updateNodeContent(id, text);
            e.currentTarget.blur();
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}


function isTagNode(node: WireNode): boolean {
  return (node.props[SYSTEM_IDS.typeField] ?? []).some(
    (v) => v.t === "ref" && v.v === SYSTEM_IDS.tag,
  );
}

function explicitTagColor(node: WireNode | undefined): string | undefined {
  const raw = node?.props[SYSTEM_IDS.colorField]?.[0];
  return raw?.t === "str" ? String(raw.v) : undefined;
}

function DefinitionRow({
  label,
  children,
  align = "center",
}: {
  label: string;
  children: React.ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "flex gap-3",
        align === "center" ? "items-center" : "items-start",
      )}
    >
      <span
        className={cn(
          "w-16 shrink-0 text-[11px] uppercase tracking-wide text-foreground/30",
          align === "start" && "pt-1",
        )}
      >
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {children}
      </div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] text-foreground/25">{children}</span>;
}

function Chip({
  label,
  color,
  onRemove,
  removeLabel,
}: {
  label: string;
  color?: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <span
      className="group/chip inline-flex h-[18px] max-w-full items-center gap-0.5 rounded-sm px-1.5 text-[11px] font-medium leading-[18px]"
      style={
        color
          ? { backgroundColor: `${color}18`, color }
          : { backgroundColor: "color-mix(in oklab, currentColor 8%, transparent)" }
      }
    >
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label={removeLabel}
        title={removeLabel}
        className="ml-0.5 flex h-3 w-3 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover/chip:opacity-60 hover:!opacity-100 focus-visible:opacity-100"
        onClick={onRemove}
      >
        <X size={9} weight="bold" />
      </button>
    </span>
  );
}

function SectionTitle({
  children,
  count,
}: {
  children: React.ReactNode;
  count: number;
}) {
  return (
    <h2 className="mb-1 flex items-center gap-1.5 px-1.5 text-[11px] font-medium uppercase tracking-wide text-foreground/30">
      {children}
      <span className="font-normal normal-case tracking-normal text-foreground/25">
        {count}
      </span>
    </h2>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: Array<{ key: string; label: string }>;
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-foreground/[0.04] p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={o.key === value}
          className={cn(
            "rounded-[5px] px-2 py-0.5 text-[11px] font-medium transition-colors duration-100",
            o.key === value
              ? "bg-background text-foreground/75 shadow-sm"
              : "text-foreground/35 hover:text-foreground/60",
          )}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Parameter-free EDN only: the client datalog runner takes no inputs, so an
 * ontology's query cannot be parameterised (r5 §0.1).
 */
function QueryEditor({
  ontologyId,
  value,
  warning,
}: {
  ontologyId: string;
  value: string;
  warning: string | undefined;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() === value.trim()) return;
    void mutations.ontologySetQuery(ontologyId, draft);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <textarea
        value={draft}
        rows={draft.includes("\n") ? 3 : 1}
        spellCheck={false}
        aria-label="Ontology query (EDN)"
        placeholder="[:find ?id :where …]  — parameter-free EDN"
        className={cn(
          "w-full resize-y rounded-md bg-foreground/[0.03] px-2 py-1",
          "font-mono text-[11px] leading-[1.5] text-foreground/75 outline-none",
          "placeholder:text-foreground/25 focus:bg-foreground/[0.05]",
          warning && "ring-1 ring-warning/40",
        )}
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setDraft(value);
            setEditing(false);
            e.currentTarget.blur();
            return;
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commit();
            e.currentTarget.blur();
          }
        }}
      />
      {warning ? (
        <span className="text-[11px] text-warning">{warning}</span>
      ) : null}
    </div>
  );
}
