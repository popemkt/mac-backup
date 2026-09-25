/**
 * The 3D layout's worker: it owns the simulation (`force3d-layout.ts`) and
 * posts positions back in the two buffers the page lends it.
 */
import { driveLayout, type LayoutReply, type LayoutRequest } from "./force3d-layout";

let driver: ReturnType<typeof driveLayout> | null = null;
const free: Float32Array[] = [];

self.addEventListener("message", (event: MessageEvent<LayoutRequest>) => {
  const request = event.data;
  if (request.type === "seed") {
    driver?.stop();
    free.length = 0;
    free.push(...request.buffers);
    driver = driveLayout(
      request.seed,
      () => free.pop() ?? null,
      (positions, running) => {
        const reply: LayoutReply = { type: "positions", positions, running };
        self.postMessage(reply, { transfer: [positions.buffer] });
      },
    );
  } else if (request.type === "reheat") driver?.reheat(request.params);
  else free.push(request.buffer);
});
