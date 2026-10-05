# kb dependency upgrade survey (tools/kb), 2026-10-04

Written to /tmp because `.claude/research/` is not git-ignored in the dotfiles repo.

## Method and caveats
- Sources: `tools/kb/package.json` `workspaces.catalog`, every `packages/*/*/package.json`, `bun.lock` (resolved versions), `npm view` / registry dist-tags, `bun outdated`, `bun audit`.
- **Drift check: no package is pinned outside the catalog.** Every dependency in `packages/*/*/package.json` is `catalog:` or `workspace:*`. The only duplicate pins are root `overrides` (`vite`, `vitest`) which repeat the catalog values by hand (`vite-plus-core@0.2.8`, `vitest 4.1.10`) -- a mirror that has to be bumped together with the catalog.
- `bun outdated` under-reports (it listed 11 rows). The table below uses `bun.lock` resolved versions vs npm `latest`. "current" = resolved in lock.
- Bun itself: **1.4.2 = latest (1.4.2)**. Bun is supplied by the nix flake / dev shell, not by CI setup-bun; `@types/bun` is the only lag (1.3.14 -> 1.4.2).
- Kind is relative to the resolved version. Risk is my judgement for this codebase. Code counts are files under `packages/` (ts/tsx, excluding node_modules).

## Table

| package | current | latest | kind | risk | notes |
|---|---|---|---|---|---|
| effect | 4.0.0-rc.112 | 4.0.0 (rc.118 tag) | prerelease -> stable | med | Exact pin. 240 files import effect. Stable released 2026-10-01. rc.113-118 + 4.0.0 patch notes mention `Schema.brand`/`fromBrand` restriction (0 uses here) and `Queue.State.takers` entries now `Queue.Taker` with `.resume()` (0 `Queue.takeN` uses), `Effect.race*` now interrupts losers (1 file uses `Effect.race`), `Cache`/`MutableHashMap` fixes. Release notes: https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0 and rc.113..rc.118 tags. Must move together with platform-bun and @effect/tsgo. |
| @effect/platform-bun | 4.0.0-rc.112 | 4.0.0 | prerelease -> stable | low | 6 files. Version-lockstep with effect. |
| @effect/tsgo | 0.40.0 | 0.48.0 | minor (0.x = breaking-capable) | med | `prepare` runs `effect-tsgo patch`, which patches TypeScript 7; 8 minors behind. Releases: https://github.com/Effect-TS/tsgo/releases . Verify patch applies against typescript 7.0.2 and still pairs with effect 4.0.0. |
| vite-plus | 0.2.8 | 1.0.0 | major (0.x -> 1.0) | high | Bundles vite 8.3.1, rolldown 1.2.11, vitest 5.0.1, oxlint 1.85.0, oxfmt 0.70.0. 1.0 requires Node ^22.18 / ^24.11 / >=26 for the CLI; 0.3 -> 1.0 guide says run `vp migrate` BEFORE updating deps; `run.tasks` cache settings moved under `cache`; `vp lint`/`vp fmt` config resolution changed (kb relies on per-package `vite.config.ts` `lint`/`check` blocks, see packages/app/ui/vite.config.ts). Notes: https://github.com/voidzero-dev/vite-plus/releases/tag/v1.0.0 , guide https://viteplus.dev/guide/migrate#upgrade-from-vite-0-3-to-1-0 . Used by `fmt`/`fmt:check` (root scripts) and 5 packages' `vp test`. |
| vite (npm:@voidzero-dev/vite-plus-core) | 0.2.8 | 1.0.0 | major | high | Alias of vite-plus-core; hand-pinned in catalog AND root `overrides`. Bump in lockstep with vite-plus. |
| vitest | 4.1.10 | 5.0.3 (also 4.1.11) | major | high | Exact pin + root override; vite-plus 1.0 bundles 5.0.1, so the override must be dropped/raised with it. Breaking (https://github.com/vitest-dev/vitest/releases/tag/v5.0.0 , https://vitest.dev/blog/vitest-5.html): hoisted methods (`vi.mock`/`vi.hoisted`) throw outside top level (16 files use them); mocks cleared by default before each test (10 files touch clearMocks/mockClear/mockReset); `expect.poll` now fails on timeout (4 files); `sequential` option removed (0 uses); `toHaveTextContent` strict (0 uses); happy-dom/jsdom window mutable; requires Node 22 + Vite 6.4; config no longer looked up from ancestor dirs (relevant: nested package vite.config.ts vs tools/kb/vite.config.ts); `@vitest/runner`/`expect` inlined; deprecated entry points removed. 233 files `import ... from "vitest"` but most packages run `bun test` (29 packages) -- only ui, lab-ui, scene, scene-gpu, ui-sdk run `vp test`; confirm which actually resolve the vitest package vs bun's shim. **Security: 4.1.10 is affected by GHSA-82fw-gwwq-j7x9 (@vitest/mocker path traversal, fixed 4.1.11).** |
| @vitejs/plugin-react | 5.2.0 | 6.1.1 | major | med | 6.x drops Babel (needs Vite 8+; removes the `babel` option -> use `@rolldown/plugin-babel`). Notes: https://github.com/vitejs/vite-plugin-react/releases/tag/plugin-react%406.0.0 . kb uses `react()` with no options in packages/app/ui/vite.config.ts (0 babel usage), so only the Vite 8 prerequisite matters: take with vite-plus 1.0. |
| commander | 13.1.0 | 15.0.0 | major (2) | low | 1 file imports it (CLI). v14 + v15 breaking: v15 ESM-only, Node >= 22.12, lone `--no-*` option default semantic change (2 `--no-` option sites in code -- check), removed `commander/esm.mjs`. Notes: https://github.com/tj/commander.js/releases/tag/v15.0.0 . Bun handles ESM fine. |
| vitest-related: happy-dom | 20.13.2 | 20.14.5 | minor | low | 69 files; fine unless vitest 5 window-mutability changes interplay. |
| typescript | 7.0.2 | 7.0.2 | current | - | `next` = 7.1.0-dev. Nothing to do. |
| nx | 23.2.0 | 23.2.1 | patch | low | |
| oxlint | 1.83.0 | 1.86.0 | minor | low-med | Exact pin; new rules/default changes can add lint failures (`--report-unused-disable-directives-severity=error`; repo uses GAP disable comments). Must match @oxlint/plugins and oxlint-tsgolint. vite-plus 1.0 bundles 1.85. |
| @oxlint/plugins | 1.83.0 | 1.86.0 | minor | low | Lockstep with oxlint. |
| oxlint-tsgolint | 7.0.2002 | 7.0.2003 | patch | low | |
| oxc-parser | 0.148.0 | 0.152.0 | minor (0.x) | low-med | 0.x semver; 1 AST consumer -- run the harness/check-audit. |
| knip | 6.32.2 | 6.39.0 | minor | low | Exact pin; can surface new unused-export findings. |
| @types/bun | 1.3.14 | 1.4.2 | minor | low | Matches Bun 1.4.2 already in use. |
| @anthropic-ai/claude-agent-sdk | 0.3.287 | 0.3.289 | patch | low | 0.x; 1 file. |
| @modelcontextprotocol/sdk | 1.30.0 | 1.32.0 | minor | low | 9 files. Also pulls patched transitive hono/ip-address ranges (see security). |
| react / react-dom | 19.2.8 | 19.3.0 | minor | low-med | Check release notes https://github.com/facebook/react/releases ; no deprecated APIs expected. Move with @types/react. |
| @types/react / @types/react-dom | 19.2.18 / 19.2.7 | 19.3.0 | minor | low | Pair with react 19.3. |
| tailwindcss, @tailwindcss/vite, /node, /oxide | 4.3.3 | 4.3.3 | current | - | Declared `^4.0.6` floor is stale but lock is current. |
| tailwind-merge | 3.6.0 | 3.7.0 | minor | low | 2 files. |
| storybook, @storybook/react, react-vite, addon-a11y | 10.6.0 | 10.6.1 | patch | low | Declared `^10.5.10`. |
| playwright | 1.62.1 | 1.63.0 | minor | low-med | Browser binaries re-download; render-tests (`packages/.../render-tests`) golden screenshots may shift -> check test:render. |
| zod | 4.4.3 | 4.6.5 | minor | low | 33 files; check `z.toJSONSchema`/error-format usage if any. |
| zustand | 5.0.15 | 5.0.15 | current | - | |
| fast-check | 4.9.0 | 4.10.2 | minor | low | 22 files; new default seeds/arbitraries can find new counterexamples. |
| three / @types/three | 0.186.1 / 0.186.0 | 0.186.1 / 0.186.0 | current | - | 54 files use three/webgpu or tsl (high churn library; keep exact-minor). Declared `^0.186.1` (caret on 0.x only floats patch). |
| vega / vega-lite / vega-interpreter | 6.4.0 / 6.4.3 / 2.3.2 | same | current | - | |
| sigma, @sigma/*, graphology* , d3-* | current | current | current | - | Several are stale-by-design: graphology 0.26.0 (2025-01), graphology-layout-noverlap 0.4.2 (2022), graphology-layout 0.6.1 (2022), d3-hierarchy 3.1.2 (2022). Low maintenance activity, no known advisories. forceatlas2 0.11.0-rc1 exists (rc only, ignore). |
| datascript, ulid, clsx, dockview-react, @phosphor-icons/react, @fontsource-variable/*, quickjs-emscripten-core, @jitl/quickjs-*, @stryker-mutator/core, bun2nix, d3-force-3d | current | current | current | - | @phosphor-icons/react last published 2025-05 and d3-force-3d 2025-04 (quiet but not deprecated). bun2nix is also pinned in /Users/popemkt/.dotfiles/flake.nix (`github:nix-community/bun2nix/2.1.2`) -- two pins that must be kept in step (documented there). |

Counts: 58 catalog entries. Updates available: major 4 (vite-plus, vite alias, vitest, @vitejs/plugin-react, commander counts as 5 total majors if the vite alias is counted separately: vite-plus, vite, vitest, plugin-react, commander), prerelease->stable 2 (effect, platform-bun), minor 17-ish (incl. 0.x: @effect/tsgo, oxc-parser, oxlint, @oxlint/plugins, knip, @types/bun, mcp sdk, react, react-dom, @types/react(-dom), tailwind-merge, playwright, zod, fast-check, happy-dom), patch 5 (nx, oxlint-tsgolint, claude-agent-sdk, storybook x4 = patch), up to date ~28. No dependency is flagged `deprecated` on npm.

## Security (`bun audit`: 35 vulnerabilities, 15 high / 20 moderate)
Printed tail only covered the last entries; high ones not printed above include more -- rerun `bun audit` for the full list. Seen:
- **smol-toml <=1.7.0 (HIGH, DoS via malformed TOML, GHSA-7w5x-hrqm-74c2)**, transitive via knip and nx (1.8.0 / 1.6.1 resolved). Dev-time only; fixed by bumping knip/nx or an `overrides` entry.
- vitest 4.1.10 (moderate, @vitest/mocker path traversal, GHSA-82fw-gwwq-j7x9): fix = 4.1.11 or 5.x. Dev server/test only.
- hono 4.13.1 (moderate x4, GHSA-gqvv-2mrq-wpjv, -g6gw-c38x-mqfc, -crvj-82cr-hjcx, -hxh3-vqpv-xpqv): via @modelcontextprotocol/sdk > @hono/node-server. Needs hono >= 4.13.7; `bun audit fix` can lift within range (sdk allows ^4.11.4). Relevant if the MCP server uses the HTTP transport.
- ip-address 10.4.0 (moderate x4), qs 6.15.1/6.15.3 (moderate x3): via MCP sdk > express(-rate-limit) and stryker. Express-based HTTP transport only.
- The remaining high items are not shown in my captured output; run `bun audit` in tools/kb to list them before batch 1.
None are runtime-facing for the outliner UI as far as the shown ones go; they hit the MCP HTTP stack and dev tooling.

## Suggested batches

**Batch 1 -- safe patch/minor, one commit.** nx 23.2.1, oxlint-tsgolint 7.0.2003, @anthropic-ai/claude-agent-sdk 0.3.289, @modelcontextprotocol/sdk 1.32.0, storybook family 10.6.1, @types/bun 1.4.2, tailwind-merge 3.7.0, zod 4.6.5, fast-check 4.10.2, happy-dom 20.14.5, knip 6.39.0, react/react-dom/@types/react(-dom) 19.3.0, playwright 1.63.0; then `bun audit fix` for hono/qs/ip-address/smol-toml (lockfile-only, within ranges). Run `bun run verify` (typecheck, lint, fmt:check, harness, check:audit), `bun run test:ui`, `bun run test:render` (playwright and react bumps can move screenshots), regenerate `bun.nix` (postinstall runs bun2nix) and commit it. If knip finds new issues, split knip out. Include vitest 4.1.11 here as the stopgap CVE fix if batch 4 is deferred (change catalog + root override together).

**Batch 2 -- oxlint toolchain.** oxlint + @oxlint/plugins 1.86.0 together, plus oxc-parser 0.152.0. Check: `bun run lint` for new rule hits and unused-disable-directive errors (GAP comments), custom plugins in @oxlint/plugins still load, the one oxc-parser consumer. Land on its own so lint noise is not confused with other breakage.

**Batch 3 -- Effect 4.0.0 stable.** effect + @effect/platform-bun to 4.0.0 and @effect/tsgo to 0.48.0 together (the `prepare` patch step). Check: `bun install` runs `effect-tsgo patch` cleanly on typescript 7.0.2; typecheck across all 240 effect files; the `Effect.race` call site (loser interruption now guaranteed); no `Schema.brand`/`Queue.takeN` usage (confirmed 0); full harness + `test:dst`. Read rc.113..rc.118 and 4.0.0 changelogs for the area you touch (Cache, Atom, event-log, workflow items are likely irrelevant).

**Batch 4 -- Vite+ 1.0 stack (the big one).** vite-plus 1.0.0, vite alias 1.0.0, vitest 5.x, @vitejs/plugin-react 6.1.1 together, dropping/aligning the root `overrides` (`vite`, `vitest`). Follow https://viteplus.dev/guide/migrate#upgrade-from-vite-0-3-to-1-0 : run `vp migrate` first. Check: the per-package `vite.config.ts` `lint`/`check` blocks still apply (config-lookup-from-ancestor change in vitest 5, `vp lint`/`vp fmt` resolution change); `fmt:check` output diffs (oxfmt 0.70); 16 `vi.mock`/`vi.hoisted` files (top-level rule), 10 mock-clearing files (default clear-before-each), 4 `expect.poll` files; happy-dom window mutation; Node requirement vs the nix dev shell Node; storybook-vite compatibility with Vite 8; dev server (`kb ui --dev` spawns `vp dev`). Needs a nix rebuild to confirm `pkgs/kb` still builds (bun.nix hashes).

**Batch 5 -- commander 15.** Independent and low risk: check the 2 `--no-*` option definitions (default semantics changed when both positive and negative forms are defined) and CLI snapshot tests.

**Hold / monitor:** three (stay on exact 0.186.x until a deliberate WebGPU/TSL migration), typescript (7.1 dev only), stale graphology/d3 packages (no action).
