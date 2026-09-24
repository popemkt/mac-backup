/**
 * The motion study's curve panel: the `--motion-settle` ease and a
 * critically damped spring, both over the chosen settle time, drawn as
 * progress against time, with a marker running along each. The ease arrives
 * exactly on time and stops; the spring has no end point, only a tail — and
 * it is the one that survives being retargeted mid-flight.
 */
import { useEffect, useRef } from "react";
import type { LabControlValues } from "@/components/lab/kit/contract";
import { numberOf } from "@/components/lab/kit/contract";
import { readLabPalette, type LabPalette } from "@/components/lab/kit/palette";
import { easeAt, springRate, springResponse, type Timing } from "@/components/lab/kit/timing";
import { useReducedMotion } from "@/lib/motion";

const WIDTH = 260;
const HEIGHT = 120;
/** The chart spans this many settle times, so the spring's tail shows. */
const SPAN = 1.6;

interface Chart {
  readonly ctx: CanvasRenderingContext2D;
  readonly palette: LabPalette;
  readonly settle: number;
  readonly timing: Timing;
}

function draw({ ctx, palette, settle, timing }: Chart, at: number | null): void {
  const rate = springRate(settle);
  const pad = 10;
  const w = WIDTH - pad * 2;
  const h = HEIGHT - pad * 2;
  const x = (t: number) => pad + (t / (settle * SPAN)) * w;
  const y = (v: number) => pad + h - v * h;
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x(settle), pad);
  ctx.lineTo(x(settle), pad + h);
  ctx.moveTo(pad, y(1));
  ctx.lineTo(pad + w, y(1));
  ctx.stroke();
  const curves: [string, (t: number) => number][] = [
    [palette.hue, (t) => easeAt(timing.settle, Math.min(1, t / settle))],
    [palette.accent, (t) => springResponse(t, rate)],
  ];
  for (const [color, curve] of curves) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const t = (i / 96) * settle * SPAN;
      if (i === 0) ctx.moveTo(x(t), y(curve(t)));
      else ctx.lineTo(x(t), y(curve(t)));
    }
    ctx.stroke();
    if (at !== null) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x(at), y(curve(at)), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function CurvePanel({ values, timing }: { values: LabControlValues; timing: Timing }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const settle = numberOf(values, "settle", timing.follow * 1000) / 1000;
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d") ?? null;
    if (el === null || ctx === null) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = WIDTH * dpr;
    el.height = HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Read once per mount; the page remounts the panel when the theme flips.
    const chart: Chart = { ctx, palette: readLabPalette(), settle, timing };
    // Reduced motion: the two curves, still, with no marker running (M7).
    if (reduced) {
      draw(chart, null);
      return undefined;
    }
    let frame = 0;
    const start = performance.now();
    const loop = (now: number) => {
      const cycle = settle * SPAN + 0.6;
      draw(chart, Math.min(settle * SPAN, ((now - start) / 1000) % cycle));
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [settle, timing, reduced]);
  return (
    <figure className="pointer-events-auto w-[284px] rounded-lg border border-foreground/10 bg-popover/85 p-3 text-label shadow-lg backdrop-blur-md">
      <canvas ref={canvas} style={{ width: WIDTH, height: HEIGHT }} aria-hidden="true" />
      <figcaption className="mt-1.5 flex gap-3 text-foreground/55">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[var(--lab-hue)]" />
          ease (--motion-settle)
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[var(--lab-accent)]" />
          critically damped spring
        </span>
      </figcaption>
    </figure>
  );
}
