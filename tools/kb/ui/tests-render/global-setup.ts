import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";

const URL = "http://127.0.0.1:4323/api/graph";

export default async function globalSetup() {
  const server = spawn("bun", ["tests-render/server.ts"], {
    cwd: process.cwd(),
    stdio: "inherit",
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(URL);
      if (response.ok) break;
    } catch {
      // The process needs a moment to load the data root and bind its port.
    }
    await setTimeout(100);
  }
  if (Date.now() >= deadline) {
    server.kill("SIGTERM");
    throw new Error(`render harness UI did not start at ${URL}`);
  }

  return async () => {
    if (server.exitCode === null) {
      if (!server.killed) server.kill("SIGTERM");
      await once(server, "exit");
    }
  };
}
