import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Graph as GraphIcon,
  Hexagon,
  House,
  List,
  Plus,
  PushPin,
  Square,
} from "@phosphor-icons/react";
import { mutations } from "@/actions/mutations";
import { createCanvasNode } from "@/lib/canvas-api";
import { cn } from "@/lib/cn";
import { graphPath, matchRoute, navigate, ontologyPath, usePath } from "@/lib/router";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore } from "@/stores/prefs.store";
import {
  listCanvasNavItems,
  listOntologyNavItems,
  listPerspectiveNavItems,
  listPinnedNavItems,
} from "./sidebar-nav";

const SIDEBAR_WIDTH_PX = 220;

export function SidebarToggle({ className }: { className?: string }) {
  const open = usePrefsStore((s) => s.sidebarOpen);
  const toggle = usePrefsStore((s) => s.toggleSidebar);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      type="button"
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-md text-foreground/40 transition-colors duration-100 hover:bg-foreground/5 hover:text-foreground/70",
        className,
      )}
      aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
      aria-expanded={open}
      title={open ? "Collapse sidebar" : "Expand sidebar"}
      onClick={() => {
        const focusedInSidebar = document.activeElement?.closest('[data-sidebar="true"]');
        toggle();
        if (open && focusedInSidebar) {
          requestAnimationFrame(() => ref.current?.focus());
        }
      }}
      ref={ref}
    >
      <List size={15} />
    </button>
  );
}

function SidebarRow({
  label,
  icon,
  active,
  indented,
  onClick,
  muted,
}: {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  indented?: boolean;
  onClick: () => void;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] transition-colors duration-100",
        indented && "pl-7",
        active
          ? "bg-foreground/[0.08] text-foreground/85"
          : muted
            ? "text-foreground/30 hover:bg-foreground/[0.03] hover:text-foreground/50"
            : "text-foreground/55 hover:bg-foreground/[0.04] hover:text-foreground/75",
      )}
    >
      {icon ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function SidebarSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      {title ? (
        <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wide text-foreground/30">
          {title}
        </div>
      ) : null}
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

export function Sidebar() {
  const open = usePrefsStore((s) => s.sidebarOpen);
  const path = usePath();
  const route = matchRoute(path);
  const nodes = useOutlineStore((s) => s.nodes);
  const wireNodes = useOutlineStore((s) => s.wireNodes);
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const zoomHome = useOutlineStore((s) => s.zoomHome);
  const rootNodeId = useOutlineStore((s) => s.rootNodeId);
  const homeRootId = useOutlineStore((s) => s.homeRootId);
  const [creating, setCreating] = useState(false);

  const perspectives = useMemo(() => listPerspectiveNavItems(wireNodes), [wireNodes]);
  const canvases = useMemo(() => listCanvasNavItems(nodes), [nodes]);
  const ontologies = useMemo(() => listOntologyNavItems(wireNodes), [wireNodes]);
  const pinned = useMemo(() => listPinnedNavItems(nodes), [nodes]);

  const onNewCanvas = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const id = await createCanvasNode();
      if (id) navigate(`/canvas/${id}`);
    } finally {
      setCreating(false);
    }
  };

  const onPinned = (id: string) => {
    navigate("/");
    zoomTo(id);
  };

  const onNewOntology = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const id = await mutations.defineOntology();
      if (id) navigate(ontologyPath(id));
    } finally {
      setCreating(false);
    }
  };

  return (
    <aside
      data-sidebar="true"
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden border-r border-foreground/[0.06] bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
        open ? "w-[220px]" : "w-0 border-r-0",
      )}
      style={{ width: open ? SIDEBAR_WIDTH_PX : 0 }}
    >
      <div className="flex h-full w-[220px] flex-col overflow-y-auto px-2 py-3">
        <SidebarSection>
          <SidebarRow
            label="Home"
            icon={<House size={14} />}
            active={route.name === "outline" && rootNodeId === homeRootId}
            onClick={() => {
              navigate("/");
              zoomHome();
            }}
          />
        </SidebarSection>

        <SidebarSection>
          <SidebarRow
            label="Graph"
            icon={<GraphIcon size={14} />}
            active={route.name === "graph" && route.perspectiveId == null}
            onClick={() => navigate(graphPath())}
          />
          {perspectives.map((p) => (
            <SidebarRow
              key={p.id}
              label={p.label}
              indented
              active={route.name === "graph" && route.perspectiveId === p.id}
              onClick={() => navigate(graphPath(p.id))}
            />
          ))}
        </SidebarSection>

        <SidebarSection>
          <SidebarRow
            label="Ontologies"
            icon={<Hexagon size={14} />}
            active={route.name === "ontology-list"}
            onClick={() => navigate("/o")}
          />
          {ontologies.map((o) => (
            <SidebarRow
              key={o.id}
              label={o.label}
              indented
              active={route.name === "ontology" && route.id === o.id}
              onClick={() => navigate(ontologyPath(o.id))}
            />
          ))}
          <SidebarRow
            label={creating ? "Creating…" : "New ontology"}
            icon={<Plus size={14} />}
            indented
            muted
            onClick={() => void onNewOntology()}
          />
        </SidebarSection>

        <SidebarSection>
          <SidebarRow
            label="Canvases"
            icon={<Square size={14} />}
            active={route.name === "canvas-list"}
            onClick={() => navigate("/canvas")}
          />
          {canvases.map((c) => (
            <SidebarRow
              key={c.id}
              label={c.label}
              indented
              active={route.name === "canvas" && route.id === c.id}
              onClick={() => navigate(`/canvas/${c.id}`)}
            />
          ))}
          <SidebarRow
            label={creating ? "Creating…" : "New canvas"}
            icon={<Plus size={14} />}
            indented
            muted
            onClick={() => void onNewCanvas()}
          />
        </SidebarSection>

        <SidebarSection title="Pinned">
          {pinned.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-foreground/30">Tag nodes #pinned</p>
          ) : (
            pinned.map((f) => (
              <SidebarRow
                key={f.id}
                label={f.label}
                icon={<PushPin size={14} />}
                active={route.name === "outline" && rootNodeId === f.id}
                onClick={() => onPinned(f.id)}
              />
            ))
          )}
        </SidebarSection>
      </div>
    </aside>
  );
}
