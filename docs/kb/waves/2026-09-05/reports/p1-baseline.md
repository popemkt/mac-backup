# p1 store baseline

Measured on an Apple M4 MacBook Pro (10 cores, 24 GB), arm64 macOS 26.6.2,
with Bun 1.3.14. The fixture contains 50,000 synthetic nodes plus 76 system and
benchmark nodes. These measurements are observations, not gates; Phase 4 owns
measured performance thresholds.

| phase | baseline ms | after ms |
|---|---:|---:|
| read | 3.7 | 5.1 |
| decode | 129.6 | 115.1 |
| datom build | 162.5 | 242.2 |
| query | 44.7 | 46.8 |
| `kb set`-shaped commit | 248.5 | 161.0 |
| interactive edit | 399.3 | 228.8 |

`decode` measures the real JSONL decode unit against the already-read file
contents. The commit measurement includes the store's load, single-node upsert,
canonical serialization, and durable replace; the interactive edit adds the
surface-style reload before committing the edited node.

The after column is the median of three post-change runs. Decode ranged from
98.9–135.6 ms, so the observed median improvement is 14.5 ms (11.2%); the
non-decode movements are benchmark-process and machine-load variance, not
effects attributed to the decode-loop change.
