import { beforeAll } from "vitest";

// The shell's tests run in a page: before a file's own hooks, the UI kernel
// holds the shell's host, as the app's does, so a family reaching the page
// through it (`browserHost()`) finds it. It is loaded once the file's module
// has been evaluated, so a module the file mocks is mocked for the host too,
// and only when nothing has provided it: a file whose page loaded its own
// plugins (the App does, as it is imported) keeps them. A test that loads
// its own plugins keeps the host with them (`syncPagePlugins`); one that
// syncs the kernel bare unloads it.
beforeAll(async () => {
  const [{ BrowserHostService, currentService, syncUiPlugins }, { browserHostUiPlugin }] =
    await Promise.all([import("@kb/ui-sdk"), import("@/browser-host")]);
  if (currentService(BrowserHostService) === undefined) syncUiPlugins([browserHostUiPlugin]);
});

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
