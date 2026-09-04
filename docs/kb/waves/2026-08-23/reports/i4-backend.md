# Report i4-backend — Implementation

Wave: 2026-08-23 · Agent: cursor-agent · Zone: foundation / operations / extensions / ext-sdk.

## Implementation handoff

### What shipped

1. **Extension SDK (r6 design, normative)**
   - `tools/kb/src/ext-sdk/surface.ts` — self-contained public types (no Effect/zod imports) so declaration emit stays portable.
   - `tools/kb/scripts/gen-ext-sdk.ts` — `tsc --emitDeclarationOnly` → ambient `declare module "kb-ext-sdk"`.
   - `tools/kb/src/ext-sdk/sdk-dts.text.ts` — GENERATED committed `KB_SDK_DTS` string (embeds in CLI/Nix bundle with zero packaging changes).
   - `tools/kb/src/ext-sdk/emit.ts` — `writeSdkDts(root)` / `readEmbeddedSdkDts()`.
   - CLI: `kb ext sdk` (stdout) and `kb ext sdk --write` → `.kb/sdk.d.ts`.
   - Tests: freshness byte-equality, CLI write + loader ignores `.d.ts`, scratch author fixture typechecks with zero repo-relative imports and loads at runtime; bad `mode: "reed"` fails tsc.
   - Docs in-zone: `tools/kb/DESIGN.md` Extension SDK paragraph; `tools/kb/README.md` author quickstart.
   - `package.json` script: `gen:ext-sdk`.

2. **Stage-0 JSONL hardening (r4, cheap/safe only)**
   - Exclusive `.kb/nodes.jsonl.lock` covering load → mutate → replace (`write-lock.ts`), Effect.sleep spin (no event-loop-blocking sleep).
   - Durable replace: write+fsync tmp, rotate `.bak` (+fsync), rename, best-effort dir fsync (`durable-replace.ts`).
   - On-disk JSONL format unchanged; HTTP/WS untouched; bundled `docs.ts` behavior unchanged.
   - Tests: concurrent commits keep all writers' nodes; stale lock stolen.

### Judgment calls

- **Surface is self-contained, not a re-export barrel.** Re-exporting live modules would drag Effect/zod into the ambient d.ts and break the Nix/no-deps author story. Freshness + author tsc fixtures guard drift; full Real↔Sdk mutual assignability of `ExtensionPromiseHandler` was not enforced (Sdk `KbContext` is the Promise-handler subset `{root,nodes}`).
- **CLI `ext sdk` edited in `surface/cli.ts`.** Brief zone lists “SDK emission step”; treated as in-zone. Listed under shared-file touches below.
- **`DESIGN.md` / `README.md` updated** for the author loop (research MUST). Repo-root `AGENTS.md` one-liner deferred to orchestrator/F wave (outside zone).
- **Skipped** SQLite migration, revision/CAS manifest, streaming load, `_*.ts` helper ignore — out of scope or follow-ups.
- **Replaced** Effect-FS rename mock atomicity test with lock concurrency + stale-lock tests (write path is now node:fs durable protocol).

### Shared-file / out-of-narrow-zone touches

| Path | Why |
|---|---|
| `tools/kb/src/surface/cli.ts` | `kb ext sdk [--write]` emission command |
| `tools/kb/DESIGN.md` | Extension SDK author contract (research MUST) |
| `tools/kb/README.md` | Author quickstart |
| `tools/kb/package.json` | `gen:ext-sdk` script (in zone) |

### Cut / follow-ups

- AGENTS.md / CLAUDE.md one-liner for `kb ext sdk --write` (orchestrator docs pass).
- Optional: ignore `_*.ts` helper siblings in `discoverExtensions`.
- Optional: pre-commit hook running freshness check alongside `docs.check`.
- r4 remainder: revision/CAS, verified generation rotation, streaming load, SQLite stages — later waves.
- npm `exports` map for `kb-ext-sdk` if kb is ever published (r6 option a).

### Verification

- `bun test` — 441 pass / 0 fail (after `ui` deps install in this worktree)
- `npm run typecheck` — clean
- `npm run check` — clean
- `cd ui && vp test` — 47 files / 264 tests pass
- Manual `/tmp/kb-i4-sdk-accept`: `ext sdk --write`, tsc clean, `ext.greet.hi` invokes

### Self-grade

**A-** against the quality bar. SDK is ground-up (self-describing binary, freshness gate, verified author walkthrough). Stage-0 durability/locking is real but not crash-injection complete (no power-loss / F_FULLFSYNC / revision CAS). Honest gap: Sdk `KbContext` is intentionally narrower than live session; authors needing store/qdb still lack typed access without reaching into core.
