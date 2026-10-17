/**
 * The Locations sidebar section: the rows `location.list` answers, in its
 * order (pinned first, then most recently opened). The current root is
 * marked; each other row has a dot for what it is now. Clicking a row opens
 * it in this tab, ⌘-click (Ctrl-click) in a new one. A row that cannot be
 * opened says why and offers Forget; re-pointing it is a field edit in the
 * home store. The list is read again whenever the page regains focus, since
 * the servers it reports start and stop outside this page.
 *
 * A home store that cannot be read is said in the section and nothing else:
 * the page over the current root is untouched (DESIGN.md → Locations → A
 * location that cannot be opened).
 */
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import type { LocationRow } from "@kb/locations";
import { browserHost, cn, navigate, SidebarRow, SidebarSection } from "@kb/ui-sdk";
import { forgetLocation, listLocations, openLocation, type Listing } from "./open";

/** Total over the statuses: every row has a dot, so the lookup cannot miss. */
const STATUS_DOT: Record<
  LocationRow["status"],
  { readonly className: string; readonly label: string }
> = {
  served: { className: "bg-success", label: "served" },
  closed: { className: "bg-foreground/25", label: "closed" },
  missing: { className: "bg-warning", label: "missing" },
  "not-a-store": { className: "bg-warning", label: "not a store" },
  broken: { className: "bg-destructive", label: "broken" },
};

/** Whether `location.open` can open the row: a store is there, served or not. */
function openable(row: LocationRow): boolean {
  return row.status === "served" || row.status === "closed";
}

function StatusDot({ status }: { readonly status: LocationRow["status"] }) {
  const dot = STATUS_DOT[status];
  return (
    <span
      role="img"
      aria-label={dot.label}
      className={cn("h-1.5 w-1.5 rounded-full", dot.className)}
    />
  );
}

/** The listing, read now and again each time the page regains focus. */
function useListing(): { readonly listing: Listing; readonly reload: () => void } {
  const [listing, setListing] = useState<Listing>({ kind: "loading" });
  const reload = useCallback(() => {
    void listLocations(browserHost().invoke).then(setListing);
  }, []);
  useEffect(() => {
    reload();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);
  return { listing, reload };
}

function LocationRows({ row, reload }: { readonly row: LocationRow; readonly reload: () => void }) {
  const { invoke } = browserHost();
  if (row.current)
    return (
      <SidebarRow
        label={row.label}
        icon={<StatusDot status={row.status} />}
        active
        onClick={() => navigate("/")}
      />
    );
  if (openable(row)) {
    const open = (event: MouseEvent<HTMLButtonElement>) =>
      void openLocation(invoke, { id: row.id }, event.metaKey || event.ctrlKey);
    return <SidebarRow label={row.label} icon={<StatusDot status={row.status} />} onClick={open} />;
  }
  const forget = () => void forgetLocation(invoke, row.id).then(reload);
  return (
    <>
      <SidebarRow
        label={row.label}
        icon={<StatusDot status={row.status} />}
        muted
        onClick={reload}
      />
      <SidebarRow
        label={`Forget · ${row.reason ?? STATUS_DOT[row.status].label}`}
        indented
        muted
        onClick={forget}
      />
    </>
  );
}

export function LocationsSection() {
  const { listing, reload } = useListing();
  if (listing.kind === "loading") return null;
  if (listing.kind === "failed")
    return (
      <SidebarSection title="Locations">
        <SidebarRow label={`Locations unavailable: ${listing.message}`} muted onClick={reload} />
      </SidebarSection>
    );
  const { rows, warnings } = listing.list;
  return (
    <SidebarSection title="Locations">
      {rows.map((row) => (
        <LocationRows key={row.id} row={row} reload={reload} />
      ))}
      {warnings.map((warning) => (
        <SidebarRow key={warning} label={warning} muted onClick={reload} />
      ))}
    </SidebarSection>
  );
}
