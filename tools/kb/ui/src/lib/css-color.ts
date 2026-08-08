/** Resolve a CSS custom property to a concrete rgb/rgba() string for WebGL. */

export function readTokenColor(
  varName: string,
  opts: { alpha?: number; fallback: string } = { fallback: "rgb(0, 0, 0)" },
): string {
  if (typeof document === "undefined") return opts.fallback;
  const probe = document.createElement("span");
  probe.style.color = `var(${varName})`;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.documentElement.appendChild(probe);
  const raw = getComputedStyle(probe).color;
  document.documentElement.removeChild(probe);
  if (!raw) return opts.fallback;
  const alpha = opts.alpha;
  if (alpha === undefined || alpha >= 1) return raw;
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(
    raw,
  );
  if (!m) return raw;
  const r = m[1]!;
  const g = m[2]!;
  const b = m[3]!;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
