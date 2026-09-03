import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useOutlineStore } from "@/stores/outline.store";
import { typeRefsOf } from "@kb/model";
import { SYSTEM_IDS, isSysPrefixed } from "@/lib/types";
import { cn } from "@/lib/cn";

interface NodePickerProps {
  onPick: (nodeId: string) => void;
  onClose: () => void;
}

export function NodePicker({ onPick, onClose }: NodePickerProps) {
  const nodes = useOutlineStore((s) => s.nodes);
  const [q, setQ] = useState("");

  const candidates = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = [...nodes.values()].filter((n) => {
      // DISPLAY: a free-form canvas card picker offers content, not the
      // seeded ontology or schema nodes. Nothing here decides validity.
      if (isSysPrefixed(n.id)) return false;
      const types = typeRefsOf(n);
      if (types.includes(SYSTEM_IDS.tag) || types.includes(SYSTEM_IDS.field)) {
        return false;
      }
      if (!needle) return true;
      return n.text.toLowerCase().includes(needle) || n.id.includes(needle);
    });
    return list.slice(0, 40);
  }, [nodes, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/60 pt-[15vh] backdrop-blur-[1px]">
      <div className="w-full max-w-md rounded-lg border border-foreground/10 bg-popover shadow-xl">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Add existing node…"
          className="w-full border-b border-foreground/10 bg-transparent px-3 py-2.5 text-[13px] outline-none"
        />
        <ul className="max-h-72 overflow-auto py-1">
          {candidates.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]",
                  "hover:bg-foreground/5",
                )}
                onClick={() => onPick(n.id)}
              >
                <span className="truncate text-foreground/80">{n.text || "∅"}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-foreground/30">
                  {n.id.slice(0, 8)}
                </span>
              </button>
            </li>
          ))}
          {candidates.length === 0 && (
            <li className="px-3 py-4 text-center text-[12px] text-foreground/40">No nodes</li>
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
