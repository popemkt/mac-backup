/**
 * The eight reference questions, stated once.
 *
 * Q1–Q6 are the six from `reports/datalog-vs-cypher/README.md` §3, kept in the
 * same order and numbering so the two reports read against each other. BL and
 * CL are the two the r4 brief adds: backlinks (the hot path the VAET index
 * exists for) and transitive closure (the one datalog can answer but only as
 * endpoints). PULL is the projection question — the only one that is not a
 * relational result.
 *
 * Every candidate answers all eight over the same fixture, and the row counts
 * are compared: a candidate whose Q4 returns a different count than DataScript's
 * has not implemented Q4, however fast it is.
 */
export const QUESTIONS = [
  ["Q1", "all todos"],
  ["Q2", "todos status=doing"],
  ["Q3", "backlinks to hub"],
  ["Q4", "tag inheritance (transitive)"],
  ["Q5", "children in order"],
  ["Q6", "count per status"],
  ["BL", "backlinks incl. both carriers"],
  ["CL", "transitive closure of mentions"],
  ["PULL", "pull subtree depth 2"],
] as const;

export const FIELD_STATUS = "01KZFW1A581GP25YPYRF614BAZ";
export const FIELD_PARENT = "01M0YM7VATM1QX8Z6KH7NEAP69";
export const TAG_TODO = "01KZFW1A5BT06QS7V6X6EBQMZ4";
export const FIELD_EXTENDS = "sys.f.onto.extends";
export const FIELD_TYPE = "sys.f.type";
export const HUB = "01N0HUB0000000000000000000";
export const CLOSURE_ROOT = "01N0CLOSURE000000000000000";
export const ORDERED_PARENT = "01N0PARENT0000000000000000";
export const TAG_ROOT = "01N0TAGROOT000000000000000";
