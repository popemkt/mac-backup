# t4-favicon Report

## 16 px Glyph Description
An outliner glyph with a warm amber root bullet and an indented child bullet connected by an L-shaped guide line.

## SVG Source (`tools/kb/packages/ui/public/favicon.svg`)
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <style>
    .guide { stroke: #78716c; fill: none; stroke-width: 3; stroke-linecap: round; }
    .root { fill: #d97706; }
    .child { fill: #1c1917; }
    @media (prefers-color-scheme: dark) {
      .guide { stroke: #a8a29e; }
      .root { fill: #f59e0b; }
      .child { fill: #f5f5f4; }
    }
  </style>
  <path class="guide" d="M10 10v8a4 4 0 0 0 4 4h8" />
  <circle class="root" cx="10" cy="10" r="5.5" />
  <circle class="child" cx="22" cy="22" r="4.5" />
</svg>
```

- **Size**: 532 bytes (≤ 1 KB limit satisfied)
- **Shapes**: 3 shapes (1 `<path>` guide line, 2 `<circle>` bullets)
- **Dependencies**: No raster images, no external fonts
- **Theme inversion**: Explicit fills with `@media (prefers-color-scheme: dark)` (no `currentColor`) adapting between light and dark tabs

## Derived Assets
- `tools/kb/packages/ui/public/apple-touch-icon.png` (180×180): generated directly from `favicon.svg` using macOS built-in `sips` (`sips -s format png -z 180 180 ...`), adding zero dependencies.
- `favicon.svg` is preserved as the canonical source of truth and was not deleted or overwritten.

## HTML Links (`tools/kb/packages/ui/index.html`)
The `<head>` links the SVG favicon first, followed by the apple-touch-icon:
```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

## Verification
- `bun run --filter @kb/ui build` succeeded: `tools/kb/packages/ui/dist/favicon.svg` and `tools/kb/packages/ui/dist/apple-touch-icon.png` exist and are wired in `dist/index.html`.
- `bun run verify` in `tools/kb` passed cleanly: typecheck (17 packages), lint, fmt:check, knip, 50 harness tests passed.
- Visual inspection at 16×16 px: crisp outliner hierarchy with high-contrast amber root and child bullet.
