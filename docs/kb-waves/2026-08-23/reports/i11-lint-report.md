# i11-lint — Implementation report: ESLint + Oxlint + dependency-cruiser

Scope: **linting, module boundaries, and dependency hygiene** for the kb tooling
(`tools/kb` backend + `tools/kb/ui` browser app). Written for a downstream
implementer to execute against `main`. No code in this file; this is the spec.

Owner decision (2026-08-23): **skip Biome.** Use **Oxlint (already the `vp`
lint backend)** as the fast primary linter, add a **trimmed flat ESLint config**
for the rules Oxlint can't do, and add **dependency-cruiser** for graph-level
boundary/cycle enforcement plus **knip** for dead-code/dependency hygiene.

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
| Rules Oxlint lacks (boundaries at full fidelity, exhaustive-deps, escape-hatch, keyboard-a11y subset) | **ESLint flat config** (trimmed) | `eslint-plugin-oxlint` turns OFF overlapping ESLint rules so nothing double-lints. |
| Graph-level module boundaries, cycles, orphans, cross-feature, missing dev-deps | **dependency-cruiser** | Reads the whole graph; catches relative escapes + cycles a per-line rule can't. |
| Dead files/exports/entries/dependencies | **knip** | Gold standard for "what's actually reachable." Run in CI, not hot pre-commit. |
| Authoritative types | `tsc --noEmit` (unchanged) | Real type-checking. |

**Separation that must hold:** ESLint runs ONLY the rule families Oxlint can't
reproduce. It does NOT re-run ESLint-core/TS-core/recommended (those are Oxlint's
job). `eslint-plugin-oxlint` disables them so the two never argue.

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
`tokens.css`). Tailwind v4 owns that layer. Add an **override** to the ESLint
config and an oxlint ignore so `**/*.css` is excluded from both lint and format.
Without this the two tools fight the stylesheet layer.

---

## 8. Package.json scripts to add/confirm (tools/kb)

```jsonc
"scripts": {
  "lint":      "vp lint",               // unchanged (oxlint)
  "check":     "vp check --no-fmt",     // unchanged
  "eslint:arch": "eslint .",            // boundary/escape/a11y subset (trimmed)
  "boundaries": "depcruise src ui/src --config .dependency-cruiser.js",
  "knip":       "knip",
  "verify": "npm run typecheck && npm run check && npm run eslint:arch && npm run boundaries"
}
```

Keep `lint`/`check` as the fast path; `eslint:arch`, `boundaries`, and `knip`
are the deeper gates. Do NOT merge them into one script — different cadences.

---

## 9. Implementation task list (for the implementer, ordered)

1. Add dev deps: `eslint`, `eslint-plugin-oxlint`, `@typescript-eslint/parser`
   + `@typescript-eslint/eslint-plugin` (only for the escape-hatch/ban-ts rules;
   not type-aware), `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`,
   `dependency-cruiser`, `knip`. Pin exact versions (Biome article lesson:
   unpinned lint tooling changes which diagnostics fire).
2. Write `.dependency-cruiser.js` (section 4 rules) + `depcruise --init`-style
   `options`. Run it; confirm only the intended violations (the three leak files
   and any real coupling). 
3. Write the trimmed flat ESLint config (section 5). Wire `eslint-plugin-oxlint`
   LAST. Add the Tailwind/CSS override (section 7).
4. Run ESLint. For each finding: if it's a real boundary/escape gap, fix the
   code AND keep the rule; if it's noise, narrow the rule, don't disable it
   wholesale.
5. Add `knip` config + script (section 6); triage output.
6. Add the script aliases (section 8) and wire NOTHING into pre-commit except the
   fast path + `eslint:arch` and `boundaries` (both sub-second on this size) —
   keep pre-commit fast so it doesn't get skipped (the repo's own hypothesis:
   "slow pre-commit is the step people skip").
7. Add an `ARCHITECTURE.md` section (or extend the existing one) documenting the
   direction-of-imports table *and* pointing at the two commands that enforce
   it — the research found convention files get read when placed where the tool
   looks.

---

## 10. Acceptance criteria

- `npm run verify` (typecheck + check + eslint:arch + boundaries) is green on a
  clean main, with the three known leak files either fixed or explicitly
  allowlisted-with-rationale.
- `depcruise` reports **zero `no-circular`** and **zero `ui→foundation-internals`**.
- No `@ts-ignore` / `@ts-nocheck` remain without an `@ts-expect-error` reason;
  `no-explicit-any` is at warn with only documented exceptions.
- ESLint config runs ONLY non-overlapping rule families (run `eslint-plugin-oxlint`
  and assert the diff); nothing is double-linted by both ESLint and Oxlint.
- `**/*.css` is untouched by lint/format (confirmed: run `vp check` and ESLint
  and see zero CSS churn).
- `knip` output is reviewed; genuine dead code in the repo is removed or marked
  as explicitly-kept with a note.
- README/AGENTS.md gains a one-line "linting & boundaries" pointer so the
  convention lives where the tools look.

---

## 11. Open questions for the owner before the implementer starts

1. Module-boundary lint: **builtin `no-restricted-imports`** (simpler, zero deps)
   vs **`eslint-plugin-boundaries`** (richer element/file/module classification)?
   Recommendation: `no-restricted-imports` for now; boundaries only if the map
   grows multi-dimensional. **gated on owner**.
2. Severity policy: OK to make `no-circular` and `ui→foundation-internals`
   **errors** (blocking) while everything judgment-y stays **warn**? 
3. The three known leak files (`any`/`ts-ignore`): fix them now (preferred) or
   allowlist-with-rationale this pass? Recommend fix.
4. `knip` in CI-but-not-precommit okay?
