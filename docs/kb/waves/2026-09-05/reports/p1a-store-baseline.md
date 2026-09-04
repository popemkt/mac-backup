# p1a store baseline — report

Environment: Apple M4 MacBook Pro (10 cores, 24 GB), arm64 macOS 26.6.2,
Bun 1.3.14, 50,076 total fixture nodes.

## Before

| phase | ms |
|---|---:|
| read | 3.7 |
| decode | 129.6 |
| datom build | 162.5 |
| query | 44.7 |
| `kb set`-shaped commit | 248.5 |
| interactive edit | 399.3 |

## After

| phase | median ms |
|---|---:|
| read | 5.1 |
| decode | 115.1 |
| datom build | 242.2 |
| query | 46.8 |
| `kb set`-shaped commit | 161.0 |
| interactive edit | 228.8 |

The after values are medians of three runs. Decode ranged from 98.9–135.6 ms;
its median improved by 14.5 ms (11.2%) from the baseline observation. These are
recorded observations, not gates, and the non-decode changes should be treated
as process/machine-load variance rather than attributed to batched decoding.

The implementation now decodes a complete JSONL document inside one
`Effect.try`, using synchronous schema decoding while retaining line-numbered,
fail-closed `DomainError`s. `KbNodeSchema` now declares optional `order`; finite
numeric props and the `.kb/nodes.jsonl.lock` / `.kb/cache/` ignores were already
present on the wave base, and the round-trip property generator now exercises
both `order` and preserved excess properties.

## Store note for p1b

`JsonlStore.commitEffect` performs a locked reload/merge/replace but returns no
merged node snapshot. If p1b applies only the caller's transaction to an
in-memory index after commit, it should account for concurrent external writes
that the store may have merged during that locked reload; otherwise the index
can lag the committed JSONL until a later full reload.
