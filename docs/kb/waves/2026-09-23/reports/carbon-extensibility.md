# Carbon (crbnos/carbon) extensibility audit, and what it means for kb

Audited: `crbnos/carbon` at `93692c2b3fae8eebb85e6c83ef5fefeecce8d165` (2026-09-24),
shallow clone, code read against the README and the in-repo docs site
(`docs/content/docs/**`). carbon.ms was not fetched. Every security finding
below is **inferred from reading code, not exploited or executed**. Paths are
relative to the Carbon repo root.

Scale for context: 1,038 SQL migrations, 392 public tables, 105 views.
Stack: React Router apps (`apps/erp`, `apps/mes`), Supabase Postgres with RLS
and PostgREST as the public API, Deno edge functions for most posting logic,
Inngest jobs, pgmq, Turborepo. License: AGPLv3 **except** `packages/ee/**` and
`*.ee.*`, which are under a commercial license.

## Verdicts at a glance

| Claim (README) | Verdict | One-line reason |
|---|---|---|
| "API-first, extensible, yours" / "API & Webhooks — build your own apps" | partial | PostgREST over every table is real; there is no plugin model, and API keys, webhooks, integrations, MCP and workflows are commercial and return `false` on Community |
| "Custom Fields — extend any record" | partial | one unindexed, untyped JSONB column on 115 of 392 tables |
| "Configurator — product configuration" | real feature, unsafe | per-field TypeScript rules, run via `import()` in a privileged isolate behind a regex denylist the docs call a "sandbox" |
| "Accounting — GL, journals" | real, with gaps | posted journals immutable by trigger; balance only checked in app code; reversal not atomic |
| "Traceability — full lot and serial tracking" | real, "full" overstated | proper genealogy graph; UI trace capped at 5 hops / 500 entities |
| Analytics (no explicit claim) | partial | solid SQL-backed financial statements; some KPIs summed in JS over a row-capped fetch |

## 1. Extensibility: there is no plugin system

Integrations are a compiled-in array inside the commercial package:

```ts
// packages/ee/src/index.ts:32-46
export const integrations = [ Email, Jira, Linear, Onshape, PaperlessParts,
  QuickBooks, Ramp, Rillet, Sage, Slack, Xero, StripeConnect ];
```

An integration (`defineIntegration`, `packages/ee/src/types.ts:157-199`) can
declare a settings form (Zod schema), OAuth config, `actions` that POST to an
app endpoint, a `setupInstructions` React component, and lifecycle hooks. The
server half lives in a **second, hand-kept map**,
`serverHooks: Record<string, IntegrationServerHooks>`
(`packages/ee/src/hooks.server.ts:49`). Install state is a DB row
(`companyIntegration.active`).

It cannot register routes, add schema, contribute pages or menus beyond its
settings form, or ship outside the monorepo. "Uninstall" is `active = false`;
the code stays bundled. The README says to start from an `examples` folder;
**that folder does not exist**. The real options for a third party are an
external app over PostgREST (`apps/starter`) or a fork that edits
commercial-licensed files.

**The event bus is the best part.** `20260116215036_event_system_impl.sql`
adds a statement-level trigger `dispatch_event_batch()` that uses transition
tables to push into a pgmq queue, with subscribers typed
`WEBHOOK | WORKFLOW | SYNC | SEARCH | AUDIT` and a JSONB containment filter;
`attach_event_trigger()` covers about 80 tables. Limits:

- it reads `companyId` from `batched_new ... LIMIT 1` (lines 119-123), so a
  bulk statement touching several tenants is attributed to the first, and the
  other tenants' rows are dropped;
- `SET LOCAL app.sync_in_progress='true'` skips every subscriber, audit
  included (lines 110-112);
- until `20260907164512_event-subscription-tenant-rls.sql`, about two weeks
  before this commit, the RLS policy was `USING (auth.role() = 'authenticated')`.
  That migration's own header says any user could read or plant another
  company's subscriptions.

Webhooks are table-CRUD shaped (`onInsert/onUpdate/onDelete`), delivered by
Inngest with 3 retries, and **unsigned** (`webhook.ts:50-52`: "Carbon does not
sign webhooks").

**The license gate:**

```ts
// packages/ee/src/plan.server.ts:157-163
export async function companyHasFeature(...) {
  if (CarbonEdition === Edition.Community) return false; ...
```

`CARBON_EDITION` defaults to `community`. `packages/ee/LICENSE` §2 forbids
running or modifying those files without a commercial license. So on the AGPL
edition, API-key creation, webhooks, integrations (except email), MCP,
workflows, audit log and RBAC authoring are off, and the code behind them is
not AGPL.

## 2. "Extend any record": custom fields

**Storage.** Definitions live in `customField(name, table, dataTypeId, listOptions, …)`
(`20240311021818_custom-fields.sql:21-42`). Values are one `"customFields" JSONB`
column per table, keyed by field id. 115 of 392 tables carry it; the docs
themselves say (`reference/custom-fields.mdx:28`) "the catalog is curated, not
universal".

**No indexes.** No GIN or expression index exists on any `customFields`
column in any of the 1,038 migrations. (`trackedEntity.attributes` does get
one, so the pattern was known.)

**No server-side typing.**

```ts
// apps/erp/app/utils/form.ts:50-63
if ((key.startsWith("custom-") && typeof value === "string") ||
    typeof value === "number" || typeof value === "boolean") {
  result[key.replace("custom-", "")] = value; }
```

FormData values are always strings, so the number and boolean branches are
dead. Numbers and dates are stored as strings, booleans as `"on"`, and
references as bare ids with no FK. Nothing checks a value against its field's
`dataTypeId`; "required" is a client-side validator only. 192 route actions
call this.

**What performance looks like.** List-view filters do run in SQL, as a
PostgREST JSON path:

```tsx
// apps/erp/app/hooks/useCustomColumns.tsx:43
accessorKey: `customFields->>${field.id}`,
```

Consequences:

- every custom-field filter is a sequential scan of the tenant's rows, on top
  of already heavy multi-join views like `parts` and `salesOrders`;
- `.gt/.lt` on `->>` compare **text**, so for a Numeric field `"10" < "9"`.
  Date ranges only work because ISO strings sort lexically;
- `contains` maps to `.overlaps` on a text value (`query.ts:108`), which does
  nothing useful;
- the filter-dropdown options come from `get_custom_field_unique_values`
  (`20250125115137…sql:1-17`), a `SELECT DISTINCT jsonb_extract_path(...)`
  over the whole tenant table on each open.

That RPC is also `SECURITY DEFINER`, takes arbitrary `table_name` and
`company_id`, and has no caller check and no `REVOKE`. Under Supabase's
default grants, any signed-in user could read another company's distinct
custom-field values. Not exploited; inferred from the code.

CSV import and export skip custom fields (docs, line 34).

## 3. Product configurator

**Flexibility is high:** each configurable field holds a TypeScript rule.

```sql
-- 20241224174410_save-configuration.sql:34-46
CREATE TABLE "configurationRule" ("itemId" TEXT, "field" TEXT, "code" TEXT NOT NULL, ...
```

- **Parameters** are `text | numeric | boolean | list`, plus a later
  `material` type.
- **Rules can drive** a BOM line's `itemId`, `description`, `quantity`,
  `methodType` and UoM, plus operation fields (process, work center, setup,
  labor and machine times) and step parameters. Whole-BOM and whole-routing
  filters are also available.
- **Zero quantity** drops the line.
- **There is no price rule.** Cost falls out of the resolved BOM and routing,
  which contradicts the docs' "resolve the BOM, routing, and price".

**Evaluation** happens in the Deno edge function `get-method`, an 8,512-line
file:

```ts
// packages/database/supabase/functions/lib/sandbox.ts:4-10, 50-61
const disallowedPatterns = [/\bfetch\b/, /setTimeout|setInterval/, /\bimport\b/,
  /new Promise/, /Function\(/];
const jsCode = await transpile(`export function configure(params: Params) {${
  disallowedPatterns.some((p) => p.test(code)) ? `return null` : code }}`);
return await import(`data:application/typescript;base64,${btoa(jsCode)}`);
```

The docs call this a "restricted sandbox" (`reference/configurator.mdx:43`).
It is not one:

- The rule runs in the same isolate as the function, which holds a Postgres
  pool and reads `SUPABASE_SERVICE_ROLE_KEY`.
- The regex list is bypassed by `globalThis["fe"+"tch"]`, `Deno.env.get(...)`
  or `eval(...)`. The header comment says "no eval, no loops", but neither is
  in the list.
- There is no timeout, so `while(true){}` hangs the function.
- Rule authors are anyone with `parts_update`, or anyone holding an API key.

The browser preview runs the same stored code through `new Function`
(`ConfigurationEditor.tsx:261`), which is a stored-script risk between
colleagues. Each field of each BOM line is re-transpiled and re-imported, with
no compile cache.

Carbon already has the safe shape elsewhere: the EE workflow engine evaluates
**declarative clauses** (`packages/ee/src/workflows/runtime/compare.ts:86`,
`evaluateClauses`). The configurator does not use it.

## 4. Journals, traceability, audit

**GL: real, with gaps.**

- **Schema.** `journal` and `journalLine`, with one signed
  `amount NUMERIC(19,4)`. `status` is Draft, Posted or Reversed, with
  `reversalOfId`/`reversedById`.
- **Posting.** Deno edge functions (`post-sales-invoice`, `post-receipt`,
  `post-payment`, …) post inside Kysely transactions. There are no posting
  triggers.
- **Balance** (Σamount = 0) is only checked in app code, by `assertBalanced()`
  in `functions/shared/precision.ts:157-171`. No constraint or trigger
  enforces it.
- **Immutability is enforced in the DB:**

  ```sql
  -- 20260712142905_reconcile-period-close-definitions.sql:22-62
  IF OLD."status" = 'Posted' AND NEW."status" IS DISTINCT FROM 'Reversed' THEN
    RAISE EXCEPTION 'Posted journal % is immutable; ...
  CREATE TRIGGER "journal_posted_immutable" BEFORE UPDATE OR DELETE ON "journal" ...
  ```

  That covers UPDATE and DELETE only. Nothing stops an INSERT of new lines
  into a Posted journal, and the posting code depends on that: it inserts the
  header as Posted, then the lines. The same migration notes the immutability
  objects "never reached prod" until 2026-07-12.
- **Reversal** (`accounting.service.ts:5786-5886`) is three PostgREST calls
  with no transaction: a reversing header, the negated lines, then flagging
  the original. A failure between calls leaves an empty or unlinked reversal.
  Dimensions are not copied.

**Traceability: a real genealogy graph.** It is bipartite
(`20250225145619_tracked-entities.sql:24-90`):

- `trackedEntity` holds the lot or serial, with its quantity and GIN-indexed
  `attributes`;
- `trackedActivity` holds the operations;
- `trackedActivityInput` and `trackedActivityOutput` record how much of each
  entity an operation consumed or produced.

Traversal is an app-side breadth-first search, one RPC per hop per direction:

```ts
// apps/erp/app/modules/inventory/lineage.server.ts:33, 182-217
const MAX_ENTITIES = 500;
for (let hop = 0; hop < safeDepth; hop++) { ...
  client.rpc("get_direct_descendants_of_tracked_entities_strict", { p_tracked_entity_ids: frontier })
// ui/Traceability/constants.ts:6
export const DEPTH = { min: 1, max: 5, default: 1 } as const;
```

A recall through a deep multi-level BOM is silently cut at 5 hops or 500
entities. There is no recursive CTE. Job-scoped lineage filters on
`attributes->>Job`, which the default `jsonb_ops` GIN index does not speed up.

**Audit log: real, commercial, asynchronous.** It is an `AUDIT` subscriber on
the event bus (pgmq → Inngest → per-company tables created at runtime, with
retention). It is not transactional with the change it records, it is skipped
under `app.sync_in_progress`, and it is not in the AGPL edition.

## 5. Analytics

- **Financial reports:** trial balance, balance sheet, P&L, AR/AP aging,
  inventory valuation, and 5 fixed `analytics.$reportKey` reports.
  - They are backed by SQL RPCs (`trialBalance`, `accountTreeBalancesByCompany`,
    `journalDimensionPivot`, …) and support dimensional pivots with CSV export.
  - GL balances use a snapshot plus delta, and stock quantities moved from a
    30-minute materialized view to trigger-maintained deltas
    (`20260812002454_item-stock-quantities-incremental.sql`), so real scale
    work has been done.
- **Module KPI tiles are summed in JS:**

  ```ts
  // apps/erp/app/routes/api+/sales.kpi.$key.ts:101-106
  value: salesOrders.data?.reduce((sum, order) => sum + (order.orderTotal ?? 0), 0) ?? 0
  ```

  With PostgREST `max_rows = 1000` (`supabase/config.toml:23`, local config),
  the count is exact but the revenue sum covers only the first 1,000 orders.
  The production `max_rows` value is unknown.
- **Missing:** no embedded BI tool, no warehouse or OLAP store, and no
  user-defined report builder beyond pivots over fixed report keys.

## 6. Carbon compared with kb

| Concern | Carbon | kb (`@kb/plugin`, wave 2026-09-23) |
|---|---|---|
| Unit of extension | compiled-in `integrations` array; install is a DB flag | a plugin: `{name, namespace, inject, apply(ctx)}`, loaded from bundled packages or `.kb/extensions/*` |
| Backend and UI in one unit | settings form and `setupInstructions` in one object, server hooks in a separate hand-kept map (a mirror) | one kernel type on server and browser. Backend points (actions, templates) and UI points (surfaces, sidebar sections) exist; one package shipping both halves is phases 4–5, open as gaps |
| Load and unload | code always loaded; `active=false` | unload closes the plugin's `Scope`; every registration, listener and resource goes with it. Dependents go back to pending when a provider leaves |
| Plugins talking to each other | none; integrations share only DB tables | typed `Service`, `Event` and `Point` keys, `inject` checked at `get`, one provider per service |
| Failure | a bad integration is a build failure | atomic: a failing `apply` or an id clash undoes everything that plugin registered, and the kernel stays up |
| Events | durable, cross-process pgmq outbox from DB triggers | in-process kernel events; store changes reach clients as live datalog subscriptions. **No durable outbox** |
| Extending records | JSONB column on 115 tables, untyped, unindexed | everything is a node: fields are nodes, typed by a `sys.f.fieldType` option node, props keyed by field-node id, so any node can carry any field by construction |
| Rules and config logic | user TypeScript run via `import()` in a privileged isolate | no code stored as data. Query nodes hold EDN datalog, which is declarative. Extensions are trusted in-process code, the same trust model as DeepSeek Harness |
| Trust and isolation | none for integrations; fake sandbox for rules | none: extensions are trusted (`.kb/extensions` is repo code under review) |
| Licensing of extension surface | commercial (`packages/ee`) | the kernel and extension SDK are part of kb |

### What kb should take from Carbon

1. **A durable outbox, if kb grows outward consumers.** Carbon's
   trigger-to-pgmq pattern, with statement-level batching over transition
   tables, is the right shape for webhooks and sync. kb's kernel events are
   in-process and die with the process. If an extension ever needs
   at-least-once delivery, the store's tx log (`tx-log`, `commitMark`) is the
   natural cursor. This is future work, not a gap today, because nothing
   depends on it.
2. **Declarative over executable, for anything stored as data.** Carbon's
   configurator is what happens when rules become code in rows. kb already
   holds this line: saved queries are EDN. Keep it that way; any "rule node"
   should be datalog or a closed expression form, never JS evaluated from the
   store.
3. **Lineage as a graph query, not an app loop.** Carbon models genealogy
   correctly but walks it with a capped breadth-first loop. DataScript, kb's
   datalog engine, supports recursive rules, so "trace all ancestors" can be
   one query with no hop cap. Whether kb's query surface passes a rules
   argument through today was not checked in this audit.

### What kb should avoid

- **Mirrors.** `integrations` and `serverHooks` are two hand-kept maps of one
  concept. kb's design already answers this with one plugin value that
  contributes both halves, which is why phase 4 (canvas as one package with
  `.` and `./ui`) matters.
- **Untyped extension values.** kb's field types are nodes. This audit did not
  re-verify that every kb write path checks a value against its field's
  declared type, so that is worth a check before claiming kb avoids Carbon's
  "Numeric stored as text" failure.
- **Tenant-scoped SECURITY DEFINER RPCs.** Not applicable to kb, which is a
  single-user local store, but it is the canonical sharp edge of the
  RLS-plus-PostgREST model.
