import { useMemo, useState } from "react";
import { mutations } from "@/actions/mutations";
import { queryBacklinks } from "@/ds/db";
import { formatPropValue, resolveProps } from "@/lib/graph-view";
import { SYSTEM_IDS, type PropValue } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";

export function NodePanel() {
  const selectedNodeId = useOutlineStore((s) => s.selectedNodeId);
  const nodes = useOutlineStore((s) => s.nodes);
  const queryDb = useOutlineStore((s) => s.queryDb);
  const jumpToNode = useOutlineStore((s) => s.jumpToNode);
  const node = selectedNodeId ? nodes.get(selectedNodeId) : null;

  const backlinks = useMemo(() => {
    if (!queryDb || !selectedNodeId) return [];
    return queryBacklinks(queryDb, selectedNodeId);
  }, [queryDb, selectedNodeId, nodes]);

  if (!node) {
    return (
      <aside className="flex h-full flex-col border-l border-stone-200/80 bg-[var(--panel)]/80 p-4 text-[13px] text-stone-500">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
          Node
        </h2>
        <p>Select a node to inspect props and tags.</p>
      </aside>
    );
  }

  const props = resolveProps(node, nodes);
  const tagNodes = [...nodes.values()].filter((n) =>
    (n.props[SYSTEM_IDS.typeField] ?? []).some(
      (v) => v.t === "ref" && v.v === SYSTEM_IDS.tag,
    ),
  );
  const fieldNodes = [...nodes.values()].filter((n) =>
    (n.props[SYSTEM_IDS.typeField] ?? []).some(
      (v) => v.t === "ref" && v.v === SYSTEM_IDS.field,
    ),
  );

  return (
    <aside className="flex h-full flex-col gap-4 overflow-auto border-l border-stone-200/80 bg-[var(--panel)]/80 p-4 text-[13px]">
      <div>
        <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
          Node
        </h2>
        <p className="text-[15px] leading-snug text-stone-900">
          {node.text || "(empty)"}
        </p>
        <p className="mt-1 font-mono text-[10px] text-stone-400">{node.id}</p>
      </div>

      <TagsEditor
        nodeId={node.id}
        tags={node.tags}
        allTags={tagNodes.map((t) => ({ id: t.id, name: t.text }))}
      />

      <PropsEditor
        nodeId={node.id}
        props={props}
        fields={fieldNodes.map((f) => ({ id: f.id, name: f.text }))}
      />

      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
          Backlinks
        </h3>
        {backlinks.length === 0 ? (
          <p className="text-stone-400">None</p>
        ) : (
          <ul className="space-y-1">
            {backlinks.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  className="text-left text-teal-900/80 hover:underline"
                  onClick={() => jumpToNode(b.id)}
                >
                  {b.text || b.id}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function TagsEditor({
  nodeId,
  tags,
  allTags,
}: {
  nodeId: string;
  tags: Array<{ id: string; name: string }>;
  allTags: Array<{ id: string; name: string }>;
}) {
  const [draft, setDraft] = useState("");
  const tagged = new Set(tags.map((t) => t.id));
  const available = allTags.filter((t) => !tagged.has(t.id));

  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
        Tags
      </h3>
      <ul className="mb-2 flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <li
            key={t.id}
            className="inline-flex items-center gap-1 rounded-sm bg-teal-900/8 px-2 py-0.5 text-[12px] text-teal-900/70"
          >
            #{t.name}
            <button
              type="button"
              className="text-stone-400 hover:text-stone-700"
              aria-label={`Remove tag ${t.name}`}
              onClick={() => void mutations.removeTag(nodeId, t.id)}
            >
              ×
            </button>
          </li>
        ))}
        {tags.length === 0 && <li className="text-stone-400">None</li>}
      </ul>
      <div className="flex flex-col gap-1.5">
        {available.length > 0 && (
          <select
            className="rounded border border-stone-200 bg-white px-2 py-1 text-[12px]"
            defaultValue=""
            onChange={(e) => {
              const id = e.target.value;
              if (id) void mutations.addTag(nodeId, id);
              e.target.value = "";
            }}
          >
            <option value="">Add tag…</option>
            {available.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const name = draft.trim();
            if (!name) return;
            void mutations.defineTag(name).then((id) => {
              if (id) void mutations.addTag(nodeId, id);
              setDraft("");
            });
          }}
        >
          <input
            className="min-w-0 flex-1 rounded border border-stone-200 px-2 py-1 text-[12px]"
            placeholder="New tag…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="submit"
            className="rounded bg-teal-900/10 px-2 py-1 text-[11px] text-teal-900"
          >
            Create
          </button>
        </form>
      </div>
    </div>
  );
}

function PropsEditor({
  nodeId,
  props,
  fields,
}: {
  nodeId: string;
  props: Array<{ fieldId: string; fieldName: string; values: PropValue[] }>;
  fields: Array<{ id: string; name: string }>;
}) {
  const [newFieldName, setNewFieldName] = useState("");
  const [addFieldId, setAddFieldId] = useState("");
  const nodes = useOutlineStore((s) => s.nodes);
  const used = new Set(props.map((p) => p.fieldId));
  const unusedFields = fields.filter(
    (f) => !used.has(f.id) && f.id !== SYSTEM_IDS.typeField,
  );

  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
        Props
      </h3>
      {props.length === 0 ? (
        <p className="mb-2 text-stone-400">None</p>
      ) : (
        <div className="mb-3 space-y-3">
          {props.map((p) => (
            <div key={p.fieldId}>
              <div className="mb-1 truncate text-[11px] text-stone-500">
                {p.fieldName}
              </div>
              <ul className="space-y-1">
                {p.values.map((v, i) => (
                  <li key={i} className="flex items-center gap-1">
                    <PropValueEditor
                      value={v}
                      display={formatPropValue(v, nodes)}
                      onCommit={(next) =>
                        void mutations.updateProp(nodeId, p.fieldId, next, v)
                      }
                    />
                    <button
                      type="button"
                      className="text-stone-400 hover:text-stone-700"
                      aria-label="Remove value"
                      onClick={() =>
                        void mutations.removeProp(nodeId, p.fieldId, v)
                      }
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="mt-1 text-[11px] text-teal-900/70 hover:underline"
                onClick={() =>
                  void mutations.updateProp(nodeId, p.fieldId, {
                    t: "str",
                    v: "",
                  })
                }
              >
                + value
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {unusedFields.length > 0 && (
          <select
            className="rounded border border-stone-200 bg-white px-2 py-1 text-[12px]"
            value={addFieldId}
            onChange={(e) => {
              const id = e.target.value;
              setAddFieldId("");
              if (id) {
                void mutations.updateProp(nodeId, id, { t: "str", v: "" });
              }
            }}
          >
            <option value="">Add field…</option>
            {unusedFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newFieldName.trim();
            if (!name) return;
            void mutations.defineField(name).then((id) => {
              if (id) {
                void mutations.updateProp(nodeId, id, { t: "str", v: "" });
              }
              setNewFieldName("");
            });
          }}
        >
          <input
            className="min-w-0 flex-1 rounded border border-stone-200 px-2 py-1 text-[12px]"
            placeholder="New field…"
            value={newFieldName}
            onChange={(e) => setNewFieldName(e.target.value)}
          />
          <button
            type="submit"
            className="rounded bg-teal-900/10 px-2 py-1 text-[11px] text-teal-900"
          >
            Create
          </button>
        </form>
      </div>
    </div>
  );
}

function PropValueEditor({
  value,
  display,
  onCommit,
}: {
  value: PropValue;
  display: string;
  onCommit: (next: PropValue) => void;
}) {
  if (value.t === "bool") {
    return (
      <label className="flex flex-1 items-center gap-2 text-[12px]">
        <input
          type="checkbox"
          checked={value.v}
          onChange={(e) => onCommit({ t: "bool", v: e.target.checked })}
        />
        {value.v ? "true" : "false"}
      </label>
    );
  }

  if (value.t === "num") {
    return (
      <input
        type="number"
        className="min-w-0 flex-1 rounded border border-stone-200 px-1.5 py-0.5 text-[12px]"
        defaultValue={value.v}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n) && n !== value.v) onCommit({ t: "num", v: n });
        }}
      />
    );
  }

  if (value.t === "date") {
    return (
      <input
        type="date"
        className="min-w-0 flex-1 rounded border border-stone-200 px-1.5 py-0.5 text-[12px]"
        defaultValue={value.v.slice(0, 10)}
        onBlur={(e) => {
          if (e.target.value && e.target.value !== value.v.slice(0, 10)) {
            onCommit({ t: "date", v: e.target.value });
          }
        }}
      />
    );
  }

  if (value.t === "ref") {
    return (
      <input
        className="min-w-0 flex-1 rounded border border-stone-200 px-1.5 py-0.5 font-mono text-[11px]"
        defaultValue={value.v}
        title={display}
        onBlur={(e) => {
          const next = e.target.value.trim();
          if (next && next !== value.v) onCommit({ t: "ref", v: next });
        }}
      />
    );
  }

  return (
    <input
      className="min-w-0 flex-1 rounded border border-stone-200 px-1.5 py-0.5 text-[12px]"
      defaultValue={value.v}
      onBlur={(e) => {
        if (e.target.value !== value.v) {
          onCommit({ t: "str", v: e.target.value });
        }
      }}
    />
  );
}
