// Polyfill WebGL2RenderingContext for sigma.js in test environment.
if (typeof globalThis.WebGL2RenderingContext === "undefined") {
  (globalThis as Record<string, unknown>).WebGL2RenderingContext = {
    BOOL: 0x8b56,
    BYTE: 0x1400,
    UNSIGNED_BYTE: 0x1401,
    SHORT: 0x1402,
    UNSIGNED_SHORT: 0x1403,
    INT: 0x1404,
    UNSIGNED_INT: 0x1405,
    FLOAT: 0x1406,
  };
}
if (typeof globalThis.WebGLRenderingContext === "undefined") {
  (globalThis as Record<string, unknown>).WebGLRenderingContext = {};
}
// Neither test DOM ships IntersectionObserver. A stand-in that never reports
// leaves an observed element counted as visible, as a browser does before its
// first report.
if (typeof globalThis.IntersectionObserver === "undefined") {
  (globalThis as Record<string, unknown>).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
}
