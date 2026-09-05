import { storeBenchmark } from "@kb/test-kit";
import { JsonlStore } from "../src/index.ts";

storeBenchmark("JsonlStore", (root) => new JsonlStore(root));
