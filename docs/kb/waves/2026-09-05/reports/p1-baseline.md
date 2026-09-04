# p1 store baseline

Measured on an Apple M4 MacBook Pro (10 cores, 24 GB), arm64 macOS 26.6.2,
with Bun 1.3.14. The fixture contains 50,000 synthetic nodes plus 76 system and
benchmark nodes. These measurements are observations, not gates; Phase 4 owns
measured performance thresholds.

| phase | baseline ms |
|---|---:|
| read | 3.7 |
| decode | 129.6 |
| datom build | 162.5 |
| query | 44.7 |
| `kb set`-shaped commit | 248.5 |
| interactive edit | 399.3 |

`decode` measures the real JSONL decode unit against the already-read file
contents. The commit measurement includes the store's load, single-node upsert,
canonical serialization, and durable replace; the interactive edit adds the
surface-style reload before committing the edited node.
