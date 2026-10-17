import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isOutside } from "@kb/ui-sdk";

/**
 * A panel the canvas opens at a point on screen (`anchor`, client
 * coordinates): below it, or above it when the window has no room below,
 * and closed by Escape or a press outside it. The item and edge inspectors
 * open in it.
 */
export function CanvasPopover({
  anchor,
  onClose,
  children,
}: {
  readonly anchor: { readonly x: number; readonly y: number };
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(anchor.y + 8);
  useLayoutEffect(() => {
    const height = ref.current?.getBoundingClientRect().height ?? 0;
    const below = anchor.y + 8;
    setTop(below + height > window.innerHeight - 8 ? Math.max(8, anchor.y - height - 8) : below);
  }, [anchor.y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (isOutside(ref.current, e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="fixed z-50" style={{ top, left: Math.max(8, anchor.x - 160) }}>
      {children}
    </div>,
    document.body,
  );
}
