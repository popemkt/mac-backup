import { useEffect, useRef, useState } from "react";
import {
  ArrowCounterClockwiseIcon,
  ArrowsInIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { hasText } from "@/lib/text";
import { cn } from "@/lib/cn";
import { isTextEntry } from "@/lib/dom";
import type { LensPerspective } from "@/lib/graph-lens";
import { CAPABILITY_REASONS, type RendererCapabilities } from "./graph-capabilities";
import type { GraphCameraControls } from "./graph-camera-controls";
import { GraphSettings } from "./graph-settings";

interface GraphToolbarProps {
  capabilities: RendererCapabilities;
  controls: GraphCameraControls | null;
  selectedNodeId: string | null;
  /** id → label for search matching (label only — never raw id). */
  nodes: Array<{ id: string; label: string }>;
  onSearchChange?: (ids: Set<string> | null) => void;
  perspective?: LensPerspective | null;
}

export function GraphToolbar({
  capabilities,
  controls,
  selectedNodeId,
  nodes,
  onSearchChange,
  perspective,
}: GraphToolbarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  const capsRef = useRef(capabilities);
  capsRef.current = capabilities;
  const selectedRef = useRef(selectedNodeId);
  selectedRef.current = selectedNodeId;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextEntry(e.target)) return;
      const caps = capsRef.current;
      const cam = controlsRef.current;

      if (e.key === "/" && caps.search) {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      if (!cam) return;

      switch (e.key) {
        case "+":
        case "=":
          if (!caps.zoom) return;
          e.preventDefault();
          cam.zoomIn();
          break;
        case "-":
          if (!caps.zoom) return;
          e.preventDefault();
          cam.zoomOut();
          break;
        case "0":
          if (!caps.reset) return;
          e.preventDefault();
          cam.reset();
          break;
        case "f":
          e.preventDefault();
          if (selectedRef.current !== null && caps.focus) {
            cam.focusNode(selectedRef.current);
          } else if (caps.fit) {
            cam.fit();
          }
          break;
        default:
          // Any other key belongs to the page, not the camera.
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!capabilities.search) {
      onSearchChange?.(null);
      return;
    }
    if (!searchQuery.trim()) {
      onSearchChange?.(null);
      return;
    }
    const q = searchQuery.toLowerCase();
    const matches = new Set<string>();
    for (const n of nodes) {
      if (n.label.toLowerCase().includes(q)) matches.add(n.id);
    }
    onSearchChange?.(matches.size > 0 ? matches : new Set());
  }, [searchQuery, nodes, capabilities.search, onSearchChange]);

  const handleSearchClose = () => {
    setSearchOpen(false);
    setSearchQuery("");
    onSearchChange?.(null);
  };

  /** A camera verb fires only when the renderer allows it and controls exist. */
  const cameraVerb = (enabled: boolean, verb: (c: GraphCameraControls) => void) => () => {
    if (!enabled || !controls) return;
    verb(controls);
  };

  return (
    <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border border-foreground/8 bg-popover/90 p-1 shadow-lg backdrop-blur-sm">
      {searchOpen && capabilities.search && (
        <div className="flex items-center gap-1 pr-1">
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") handleSearchClose();
              if (e.key === "Enter" && searchQuery && controls) {
                const q = searchQuery.toLowerCase();
                const match = nodes.find((n) => n.label.toLowerCase().includes(q));
                if (match && capabilities.focus) {
                  controls.focusNode(match.id);
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
        icon={<MagnifyingGlassIcon size={14} />}
        label="Search (/)"
        disabled={!capabilities.search}
        disabledReason={CAPABILITY_REASONS.search}
        onClick={() => {
          setSearchOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      />
      <div className="mx-0.5 h-4 w-px bg-foreground/8" />
      <ToolbarButton
        icon={<PlusIcon size={14} />}
        label="Zoom in (+)"
        disabled={!capabilities.zoom || !controls}
        disabledReason={CAPABILITY_REASONS.zoom}
        onClick={cameraVerb(capabilities.zoom, (c) => c.zoomIn())}
      />
      <ToolbarButton
        icon={<MinusIcon size={14} />}
        label="Zoom out (-)"
        disabled={!capabilities.zoom || !controls}
        disabledReason={CAPABILITY_REASONS.zoom}
        onClick={cameraVerb(capabilities.zoom, (c) => c.zoomOut())}
      />
      <ToolbarButton
        icon={<ArrowsInIcon size={14} />}
        label="Fit view (f)"
        disabled={!capabilities.fit || !controls}
        disabledReason={CAPABILITY_REASONS.fit}
        onClick={cameraVerb(capabilities.fit, (c) => c.fit())}
      />
      <ToolbarButton
        icon={<ArrowCounterClockwiseIcon size={14} />}
        label="Reset (0)"
        disabled={!capabilities.reset || !controls}
        disabledReason={CAPABILITY_REASONS.reset}
        onClick={cameraVerb(capabilities.reset, (c) => c.reset())}
      />
      {perspective ? (
        <>
          <div className="mx-0.5 h-4 w-px bg-foreground/8" />
          <GraphSettings perspective={perspective} />
        </>
      ) : null}
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  disabledReason,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const title = disabled === true && hasText(disabledReason) ? disabledReason : label;
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
        disabled === true
          ? "cursor-not-allowed text-foreground/20"
          : "text-foreground/50 hover:bg-foreground/[0.06] hover:text-foreground/80",
        active === true && disabled !== true && "bg-foreground/[0.08] text-foreground/80",
      )}
      title={title}
      aria-label={title}
      aria-disabled={disabled === true || undefined}
      onClick={() => {
        if (disabled !== true) onClick();
      }}
    >
      {icon}
    </button>
  );
}
