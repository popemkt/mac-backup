import type Sigma from "sigma";
import { clusterHull, clusterHullPath, HULL_PAD } from "./cluster-hull";
import { hashTagColor } from "@/lib/tag-color";
import { withGraphAlpha } from "@/lib/graph-dim";
import { readTokenColor } from "@/lib/css-color";
import { fitGraphLabel, graphLabelFont } from "@/lib/graph-label";

/**
 * Decoration never captures input; background clicks are hit-tested by Sigma.
 *
 * A hull is a soft region, not a box: a faint fill in the cluster's colour and
 * an edge that is a glow of that colour rather than a hard line. The hull
 * under the pointer comes forward a little. Labels are the ink token in the
 * graph face.
 */
export function clusterHulls(sigma: Sigma, canvas: HTMLCanvasElement) {
  let paths = new Map<string, Path2D>();
  let hovered: string | null = null;
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
    // Each token read is a style recalculation, so the label style resolves
    // once per draw, and only once a hull is actually drawn.
    let label: { font: string; color: string } | null = null;
    for (const [key, points] of groups) {
      const path = clusterHullPath(clusterHull(points));
      if (!path) continue;
      paths.set(key, path);
      const color = hashTagColor(key);
      const near = key === hovered;
      ctx.fillStyle = withGraphAlpha(color, near ? 0.09 : 0.05);
      ctx.fill(path);
      ctx.save();
      ctx.shadowColor = withGraphAlpha(color, near ? 0.55 : 0.35);
      ctx.shadowBlur = 14;
      ctx.strokeStyle = withGraphAlpha(color, near ? 0.4 : 0.2);
      ctx.lineWidth = 1;
      ctx.stroke(path);
      ctx.restore();
      label ??= { font: `600 11px ${graphLabelFont()}`, color: readTokenColor("--foreground") };
      ctx.font = label.font;
      ctx.fillStyle = label.color;
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
    /** The hull under the pointer, host-relative CSS pixels (null: none). */
    hover(x: number, y: number): void {
      const key = this.hit(x, y);
      if (key === hovered) return;
      hovered = key;
      sigma.scheduleRender();
    },
    dispose: () => sigma.off("afterRender", draw),
  };
}
