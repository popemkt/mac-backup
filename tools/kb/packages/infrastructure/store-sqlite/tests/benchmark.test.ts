import { storeBenchmark } from "@kb/test-kit";
import { SqliteStore } from "../src/index.ts";

storeBenchmark("SqliteStore", (root) => new SqliteStore(root));
