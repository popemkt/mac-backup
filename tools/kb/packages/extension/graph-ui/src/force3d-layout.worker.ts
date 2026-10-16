/**
 * The 3D layout's worker: the page's `startLayout3d` talks to this; the
 * protocol and the simulation are `force3d-layout.ts`'s.
 */
import { serveLayout, type LayoutReply, type LayoutRequest } from "./force3d-layout";

serveLayout({
  addEventListener: (type, listener) =>
    self.addEventListener(type, (event: MessageEvent<LayoutRequest>) => listener(event)),
  postMessage: (message: LayoutReply, options) => self.postMessage(message, options),
});
