import { buildHarnessUi } from "./harness-server.ts";

/** One UI build per suite; each test starts its own server over it (`harness-test.ts`). */
export default function globalSetup() {
  buildHarnessUi();
}
