import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { SYSTEM_IDS, typeRefsOf } from "@kb/model";
import {
  isSysPrefixed,
  PickerList,
  pickerRows,
  useNodes,
  usePickerKeys,
  type PickerCandidate,
} from "@kb/ui-sdk";

interface NodePickerProps {
  onPick: (nodeId: string) => void;
  onClose: () => void;
}

/**
 * "Add existing node" to a canvas: a modal around the one node picker
 * (lib/picker). Only the candidate set is the canvas's own.
 */
export function NodePicker({ onPick, onClose }: NodePickerProps) {
  const nodes = useNodes();
  const [q, setQ] = useState("");

  const candidates = useMemo(() => {
    const out: PickerCandidate[] = [];
    for (const n of nodes.values()) {
      // DISPLAY: a free-form canvas card picker offers content, not the
      // seeded ontology or schema nodes. Nothing here decides validity.
      if (isSysPrefixed(n.id)) continue;
      const types = typeRefsOf(n);
      if (types.includes(SYSTEM_IDS.tag) || types.includes(SYSTEM_IDS.field)) continue;
      out.push({ id: n.id, label: n.text || "∅", note: n.id.slice(0, 8) });
    }
    return out;
  }, [nodes]);
  const rows = useMemo(() => pickerRows(candidates, { query: q, limit: 40 }), [candidates, q]);

  const keys = usePickerKeys({
    rows,
    query: q,
    onPick: (row) => {
      if (row?.kind === "item") onPick(row.id);
    },
    onCancel: onClose,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/60 pt-[15vh] backdrop-blur-[1px]">
      <div className="w-full max-w-md rounded-lg border border-foreground/10 bg-popover shadow-overlay">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            keys.handleKeyDown(e);
          }}
          placeholder="Add existing node…"
          className="w-full border-b border-foreground/10 bg-transparent px-3 py-2.5 text-ui outline-none"
        />
        <PickerList
          placement="inline"
          rows={rows}
          activeIndex={keys.activeIndex}
          onHover={keys.setActiveIndex}
          onPick={(row) => {
            if (row.kind === "item") onPick(row.id);
          }}
          emptyText="No nodes"
          aria-label="Nodes"
        />
      </div>
    </div>,
    document.body,
  );
}
