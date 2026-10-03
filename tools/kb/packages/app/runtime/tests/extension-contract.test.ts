import { extensionContract } from "@kb/test-kit";
import { BUNDLED_EXTENSIONS } from "../src/bundled.ts";

// Every family the server bundles keeps the one extension contract.
for (const { declaration, entry } of BUNDLED_EXTENSIONS) extensionContract(declaration, entry);
