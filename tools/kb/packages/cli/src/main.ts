#!/usr/bin/env bun
// The one process entrypoint for the kb CLI. `bin/kb` and the Nix bundle both
// exec this file; `cli.ts` stays importable (tests drive `main(argv)`).
import { main } from "./cli.ts";

const code = await main();
process.exit(code);
