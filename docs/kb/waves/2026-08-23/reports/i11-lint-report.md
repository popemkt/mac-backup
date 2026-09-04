# i11-lint — Implementation report: linting, module boundaries, dependency hygiene

Scope: **linting, module boundaries, and dependency hygiene** for the kb tooling
(`tools/kb` backend + `tools/kb/ui` browser app). Written for a downstream
implementer to execute against `main`. No code in this file; this is the spec.

## 0. FINAL RECOMMENDATION (owner constraint: fewest tools, minimal interop)

Owner goal (2026-08-23): *"at most one software/tool as possible"* — different
tools don't interop and create friction. Updated after verifying current Oxlint
capability:

**Recommended: Oxlint ONLY (already the `vp` lint backend) + keep `vp fmt`
and `tsc --noEmit`. No ESLint, no dependency-cruiser, no Biome.**

Rationale: Oxlint 1.76 (bundled in `vp`, with `oxlint-tsgolint`) is now a
superset of everything this repo needs *except whole-graph dead-code analysis*.
It has natively:
- `import/no-cycle` — multi-file analysis, auto-discovers `tsconfig` path
  aliases (`@/*`, `@kb/*`), few seconds (ESLint's `import/no-cycle` was the
  minute-long pain point this replaces).
- `eslint/no-restricted-imports` — with `patterns`/`group`/`regex`/`message`:
  the exact module-boundary mechanism (per-directory forbidden imports + a
  written message). This IS the boundary enforcer; no plugin needed.
- `react/exhaustive-deps` — 3,642 conformance tests passing.
- `typescript/ban-ts-comment` — the escape-hatch rule (`@ts-ignore`/`@ts-nocheck`).
- `jsx-a11y` — keyboard/focus/role subset (plugin on-by-default toggle).
- `typescript/*` type-aware rules via `tsgolint` (59/61 of `typescript-eslint`).

So interop friction drops to zero: ONE binary, ONE config, ONE command (`vp
check`/`vp lint`). No ESLint↔oxlint overlap disables, no depcruise baseline
diffing, no `eslint-config-prettier` glue. Every concern has exactly one owner.

**What this makes obsolete:** the ESLint flat config and dependency-cruiser.
Only add them later IF a specific gap bites (see §11 contingency). Do not
pre-install them.

### Recommended FULL setup (owner-approved, includes dead-code)

Oxlint alone lacks one thing Oxlint genuinely cannot do: **whole-graph dead-code
and orphan-dependency analysis** (which entry points make which files/exports/deps
unreachable). For that we add **`knip`** — the gold standard, CI-only, one small
tool. So the recommended full setup is:

| Tool | Job | Cadence |
|---|---|---|
| **Oxlint** (via `vp`) | lint + import-sort + boundaries + cycles + hooks + a11y + escape hatches + type-aware | pre-commit + editor-every-save (fast) |
| **knip** | dead files / dead exports / unused + unlisted deps | CI + on-demand (not hot pre-commit) |
| `vp fmt` | formatting (unchanged) | on save |
| `tsc --noEmit` | authoritative types (unchanged) | pre-commit + CI |

That's **two linters, one owned by `vp` (Oxlint) and one optional-adjacent (knip)**,
plus the format/type tools already present. This is the ceiling for "fewest
tools while still catching dead code" — dropping knip gives you a pure one-tool
lint setup, but you lose dead-code detection, which is what knip is uniquely
good at. Recommended: keep knip (it's the only justified second tool here).

---

## 1. Goal and non-goals

**Goal:** mechanically enforce the architecture rules this repo already states
in prose (AGENTS.md / `ui/ARCHITECTURE.md`) — one owner per module, no parallel
paths, no crossing module boundaries, no silent `any`/`@ts-ignore` leaks — so CI
fails instead of drift. And eliminate dead code/deps as the codebase grows.

**Non-goals (deliberate, per "simplicity beats fidelity"):**
- No second formatter. Oxlint/`vp` owns lint; `vp fmt`/`vp check --no-fmt` stays.
- No framework-specific bundles beyond what's present (no Vue/Next/Svelte rules).
- No naming-convention opinion stacks (they teach `eslint-disable`).
- No rules that need per-case judgment at *error* severity (that's exactly how
  a ruleset loses credibility — the research is unanimous on this).
- Keep `tsc --noEmit` authoritative for type errors. Do NOT make ESLint a type
  oracle; `typescript-eslint` type-aware rules stay only for the few that
  catch real bugs and are cheap.

---

## 2. Toolchain ownership map (the "one mechanism per concept" rule)

| Concern | Owner | Why |
|---|---|---|
| Formatting | `vp fmt` (unchanged) | Already the repo's formatter. |
| Fast lint + import organization + safe autofix | **Oxlint** (bundled in `vp`, `oxlint@1.76.0` + `oxlint-tsgolint`) | 865+ rules, type-aware incl. 59/61 `typescript-eslint` rules, sub-second. Fast enough for pre-commit + editor-every-save. |
| Module boundaries (`no-restricted-imports`) | **Oxlint** | Native `eslint/no-restricted-imports` with per-directory patterns + message. The boundary enforcer — no plugin, no ESLint. |
| Cyclic dependencies (`import/no-cycle`) | **Oxlint** | Native multi-file graph analysis, auto-discovers tsconfig paths. |
| React hooks correctness (`exhaustive-deps`) | **Oxlint** | Native `react/exhaustive-deps`. |
| Escape hatches (`@ts-ignore`/`@ts-nocheck`) | **Oxlint** | Native `typescript/ban-ts-comment`. |
| Keyboard/role accessibility | **Oxlint** | Native `jsx-a11y` plugin (subset, see §5). |
| Dead files/exports/entries/dependencies | **knip** (recommended, CI-only) | Oxlint can't do whole-graph reachability. The ONE justified second tool; the only thing beyond Oxlint. |
| Authoritative types | `tsc --noEmit` (unchanged) | Real type-checking. |

No ESLint, no dependency-cruiser, no Biome. Every concern above has exactly
one owner: Oxlint for lint/boundaries/cycles/hooks/a11y/escape-hatches, `knip`
for dead code, `vp fmt` for formatting, `tsc --noEmit` for authoritative types.

> **SUPERSEDED BELOW.** §3–§5 describe the *original* ESLint + dependency-cruiser
> plan in full, because it was written before the owner constrained to
> fewest-tools. Under the §0 recommendation you DO NOT build an ESLint config or
> a `.dependency-cruiser.js`. The intent of those rules carries over — expressed
> natively in Oxlint. Read §5b (the recommended config) and §6 (knip). §3/§4/§5
> are retained only as contingency reference if an Oxlint gap ever bites.

---

## 3. dependency-cruiser — how it works (for the implementer)

- **Invocation:** `npx depcruise src app --config .dependency-cruiser.js` (or
  `depcruise --validate`). `depcruise --init` scaffolds a config.
- **What it does:** walks every import/`require`/dynamic-import, **builds the
  dependency graph**, validates it against your `forbidden`/`allowed` table in
  the config, reports violations.
- **Config reads the repo:** set `options.tsConfig.fileName` to each tsconfig and
  `options.tsPreCompilationDeps: true` (type-only coupling is still a real
  barrier to deletion — a repo with `@/*` + `@kb/*` aliases needs this), and
  `doNotFollow: { path: "node_modules" }`.
- **Outputs:** `--output-type err-long` for CI text; `dot`/`svg`/`html` for a
  visual graph; `--output-type json` for machine diffing.
- **CI diff pattern (recommended):** capture a baseline once
  (`.depcruise-baseline.txt`), then in CI `diff` baseline vs current and fail
  only on **new** violations. But for a repo this size, prefer enabling strictly
  (see rules below) so we don't need a baseline crutch.

---

## 4. The dependency-cruiser ruleset for kb

`.dependency-cruiser.js` at `tools/kb/` (backend) — extend with a second config
for `ui/` if aliases differ, or one config covering both via `options.tsConfig`.
Path semantics: kb modules are `@/<ui-src>` and `@kb/<backend seam>`; backend
`src/{foundation,operations,surface,render}`.

Forbidden rules to implement (each with a written `comment` — the message is the
design doc that survives):

1. **`no-circular`** — `from: {}, to: { circular: true }`, `severity: error`.
   Take-away: cycles are the least-reproducible failure there is; enable strictly.
2. **`ui→foundation-internals`** — `from: { path: "^tools/kb/ui/src" }`,
   `to: { path: "^tools/kb/src/(foundation|operations)" }`. The UI is a
   projection; it may only reach the backend through the sanctioned `@kb/*`
   seam and `surface/ui.ts` wire format — not internals.
3. **`backend-internal-coupling`** — `src/operations` may not import `src/render`
   or `src/surface` internals except through the defined seam; `src/foundation`
   is a leaf (nothing imports inward from it by definition).
4. **`extensions-out-of-core`** — `.kb/extensions/*.ts` and
   `extensions-bundled/*` may import `src/shared/contracts` + the public seam
   only, never `src/foundation|operations|surface` internals.
5. **`no-orphan-package`** — production code may not rely on dev/optional
   dependencies; orphans (no importer) reported at warn initially, error later.
6. (Optional) **cross-feature** — if any `components/<x>` starts importing
   `components/<y>` internals, express it with a `$1` back-reference pattern so
   the rule never changes as features are added.

Always leave at least: `no-circular` and `ui→foundation-internals` at **error**.
Keep everything judgment-y as **warn** (hand a machine a judgment rule and
`eslint-disable` spreads).

---

## 5. The flat ESLint config (trimmed)

New `tools/kb/eslint.config.js` (+ a `ui/` one or a shared root — prefer one
root config with `files` scoping). Uses `eslint-plugin-oxlint` to disable the
overlap.

Rule families to include (ONLY these):

1. **`react-hooks/exhaustive-deps`** — real bug-catcher for the outline/editor
   React. Error.
2. **Escape hatches** — custom rules:
   - `@typescript-eslint/ban-ts-comment`: disallow `@ts-ignore` and `@ts-nocheck`;
     allow `@ts-expect-error` via `descriptionFormat: '^[^\\n]+'`-style (a reason is
     required). Prefer `@typescript-eslint/no-explicit-any` at warn, but
     **narrow** it with a comment-allowlist or a per-file override for the three
     known leak files (`ui/src/api/ws.ts`, `ui/src/components/graph/force3d-three.ts`,
     `ui/src/components/canvas/canvas-page.tsx`) until they're typed.
3. **`import/no-cycle`** (`eslint-plugin-import`) — belt-and-suspenders with
   depcruise's `no-circular`, but only if depcruise isn't in the hot loop yet.
   Otherwise skip to avoid a second cycle detector (parallel-path rule).
4. **Module boundaries as lint** — either `eslint-plugin-boundaries`
   (declarative element/file/module → policies) *or* eslint builtin
   `no-restricted-imports` per-directory. Given kb's map is a handful of
   "don't cross here" lines, prefer **builtin `no-restricted-imports`** (zero
   deps, `message` carries the why) with an `ARCHITECTURE.md`-derived pattern
   per layer. Use `eslint-plugin-boundaries` only if you want multi-dimensional
   element/file/module classification. **Pick one**, per the repo rule.
5. **Keyboard-a11y subset** of `jsx-a11y` (the repo explicitly cares about ⌘K
   palette, focus management, reduced motion): `tabindex-no-positive`,
   `click-events-have-key-events` (only where it makes sense — NodeRow shell),
   `role-has-required-aria-props`. Skip color-contrast/landmark noise.
6. **`eslint-plugin-oxlint`** layout LAST to turn off everything Oxlint already
   covers, so ESLint runs only the unique families above.

Explicitly OFF / never added: style rules (own it to `vp`/oxlint formatter),
`eslint-plugin-prettier`, naming conventions, security (`no-danger` — no HTML
injection surface), Vue/Next/Svelte bundles. If a "recommended" bundle is
imported, it must be scoped so its rules are disabled by `eslint-plugin-oxlint`.

---

## 5b. THE RECOMMENDED CONFIG — rules expressed natively in Oxlint (⊂ `vp`)

Do this instead of §5. `vp` already wraps oxlint, so this is just enabling the
right plugins/rules in the oxlint config that `vp` reads (an `oxlint.json` or
`vite-plus` config's `linter`/`plugins` block — confirm the exact knob in the
`vp` docs). No ESLint dependency, no `eslint-plugin-oxlint`.

Enable plugins (default `eslint`/`typescript`/`unicorn`/`oxc` stay on; add these):

```jsonc
{
  "plugins": ["react", "import", "jsx-a11y"],
  "rules": {
    // Module boundaries — the ARCHITECTURE.md layer map, one rule per layer.
    "eslint/no-restricted-imports": ["error", {
      "patterns": [
        { "group": ["@kb/foundation/*", "@kb/operations/*"], "message": "ui may reach the backend only via the @kb/* seam + surface/ui.ts wire format, not foundation/operations internals." },
        { "group": ["../../src/foundation/*"], "message": "use @kb/* seam instead of a relative path into backend internals." }
      ]
    }],
    // Cycles (multifile; auto-discovers tsconfig paths for @/* and @kb/*).
    "import/no-cycle": ["error", { "maxDepth": 8 }],
    // React hooks — real bug-catcher.
    "react/exhaustive-deps": "error",
    // Escape hatches — require a reason, ban the silent ones.
    "typescript/ban-ts-comment": ["error", { "ts-expect-error": "allow-with-description" }],
    "typescript/no-explicit-any": "warn"
  }
}
```

Notes for the implementer:
- **Confirm the plugin/id naming** exactly matches this oxlint version (the
  import plugin id is `import/*`; the eslint-core port is `eslint/no-restricted-imports`)
  — run `oxlint --rules` to see the live rule list and adjust ids if a schema
  regex differs (oxlint uses Rust regex: NO lookahead/lookbehind — keep boundary
  patterns as plain path globs, not JS regex with lookaheads).
- The `@kb/*` seam rules duplicate `import/no-cycle`'s intent only where they
  overlap; that's fine — boundaries (who may import whom) and cycles (shape) are
  different concerns, both stay.
- **`no-explicit-any` at warn**, with a deliberate allowlist for the three known
  leak files (`ui/src/api/ws.ts`, `ui/src/components/graph/force3d-three.ts`,
  `ui/src/components/canvas/canvas-page.tsx`) until they're typed — put them in
  an oxlint `overrides`/ignore or `// oxlint-disable-next-line no-explicit-any`
  with a reason, NOT a global disable.
- **a11y subset:** `jsx-a11y` plugin on; keep only keyboard/focus/role rules
  (`tabindex-no-positive`, `click-events-have-key-events` where it makes sense,
  `role-has-required-aria-props`); disable the contrast/landmark noise rules so
  they don't teach `disable` (per the "judgment rule" warning).

---

## 6. knip (dead code + dependency hygiene)

- **Add `knip` dev dep** and a script: `"knip": "knip"` (or `knip --production`).
- **Config:** `knip` needs an entrypoint map. Point it at `tools/kb/index.ts`,
  `src/surface/cli.ts`, `src/surface/ui.ts`, `src/surface/mcp.ts`, plus the
  `ui/src/main.tsx` and any test entrypoints. Configure the `@/*` and `@kb/*`
  aliases so it resolves them.
- **Do not add knip to the hot pre-commit hook.** Run it in CI / on-demand;
  it's slow-ish and its noise is better reviewed than blocked-on.
- **Output:** unused files/exports/types/deps list. Triage the three known leak
  files and any `d.ts`/externals knip mis-flags (add them to `ignore`/`entry`
  rather than disabling the tool).

---

## 7. Tailwind / CSS override (mandatory, easy to miss)

Oxlint (via `vp`) and any linter will try to lint/format the CSS (`index.css`,
`tokens.css`). Tailwind v4 owns that layer. Add an **override** to the oxlint
config and `vp` ignore so `**/*.css` is excluded from both lint and format,
plus an override for the UI's `vite.config.ts`/story files if oxlint chokes on
them. Without this oxlint fights the stylesheet layer.

---

## 8. Package.json scripts to add/confirm (tools/kb)

```jsonc
"scripts": {
  "lint":   "vp lint",             // unchanged (oxlint, fast path)
  "check":  "vp check --no-fmt",   // unchanged
  "knip":   "knip",                // recommended (dead code/deps)
  "verify": "npm run typecheck && npm run check && npm run knip"
}
```

`lint`/`check` are the fast path (oxlint, via vp) — keep them in pre-commit.
`knip` is CI/on-demand only (slow-ish, noisy). The module-boundary, cycle,
hooks, and a11y rules live in the oxlint config (§5b) and thus already run under
`vp check` — they need no separate script. Do NOT merge knip into the pre-commit
fast path or into `check` (different cadence; knip noise is better reviewed than
blocked-on). If you later hit an Oxlint gap and MUST add dependency-cruiser
(§3/§4 contingency), add a `"boundaries": "depcruise ..."` script then — not now.

---

## 9. Implementation task list (for the implementer, ordered)

Recommended path = §0/§5b (Oxlint) + §6 (knip). Steps 1–4 below are the plan;
§5's ESLint + §4's depcruise are contingency and should NOT be built now.

1. Add ONE dev dep: `knip`. Pin exact version (unpinned lint tooling drifts
   which diagnostics fire). Do NOT add eslint/dependency-cruiser.
2. Confirm how `vp` surfaces its bundled Oxlint config (read the `vp` docs for
   the `linter`/`plugins`/`rules` knob or the `oxlint.json` it reads), then
   write the §5b config: enable `react`/`import`/`jsx-a11y` plugins; add the
   `eslint/no-restricted-imports` boundary patterns, `import/no-cycle`,
   `react/exhaustive-deps`, `typescript/ban-ts-comment`, `no-explicit-any`.
   Run `vp lint` and adjust rule ids/naming to exactly what this oxlint emits.
3. Add the Tailwind/CSS + config-file override (§7) so oxlint doesn't touch
   `**/*.css` or the dev configs. Confirm `vp check` stays CSS-clean.
4. Run the linter over `tools/kb` + `ui`. For each finding: real boundary/
   escape gap → fix the code AND keep the rule; noise → narrow the rule (or
   scoped ignore with a reason), never disable wholesale. Expect the three
   known leak files to need a scoped `no-explicit-any` allowlist until typed.
5. Add `knip` config + script (§6); point entrypoints at `index.ts`,
   `src/surface/{cli,ui,mcp}.ts`, `ui/src/main.tsx`, tests; configure `@/*` and
   `@kb/*` aliases. Triage output.
6. Add the script aliases (§8): `lint`/`check` unchanged (fast path, in
   pre-commit) + `knip` (CI/on-demand). Wire NOTHING slow into pre-commit
   (repo hypothesis: "slow pre-commit is the step people skip").
7. Add an `ARCHITECTURE.md` section (or extend the existing one) documenting the
   direction-of-imports table *and* pointing at `vp lint` (the command that
   enforces it) — the research found convention files get read when placed where
   the tool looks.

---

## 10. Acceptance criteria

- `npm run verify` (typecheck + check + knip) is green on a clean main, with the
  three known leak files either fixed or narrowly allowlisted-with-rationale for
  `no-explicit-any`.
- `vp lint` (oxlint) reports **zero cyclic imports** (`import/no-cycle`) and
  **zero boundary violations** (`no-restricted-imports`) against the
  ARCHITECTURE.md layer map.
- No `@ts-ignore` / `@ts-nocheck` remain without a reason; `no-explicit-any` is
  at warn with only documented exceptions.
- ONE linter engine (Oxlint) owns lint + boundaries + cycles + hooks + a11y +
  escape hatches; the only added tool is `knip` (dead code). No ESLint, no
  dependency-cruiser, no Biome in the dependency tree.
- `**/*.css` is untouched by lint/format (confirmed: `vp check` shows zero CSS
  churn).
- `knip` output is reviewed; genuine dead code in the repo is removed or marked
  as explicitly-kept with a note.
- README/AGENTS.md gains a one-line "linting & boundaries" pointer so the
  convention lives where the tools look.

---

## 11. Open questions for the owner before the implementer starts

1. Boundary expressiveness: Oxlint's `eslint/no-restricted-imports` (simpler,
   zero deps — the §0/§5b recommendation) vs adopting `eslint-plugin-boundaries`
   later (richer element/file/module classification) only if the layer map grows
   multi-dimensional. Recommendation: `no-restricted-imports`, revisit only if the
   ARCHITECTURE.md map gets complex. **gated on owner.**
2. Severity policy: OK to make `import/no-cycle` and `no-restricted-imports`
   boundary rules **errors** (blocking) while judgment-y rules (a11y subset,
   `no-explicit-any`) stay **warn**?
3. The three known leak files (`any`/`ts-ignore` in `ui/src/api/ws.ts`,
   `force3d-three.ts`, `canvas-page.tsx`): fix them now (preferred) or narrow
   allowlist-with-rationale this pass? Recommend fix.
4. `knip`: confirm CI-and-on-demand (not pre-commit) is acceptable, and that
   adding it as the single extra tool beyond Oxlint is desired (vs pure one-tool
   with no dead-code detection).
