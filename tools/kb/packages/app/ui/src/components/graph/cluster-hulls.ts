import type Sigma from "sigma";
import { clusterHull, clusterHullPath, HULL_PAD } from "./cluster-hull";
import { hashTagColor } from "@/lib/tag-color";
import { withGraphAlpha } from "@/lib/graph-dim";
import { readTokenColor } from "@/lib/css-color";
import { GRAPH_LABEL_FONT, fitGraphLabel } from "@/lib/graph-label";

/** Decoration never captures input; background clicks are hit-tested by Sigma. */
export function clusterHulls(sigma: Sigma, canvas: HTMLCanvasElement) {
  let paths = new Map<string, Path2D>();
  const draw = () => {
    const { width, height } = sigma.getDimensions();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paths = new Map();
    const labels = new Map<string, string>();
    const groups = new Map<string, Array<{ x: number; y: number }>>();
    sigma.getGraph().forEachNode((id, attrs) => {
      const node = sigma.getNodeDisplayData(id);
      if (!node) return;
      const key = String(attrs.clusterKey);
      labels.set(key, String(attrs.clusterLabel ?? key));
      const points = groups.get(key) ?? [];
      points.push(sigma.framedGraphToViewport(node));
      groups.set(key, points);
    });
    for (const [key, points] of groups) {
      const path = clusterHullPath(clusterHull(points));
      if (!path) continue;
      paths.set(key, path);
      const color = hashTagColor(key);
      ctx.fillStyle = withGraphAlpha(color, 0.04);
      ctx.strokeStyle = withGraphAlpha(color, 0.25);
      ctx.lineWidth = 1.5;
      ctx.fill(path);
      ctx.stroke(path);
      ctx.font = `600 11px ${GRAPH_LABEL_FONT}`;
      ctx.fillStyle = readTokenColor("--foreground", { fallback: "#222" });
      ctx.textAlign = "center";
      ctx.fillText(
        fitGraphLabel(
          `${labels.get(key)} (${points.length})`,
          (value) => ctx.measureText(value).width,
        ),
        points.reduce((x, p) => x + p.x, 0) / points.length,
        Math.min(...points.map((p) => p.y)) - HULL_PAD - 8,
      );
    }
  };
  sigma.on("afterRender", draw);
  return {
    hit(x: number, y: number): string | null {
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.save();
      ctx.resetTransform();
      let result: string | null = null;
      for (const [key, path] of paths)
        if (ctx.isPointInPath(path, x, y)) {
          result = key;
          break;
        }
      ctx.restore();
      return result;
    },
    dispose: () => sigma.off("afterRender", draw),
  };
}
