#!/usr/bin/env bash
# One serial pass over every candidate, so no two runs contend for the machine.
# Every number in ../README.md comes from a single invocation of this script.
set -euo pipefail
cd "$(dirname "$0")"

# One pass at a time. Two concurrent passes contend for CPU and skewed an
# earlier draft's cold-load numbers by up to 5x, which is exactly the kind of
# measurement error a benchmark must not make quietly.
exec 9>.run-all.lock
flock -n 9 2>/dev/null || {
  if command -v flock >/dev/null; then echo "another run-all.sh is running" >&2; exit 1; fi
}

echo "=== regenerating fixtures ==="
bun gen.ts --datoms 100000 --out data/100k.jsonl
bun gen.ts --datoms 1000000 --out data/1m.jsonl

for scale in 100k 1m; do
  echo; echo "############ scale=$scale ############"
  bun run-datascript.ts --scale "$scale"
  bun run-datascript.ts --scale "$scale" --snapshot
  bun run-sqlite.ts     --scale "$scale"
  bun run-sqlite.ts     --scale "$scale" --file
  bun run-duckdb.ts     --scale "$scale"
  bun run-oxigraph.ts   --scale "$scale"
  bun run-maps.ts       --scale "$scale"
  bun run-ladybug.ts    --scale "$scale"
  bun run-browser.ts    --scale "$scale" --candidate sqljs
  bun run-browser.ts    --scale "$scale" --candidate wasqlite
done

echo; echo "=== tables ==="
bun report-tables.ts
