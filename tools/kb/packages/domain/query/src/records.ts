/**
 * A query's rows as records: each row an object keyed by its `:find` column
 * names, which is how anything that reads rows by name (a chart's data) takes
 * them. One function, so every runtime names a query's columns one way.
 */
import { findColumns } from "./ir/parse.ts";

export interface QueryRecords {
  /** The column names, in `:find` order. */
  readonly columns: readonly string[];
  /** One record per row, keyed by `columns`. */
  readonly records: readonly Readonly<Record<string, unknown>>[];
}

/**
 * `rows` of the query `edn` as records. The columns are its `:find` names
 * (`findColumns`); when they cannot be read, they are `col_1`, `col_2`, … up
 * to the widest row, so every value still has a name.
 */
export function queryRecords(edn: string, rows: readonly (readonly unknown[])[]): QueryRecords {
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  const columns =
    findColumns(edn) ?? Array.from({ length: width }, (_, i) => `col_${String(i + 1)}`);
  return {
    columns,
    records: rows.map((row) => Object.fromEntries(columns.map((name, i) => [name, row[i]]))),
  };
}
