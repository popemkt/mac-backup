import { startHarness } from "./harness-server.ts";

export default async function globalSetup() {
  const { stop } = await startHarness();
  return stop;
}
