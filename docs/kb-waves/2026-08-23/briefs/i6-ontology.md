# Brief i6-ontology — Ontology core implementation

Harness: claude. Zone: NEW files under `tools/kb/src/foundation/ontology*.ts`
(+ their tests) and `ui/src/components/ontology/**`, plus MINIMAL additive
integration edits you must list individually in your handoff note:
`App.tsx` route/nav entry, `components/sidebar/sidebar-nav.ts` entry,
registry/loader wiring if the design requires it.
Protocol: `docs/kb-waves/2026-08-23/briefs/impl-protocol.md`.

Research input: `docs/kb-waves/2026-08-23/reports/r5-ontology.md` —
normative for the CORE subset it defines. Implement core only: ontology =
ordinary node tagged `#ontology` carrying `sys.f.onto.*` props (kind not
type); membership union semantics (tag sets + explicit members + query);
cycle-safe `extends`; the ontology page editing experience; scoped reading
mode reusing the existing lens/perspective pipeline where the report says.

Explicitly OUT of scope (report's parked list): inference/reasoning,
auto-classification, validation enforcement, ontology-of-ontology UI beyond
what `extends` needs.

Data-compat hard rules: purely additive schema; nodes without ontology
references are byte-for-byte unaffected; `.kb/nodes.jsonl` from main loads
unchanged; TODO content preserved.

Order: foundation model + operations first with full test coverage, then UI
page, then scoping mode, then integration touches. The report's EDN/datoms
examples are your contract.

Acceptance beyond the suite: create an ontology in the live app, add members
three ways, see ONLY member nodes + internal connections in the scoped view,
and confirm non-member nodes render exactly as before.
