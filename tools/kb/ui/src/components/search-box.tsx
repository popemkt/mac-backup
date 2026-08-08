import { useMemo, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useOutlineStore } from "@/stores/outline.store";

export function SearchBox() {
  const [query, setQuery] = useState("");
  const search = useOutlineStore((s) => s.search);
  const jumpToNode = useOutlineStore((s) => s.jumpToNode);
  const hits = useMemo(() => search(query), [search, query]);

  return (
    <div className="relative w-full max-w-md">
      <div className="flex items-center gap-2 rounded-md border border-stone-300/80 bg-white/70 px-2.5 py-1.5 shadow-sm backdrop-blur">
        <MagnifyingGlass size={14} className="text-stone-400 shrink-0" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search nodes…"
          className="w-full bg-transparent text-[13px] outline-none placeholder:text-stone-400"
          aria-label="Search nodes"
        />
      </div>
      {query.trim() && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-stone-200 bg-white/95 py-1 shadow-lg backdrop-blur">
          {hits.length === 0 ? (
            <li className="px-3 py-2 text-[12px] text-stone-400">No matches</li>
          ) : (
            hits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-teal-50"
                  onClick={() => {
                    jumpToNode(hit.id);
                    setQuery("");
                  }}
                >
                  <span className="truncate text-[13px] text-stone-800">
                    {hit.text || "(empty)"}
                  </span>
                  <span className="truncate font-mono text-[10px] text-stone-400">
                    {hit.id}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
