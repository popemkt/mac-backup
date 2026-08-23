import { useEffect, useRef, useState } from "react";
import {
  MagnifyingGlass,
  Minus,
  Plus,
  ArrowsIn,
  ArrowCounterClockwise,
} from "@phosphor-icons/react";
import type Sigma from "sigma";
import { fitView, zoomIn, zoomOut, resetCamera, focusNode } from "./graph-camera";
import { cn } from "@/lib/cn";

interface GraphToolbarProps {
  sigmaRef: React.MutableRefObject<Sigma | null>;
  selectedNodeId: string | null;
  nodeIds: string[];
  onSearchChange?: (ids: Set<string> | null) => void;
}

export function GraphToolbar({
  sigmaRef,
  selectedNodeId,
  nodeIds,
  onSearchChange,
}: GraphToolbarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      const sigma = sigmaRef.current;
      if (!sigma) return;

      switch (e.key) {
        case "+":
        case "=":
          e.preventDefault();
          zoomIn(sigma);
          break;
        case "-":
          e.preventDefault();
          zoomOut(sigma);
          break;
        case "0":
          e.preventDefault();
          resetCamera(sigma);
          break;
        case "f":
          e.preventDefault();
          if (selectedNodeId) {
            focusNode(sigma, selectedNodeId);
          } else {
            fitView(sigma);
          }
          break;
        case "/":
          e.preventDefault();
          setSearchOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sigmaRef, selectedNodeId]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      onSearchChange?.(null);
      return;
    }
    const q = searchQuery.toLowerCase();
    const matches = new Set<string>();
    for (const id of nodeIds) {
      if (id.toLowerCase().includes(q)) matches.add(id);
    }
    const sigma = sigmaRef.current;
    if (sigma) {
      const graph = sigma.getGraph();
      graph.forEachNode((node, attrs) => {
        if (
          typeof attrs.label === "string" &&
          attrs.label.toLowerCase().includes(q)
        ) {
          matches.add(node);
        }
      });
    }
    onSearchChange?.(matches.size > 0 ? matches : new Set());
  }, [searchQuery, nodeIds, sigmaRef, onSearchChange]);

  const handleSearchClose = () => {
    setSearchOpen(false);
    setSearchQuery("");
    onSearchChange?.(null);
  };

  return (
    <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border border-foreground/8 bg-popover/90 p-1 shadow-lg backdrop-blur-sm">
      {searchOpen && (
        <div className="flex items-center gap-1 pr-1">
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") handleSearchClose();
              if (e.key === "Enter" && searchQuery) {
                const sigma = sigmaRef.current;
                if (sigma) {
                  const graph = sigma.getGraph();
                  const q = searchQuery.toLowerCase();
                  const match = graph.findNode(
                    (_node, attrs) =>
                      typeof attrs.label === "string" &&
                      attrs.label.toLowerCase().includes(q),
                  );
                  if (match) focusNode(sigma, match);
                }
              }
            }}
            placeholder="Search nodes…"
            className="h-6 w-36 rounded bg-transparent px-1.5 text-[12px] text-foreground/80 outline-none placeholder:text-foreground/30 focus:ring-1 focus:ring-foreground/15"
          />
          <button
            type="button"
            className="text-[10px] text-foreground/40 hover:text-foreground/60"
            onClick={handleSearchClose}
          >
            ✕
          </button>
        </div>
      )}
      <ToolbarButton
        icon={<MagnifyingGlass size={14} />}
        label="Search (/)"
        onClick={() => {
          setSearchOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      />
      <div className="mx-0.5 h-4 w-px bg-foreground/8" />
      <ToolbarButton
        icon={<Plus size={14} />}
        label="Zoom in (+)"
        onClick={() => sigmaRef.current && zoomIn(sigmaRef.current)}
      />
      <ToolbarButton
        icon={<Minus size={14} />}
        label="Zoom out (-)"
        onClick={() => sigmaRef.current && zoomOut(sigmaRef.current)}
      />
      <ToolbarButton
        icon={<ArrowsIn size={14} />}
        label="Fit view (f)"
        onClick={() => sigmaRef.current && fitView(sigmaRef.current)}
      />
      <ToolbarButton
        icon={<ArrowCounterClockwise size={14} />}
        label="Reset (0)"
        onClick={() => sigmaRef.current && resetCamera(sigmaRef.current)}
      />
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/80",
        active && "bg-foreground/[0.08] text-foreground/80",
      )}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
