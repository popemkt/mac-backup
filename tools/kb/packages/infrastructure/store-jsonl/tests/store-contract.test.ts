/**
 * JsonlStore against the shared store contract. The properties live in
 * `@kb/test-kit` because they are the port's, not this adapter's; what is
 * specific to JSONL — the `.lock` file, `.bak` rotation, line-numbered decode
 * errors — is tested where that behaviour is described.
 */
import { storeContract } from "@kb/test-kit";
import { JsonlStore } from "../src/index.ts";

storeContract("JsonlStore", (root) => new JsonlStore(root));
