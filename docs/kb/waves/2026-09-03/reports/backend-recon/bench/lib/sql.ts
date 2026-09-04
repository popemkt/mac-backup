/**
 * The eight questions as SQL over the EAV `datoms` table — stated once and
 * imported by both the Bun runner (`bun:sqlite`) and the browser runners
 * (sql.js, wa-sqlite). That shared import is the evidence for the brief's
 * "does the same SQL run unchanged in the browser?" — if it did not, one of the
 * two runners would fail to compile the statement, not quietly diverge.
 *
 * Parameters are positional (?1..?4) because that is the only binding style all
 * three drivers agree on.
 */
export const SCHEMA_DDL = `
  CREATE TABLE datoms (
    e INTEGER NOT NULL,
    a TEXT NOT NULL,
    v ANY NOT NULL,
    ref INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE node (id TEXT PRIMARY KEY, e INTEGER NOT NULL, doc TEXT NOT NULL);
`;

/**
 * EAVT / AEVT / AVET / VAET. VAET is partial (`WHERE ref = 1`) because only
 * ref-typed rows can ever be walked backwards, and that is the index backlinks
 * lives on.
 */
export const INDEX_DDL = `
  CREATE UNIQUE INDEX datoms_eavt ON datoms (e, a, v);
  CREATE INDEX datoms_aevt ON datoms (a, e, v);
  CREATE INDEX datoms_avet ON datoms (a, v, e);
  CREATE INDEX datoms_vaet ON datoms (v, a, e) WHERE ref = 1;
`;

export const FTS_DDL = `
  CREATE VIRTUAL TABLE node_fts USING fts5(id UNINDEXED, text, tokenize='unicode61');
  INSERT INTO node_fts (id, text) SELECT id, json_extract(doc,'$.text') FROM node;
`;

/** ?1 = :f/sys.f.type, ?2 = :node/id, ?3 = :node/text */
export const Q1 = `
  SELECT nid.v AS id FROM datoms t
    JOIN datoms tag ON tag.e = t.v AND tag.a = ?3 AND tag.v = 'todo'
    JOIN datoms nid ON nid.e = t.e AND nid.a = ?2
  WHERE t.a = ?1`;

/** ?1 = status attr, ?2 = type attr, ?3 = :node/id, ?4 = :node/text */
export const Q2 = `
  SELECT nid.v AS id FROM datoms st
    JOIN datoms t   ON t.e = st.e AND t.a = ?2
    JOIN datoms tag ON tag.e = t.v AND tag.a = ?4 AND tag.v = 'todo'
    JOIN datoms nid ON nid.e = st.e AND nid.a = ?3
  WHERE st.a = ?1 AND st.v = 'doing'`;

/** ?1 = :node/id, ?2 = target node id — walks VAET backwards */
export const Q3 = `
  SELECT src.v AS id FROM datoms tgt
    JOIN datoms m   ON m.v = tgt.e AND m.a = ':node/mentions' AND m.ref = 1
    JOIN datoms src ON src.e = m.e AND src.a = ?1
  WHERE tgt.a = ?1 AND tgt.v = ?2`;

/** ?1 = :node/id, ?2 = type attr, ?3 = extends attr, ?4 = root tag id */
export const Q4 = `
  WITH RECURSIVE root(e) AS (SELECT e FROM datoms WHERE a = ?1 AND v = ?4),
    sub(e) AS (
      SELECT e FROM root
      UNION
      SELECT d.e FROM datoms d JOIN sub ON d.v = sub.e WHERE d.a = ?3
    )
  SELECT nid.v AS id FROM datoms t
    JOIN sub ON sub.e = t.v
    JOIN datoms nid ON nid.e = t.e AND nid.a = ?1
  WHERE t.a = ?2`;

/** ?1 = :node/id, ?2 = parent node id — order comes from the JSON vector */
export const Q5 = `
  SELECT nid.v AS id, k.value AS ord FROM datoms parent
    JOIN datoms kids ON kids.e = parent.e AND kids.a = ':node/children'
    JOIN json_each(kids.v) k
    JOIN datoms nid ON nid.e = k.value AND nid.a = ?1
  WHERE parent.a = ?1 AND parent.v = ?2
  ORDER BY k.key`;

/** ?1 = status attr */
export const Q6 = `SELECT v, count(*) AS n FROM datoms WHERE a = ?1 GROUP BY v`;

/** ?1 = :node/id, ?2 = closure root id */
export const CL = `
  WITH RECURSIVE root(e) AS (SELECT e FROM datoms WHERE a = ?1 AND v = ?2),
    reach(e) AS (
      SELECT d.v FROM datoms d JOIN root ON d.e = root.e WHERE d.a = ':node/mentions' AND d.ref = 1
      UNION
      SELECT d.v FROM datoms d JOIN reach ON d.e = reach.e WHERE d.a = ':node/mentions' AND d.ref = 1
    )
  SELECT nid.v AS id FROM reach JOIN datoms nid ON nid.e = reach.e AND nid.a = ?1`;

/** ?1 = :node/id, ?2 = parent node id */
export const PULL = `
  SELECT nid.v AS id, txt.v AS text FROM datoms parent
    JOIN datoms kids ON kids.e = parent.e AND kids.a = ':node/children'
    JOIN json_each(kids.v) k
    JOIN datoms nid ON nid.e = k.value AND nid.a = ?1
    JOIN datoms txt ON txt.e = k.value AND txt.a = ':node/text'
  WHERE parent.a = ?1 AND parent.v = ?2 ORDER BY k.key`;

export const FTS_SEARCH = `SELECT id FROM node_fts WHERE node_fts MATCH ?1 ORDER BY rank LIMIT 50`;

export const ATTR = {
  id: ":node/id",
  text: ":node/text",
  type: ":f/sys.f.type",
  extends: ":f/sys.f.onto.extends",
  status: ":f/01KZFW1A581GP25YPYRF614BAZ",
} as const;

/**
 * Datom value -> SQLite bindable value.
 *
 * Two coercions, both forced by the data rather than chosen: the
 * `:node/children` datom is a JS array (the ordered vector), and `sys.f.hidden`
 * carries a boolean. `bun:sqlite` in non-strict mode silently accepts a
 * boolean; wa-sqlite refuses it ("unknown binding converted to null"), so the
 * coercion is stated here once instead of differing per driver.
 */
export function sqlValue(v: unknown): string | number {
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  return String(v);
}
