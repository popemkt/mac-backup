import { buildHarnessUi, startHarness } from "./harness-server.ts";

export default async function globalSetup() {
  buildHarnessUi();
  const { stop } = await startHarness();
  return stop;
}
