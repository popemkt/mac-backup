// HTML-in-Canvas (WICG html-in-canvas, Chrome's `CanvasDrawElement`): a
// canvas lays out its own children and can upload one of them, rendered, as a
// WebGL texture. Detected by method name only, across both API generations
// (https://developer.chrome.com/blog/html-in-canvas-ot-changes):
//
// | Chrome  | canvas markup                         | WebGL upload                                         |
// |---------|---------------------------------------|------------------------------------------------------|
// | < 150   | `layoutsubtree`                       | `texElementImage2D(target, level, ifmt, fmt, type, el)` |
// | 150–154 | `layoutsubtree`                       | `texElementImage2D(target, RGBA8, el)` (length 3)    |
// | 155+    | `content="drawable"`, `drawable` child | `texElementSubImage2D(target, level, x, y, el)` into storage from `texImage2D(…, null)` |
//
// The markup and the upload are detected separately: Chromium 154 already has
// `texElementSubImage2D` but still the `layoutsubtree` markup. Without the
// flag (or the origin trial) none of these names exist, and lively draws its
// effects with CSS instead.

/** How an element's rendering reaches a WebGL texture. */
export type DrawableUpload = "sub-image" | "image-3" | "image-6";
/** How a canvas is told to lay out its children. */
export type DrawableMarkup = "content" | "layoutsubtree";

export interface Drawable {
  readonly markup: DrawableMarkup;
  readonly upload: DrawableUpload;
  /** Make `canvas` lay out its children, and `child` one it can draw. */
  prepare(canvas: HTMLCanvasElement, child: Element): void;
  /** Ask for a `paint` event (the moment a child's rendering is ready to upload). */
  requestPaint(canvas: HTMLCanvasElement): void;
  /** Upload `child`'s current rendering into the TEXTURE_2D bound on `gl`; its size in device pixels. */
  draw(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement, child: Element): { readonly width: number; readonly height: number };
}

/** The parts of the 155+ and pre-155 APIs lively calls, which TypeScript's DOM types do not have yet. */
interface DrawableGl {
  texElementSubImage2D?(target: number, level: number, x: number, y: number, element: Element): void;
  texElementImage2D?(...args: ReadonlyArray<unknown>): void;
}
interface DrawableCanvas {
  requestPaint?(): void;
  captureElementImage?(element: Element): { readonly width: number; readonly height: number };
}

/** The browser's HTML-in-Canvas, or undefined when it has none (no flag, no trial, no WebGL 2). */
export function detectDrawable(win: Window): Drawable | undefined {
  // Either may be missing (no WebGL 2, a DOM without canvases), whatever the DOM types say.
  const scope = win as unknown as { WebGL2RenderingContext?: { prototype: DrawableGl }; HTMLCanvasElement?: { prototype: object } };
  const gl = scope.WebGL2RenderingContext?.prototype;
  const canvasProto = scope.HTMLCanvasElement?.prototype;
  if (gl === undefined || canvasProto === undefined) return undefined;
  const upload: DrawableUpload | undefined =
    "texElementSubImage2D" in gl ? "sub-image" : "texElementImage2D" in gl ? (gl.texElementImage2D?.length === 3 ? "image-3" : "image-6") : undefined;
  if (upload === undefined) return undefined;
  const markup: DrawableMarkup = "content" in canvasProto ? "content" : "layoutsubtree";
  return {
    markup,
    upload,
    prepare: (canvas, child) => {
      if (markup === "content") {
        canvas.setAttribute("content", "drawable");
        child.setAttribute("drawable", "");
      } else canvas.setAttribute("layoutsubtree", "");
    },
    requestPaint: (canvas) => (canvas as HTMLCanvasElement & DrawableCanvas).requestPaint?.(),
    draw: (context, canvas, child) => {
      const target = context.TEXTURE_2D;
      const api = context as WebGL2RenderingContext & DrawableGl;
      const size = elementSize(win, canvas, child);
      if (upload === "sub-image") {
        // 155+: the upload no longer allocates; size the storage first, as texSubImage2D.
        context.texImage2D(target, 0, context.RGBA8, size.width, size.height, 0, context.RGBA, context.UNSIGNED_BYTE, null);
        api.texElementSubImage2D?.(target, 0, 0, 0, child);
      } else if (upload === "image-3") api.texElementImage2D?.(target, context.RGBA8, child);
      else api.texElementImage2D?.(target, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, child);
      return size;
    },
  };
}

/** A child's rendered size in device pixels: what the browser captures, else its box at the device pixel ratio. */
function elementSize(win: Window, canvas: HTMLCanvasElement, child: Element): { width: number; height: number } {
  const captured = (canvas as HTMLCanvasElement & DrawableCanvas).captureElementImage?.(child);
  if (captured !== undefined && captured.width > 0 && captured.height > 0) {
    return { width: Math.ceil(captured.width), height: Math.ceil(captured.height) };
  }
  const box = child.getBoundingClientRect();
  const ratio = win.devicePixelRatio || 1;
  return { width: Math.max(1, Math.ceil(box.width * ratio)), height: Math.max(1, Math.ceil(box.height * ratio)) };
}
