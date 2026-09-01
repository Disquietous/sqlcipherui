/**
 * Static SQLite vocabulary for completion. Everything here is built once at
 * module load; nothing in this file runs per keystroke beyond Set/Map lookups.
 */

const words = (s) => s.trim().split(/\s+/);

// https://sqlite.org/lang_keywords.html (+ STRICT / ROWID which are contextual)
export const KEYWORDS = words(`
  ABORT ACTION ADD AFTER ALL ALTER ALWAYS ANALYZE AND AS ASC ATTACH AUTOINCREMENT
  BEFORE BEGIN BETWEEN BY CASCADE CASE CAST CHECK COLLATE COLUMN COMMIT CONFLICT
  CONSTRAINT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP
  DATABASE DEFAULT DEFERRABLE DEFERRED DELETE DESC DETACH DISTINCT DO DROP EACH
  ELSE END ESCAPE EXCEPT EXCLUDE EXCLUSIVE EXISTS EXPLAIN FAIL FILTER FIRST
  FOLLOWING FOR FOREIGN FROM FULL GENERATED GLOB GROUP GROUPS HAVING IF IGNORE
  IMMEDIATE IN INDEX INDEXED INITIALLY INNER INSERT INSTEAD INTERSECT INTO IS
  ISNULL JOIN KEY LAST LEFT LIKE LIMIT MATCH MATERIALIZED NATURAL NO NOT NOTHING
  NOTNULL NULL NULLS OF OFFSET ON OR ORDER OTHERS OUTER OVER PARTITION PLAN
  PRAGMA PRECEDING PRIMARY QUERY RAISE RANGE RECURSIVE REFERENCES REGEXP REINDEX
  RELEASE RENAME REPLACE RESTRICT RETURNING RIGHT ROLLBACK ROW ROWS SAVEPOINT
  SELECT SET TABLE TEMP TEMPORARY THEN TIES TO TRANSACTION TRIGGER UNBOUNDED
  UNION UNIQUE UPDATE USING VACUUM VALUES VIEW VIRTUAL WHEN WHERE WINDOW WITH
  WITHOUT STRICT ROWID TRUE FALSE
`);
export const KEYWORD_SET = new Set(KEYWORDS.map((k) => k.toLowerCase()));

/** name -> signature (shown as detail). */
export const FUNCTIONS = {
  // core
  abs: '(X)', changes: '()', char: '(X1, X2, ...)', coalesce: '(X, Y, ...)', concat: '(X, ...)',
  concat_ws: '(SEP, X, ...)', format: '(FORMAT, ...)', glob: '(X, Y)', hex: '(X)', ifnull: '(X, Y)',
  iif: '(X, Y, Z)', if: '(X, Y, Z)', instr: '(X, Y)', last_insert_rowid: '()', length: '(X)',
  like: '(X, Y[, Z])', likelihood: '(X, Y)', likely: '(X)', load_extension: '(X[, Y])',
  lower: '(X)', ltrim: '(X[, Y])', max: '(X, ...)', min: '(X, ...)', nullif: '(X, Y)',
  octet_length: '(X)', printf: '(FORMAT, ...)', quote: '(X)', random: '()', randomblob: '(N)',
  replace: '(X, Y, Z)', round: '(X[, Y])', rtrim: '(X[, Y])', sign: '(X)', soundex: '(X)',
  sqlite_compileoption_get: '(N)', sqlite_compileoption_used: '(X)', sqlite_offset: '(X)',
  sqlite_source_id: '()', sqlite_version: '()', substr: '(X, Y[, Z])', substring: '(X, Y[, Z])',
  total_changes: '()', trim: '(X[, Y])', typeof: '(X)', unhex: '(X[, Y])', unicode: '(X)',
  unlikely: '(X)', upper: '(X)', zeroblob: '(N)',
  // aggregate
  avg: '(X)', count: '(X | *)', group_concat: '(X[, SEP])', string_agg: '(X, SEP)', sum: '(X)',
  total: '(X)',
  // date/time
  date: '(TIME-VALUE, MODIFIER, ...)', time: '(TIME-VALUE, MODIFIER, ...)',
  datetime: '(TIME-VALUE, MODIFIER, ...)', julianday: '(TIME-VALUE, MODIFIER, ...)',
  unixepoch: '(TIME-VALUE, MODIFIER, ...)', strftime: '(FORMAT, TIME-VALUE, MODIFIER, ...)',
  timediff: '(A, B)',
  // window
  row_number: '()', rank: '()', dense_rank: '()', percent_rank: '()', cume_dist: '()',
  ntile: '(N)', lag: '(X[, OFFSET[, DEFAULT]])', lead: '(X[, OFFSET[, DEFAULT]])',
  first_value: '(X)', last_value: '(X)', nth_value: '(X, N)',
  // json
  json: '(X)', jsonb: '(X)', json_array: '(V, ...)', jsonb_array: '(V, ...)',
  json_array_length: '(JSON[, PATH])', json_each: '(JSON[, PATH])', json_error_position: '(X)',
  json_extract: '(JSON, PATH, ...)', jsonb_extract: '(JSON, PATH, ...)',
  json_insert: '(JSON, PATH, VALUE, ...)', jsonb_insert: '(JSON, PATH, VALUE, ...)',
  json_object: '(LABEL, VALUE, ...)', jsonb_object: '(LABEL, VALUE, ...)',
  json_patch: '(JSON1, JSON2)', jsonb_patch: '(JSON1, JSON2)', json_pretty: '(JSON)',
  json_remove: '(JSON, PATH, ...)', jsonb_remove: '(JSON, PATH, ...)',
  json_replace: '(JSON, PATH, VALUE, ...)', jsonb_replace: '(JSON, PATH, VALUE, ...)',
  json_set: '(JSON, PATH, VALUE, ...)', jsonb_set: '(JSON, PATH, VALUE, ...)',
  json_tree: '(JSON[, PATH])', json_type: '(JSON[, PATH])', json_valid: '(JSON[, FLAGS])',
  json_quote: '(VALUE)', json_group_array: '(VALUE)', jsonb_group_array: '(VALUE)',
  json_group_object: '(NAME, VALUE)', jsonb_group_object: '(NAME, VALUE)',
  // math
  acos: '(X)', acosh: '(X)', asin: '(X)', asinh: '(X)', atan: '(X)', atan2: '(Y, X)',
  atanh: '(X)', ceil: '(X)', ceiling: '(X)', cos: '(X)', cosh: '(X)', degrees: '(X)', exp: '(X)',
  floor: '(X)', ln: '(X)', log: '([B,] X)', log10: '(X)', log2: '(X)', mod: '(X, Y)', pi: '()',
  pow: '(X, Y)', power: '(X, Y)', radians: '(X)', sin: '(X)', sinh: '(X)', sqrt: '(X)',
  tan: '(X)', tanh: '(X)', trunc: '(X)',
};
export const FUNCTION_SET = new Set(Object.keys(FUNCTIONS));

export const TYPES = words(`
  INTEGER INT TEXT REAL BLOB NUMERIC ANY BOOLEAN DATE DATETIME TIMESTAMP VARCHAR
  CHAR NVARCHAR NCHAR CLOB DOUBLE FLOAT BIGINT SMALLINT TINYINT DECIMAL
`);

export const COLLATIONS = ['BINARY', 'NOCASE', 'RTRIM'];

export const COLUMN_CONSTRAINTS = [
  'PRIMARY KEY', 'NOT NULL', 'UNIQUE', 'CHECK (', 'DEFAULT', 'COLLATE', 'REFERENCES',
  'GENERATED ALWAYS AS (', 'AS (', 'AUTOINCREMENT', 'ON CONFLICT', 'CONSTRAINT',
  'STORED', 'VIRTUAL', 'ASC', 'DESC',
];
export const TABLE_CONSTRAINTS = [
  'CONSTRAINT', 'PRIMARY KEY (', 'UNIQUE (', 'CHECK (', 'FOREIGN KEY (',
];
export const TABLE_OPTIONS = ['WITHOUT ROWID', 'STRICT'];
export const CONFLICT_ACTIONS = ['ROLLBACK', 'ABORT', 'FAIL', 'IGNORE', 'REPLACE'];
export const FK_ACTIONS = ['ON DELETE', 'ON UPDATE', 'CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT', 'NO ACTION', 'DEFERRABLE', 'INITIALLY DEFERRED', 'INITIALLY IMMEDIATE'];

/** name -> known values (empty list means free-form). */
export const PRAGMAS = {
  application_id: [], auto_vacuum: ['NONE', 'FULL', 'INCREMENTAL'], automatic_index: ['ON', 'OFF'],
  busy_timeout: [], cache_size: [], cache_spill: ['ON', 'OFF'], case_sensitive_like: ['ON', 'OFF'],
  cell_size_check: ['ON', 'OFF'], checkpoint_fullfsync: ['ON', 'OFF'], collation_list: [],
  compile_options: [], data_version: [], database_list: [], defer_foreign_keys: ['ON', 'OFF'],
  encoding: ["'UTF-8'", "'UTF-16'", "'UTF-16le'", "'UTF-16be'"], foreign_key_check: [],
  foreign_key_list: [], foreign_keys: ['ON', 'OFF'], freelist_count: [], fullfsync: ['ON', 'OFF'],
  function_list: [], hard_heap_limit: [], ignore_check_constraints: ['ON', 'OFF'],
  incremental_vacuum: [], index_info: [], index_list: [], index_xinfo: [], integrity_check: [],
  journal_mode: ['DELETE', 'TRUNCATE', 'PERSIST', 'MEMORY', 'WAL', 'OFF'], journal_size_limit: [],
  legacy_alter_table: ['ON', 'OFF'], locking_mode: ['NORMAL', 'EXCLUSIVE'], max_page_count: [],
  mmap_size: [], module_list: [], optimize: [], page_count: [], page_size: [], pragma_list: [],
  query_only: ['ON', 'OFF'], quick_check: [], read_uncommitted: ['ON', 'OFF'],
  recursive_triggers: ['ON', 'OFF'], reverse_unordered_selects: ['ON', 'OFF'], schema_version: [],
  secure_delete: ['ON', 'OFF', 'FAST'], shrink_memory: [], soft_heap_limit: [],
  synchronous: ['OFF', 'NORMAL', 'FULL', 'EXTRA'], table_info: [], table_list: [], table_xinfo: [],
  temp_store: ['DEFAULT', 'FILE', 'MEMORY'], threads: [], trusted_schema: ['ON', 'OFF'],
  user_version: [], wal_autocheckpoint: [], wal_checkpoint: ['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE'],
  writable_schema: ['ON', 'OFF'],
  // SQLCipher
  cipher: [], cipher_version: [], cipher_page_size: [], cipher_compatibility: ['1', '2', '3', '4'],
  cipher_default_compatibility: ['1', '2', '3', '4'], cipher_memory_security: ['ON', 'OFF'],
  cipher_migrate: [], cipher_plaintext_header_size: [], cipher_integrity_check: [],
  cipher_hmac_algorithm: ['HMAC_SHA1', 'HMAC_SHA256', 'HMAC_SHA512'],
  cipher_kdf_algorithm: ['PBKDF2_HMAC_SHA1', 'PBKDF2_HMAC_SHA256', 'PBKDF2_HMAC_SHA512'],
  cipher_kdf_iter: [], cipher_use_hmac: ['ON', 'OFF'], cipher_settings: [],
  cipher_default_settings: [], key: [], rekey: [], cipher_salt: [], cipher_profile: [],
  cipher_log: [], cipher_log_level: ['NONE', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'],
  cipher_log_source: ['NONE', 'CORE', 'MEMORY', 'MUTEX', 'PROVIDER', 'ANY'],
};

// ---------------------------------------------------------------------------
// Context → allowed keywords. Keys are produced by completion/context.js.

export const STATEMENT_START = [
  'SELECT', 'INSERT INTO', 'UPDATE', 'DELETE FROM', 'WITH', 'WITH RECURSIVE',
  'CREATE TABLE', 'CREATE TABLE IF NOT EXISTS', 'CREATE INDEX', 'CREATE UNIQUE INDEX', 'CREATE VIEW',
  'CREATE TRIGGER', 'CREATE VIRTUAL TABLE', 'CREATE TEMP TABLE',
  'DROP TABLE', 'DROP TABLE IF EXISTS', 'DROP VIEW', 'DROP INDEX', 'DROP TRIGGER', 'ALTER TABLE',
  'PRAGMA', 'EXPLAIN', 'EXPLAIN QUERY PLAN', 'BEGIN', 'BEGIN TRANSACTION', 'COMMIT', 'ROLLBACK',
  'SAVEPOINT', 'RELEASE', 'ATTACH DATABASE', 'DETACH DATABASE', 'VACUUM', 'ANALYZE', 'REINDEX',
  'REPLACE INTO', 'VALUES',
];

const EXPR_KW = [
  'AND', 'OR', 'NOT', 'IN', 'IS', 'IS NOT', 'IS NULL', 'IS NOT NULL', 'LIKE', 'GLOB', 'BETWEEN',
  'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'NULL', 'CAST(', 'COLLATE', 'ESCAPE',
  'DISTINCT', 'CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME', 'TRUE', 'FALSE',
];
const SELECT_TAIL = ['WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'OFFSET', 'UNION', 'UNION ALL', 'EXCEPT', 'INTERSECT', 'WINDOW'];
const JOINS = ['JOIN', 'LEFT JOIN', 'LEFT OUTER JOIN', 'INNER JOIN', 'CROSS JOIN', 'NATURAL JOIN', 'RIGHT JOIN', 'FULL JOIN'];

export const NEXT_KEYWORDS = {
  start: STATEMENT_START,
  select: ['DISTINCT', 'ALL', 'CASE', 'CAST(', 'EXISTS(', 'NOT', 'NULL', '*'],
  selectList: ['FROM', 'AS', 'OVER', 'FILTER', ...EXPR_KW, ...SELECT_TAIL],
  tableRef: ['AS', ...JOINS, 'ON', 'USING (', 'INDEXED BY', 'NOT INDEXED', ...SELECT_TAIL, 'SET', 'RETURNING'],
  expr: [...EXPR_KW, ...SELECT_TAIL, 'RETURNING', ...JOINS],
  orderBy: ['ASC', 'DESC', 'NULLS FIRST', 'NULLS LAST', 'COLLATE', 'LIMIT', 'OFFSET'],
  groupBy: ['HAVING', 'ORDER BY', 'LIMIT', 'UNION', 'UNION ALL'],
  set: [],
  insert: ['INTO', 'OR REPLACE', 'OR IGNORE', 'OR ABORT', 'OR FAIL', 'OR ROLLBACK'],
  insertTarget: ['VALUES (', 'SELECT', 'DEFAULT VALUES', 'AS', 'ON CONFLICT', 'RETURNING', 'WITH'],
  insertTail: ['ON CONFLICT', 'RETURNING', 'DO NOTHING', 'DO UPDATE SET', 'WHERE'],
  values: ['NULL', 'CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME', 'TRUE', 'FALSE', 'CAST('],
  update: ['OR REPLACE', 'OR IGNORE', 'OR ABORT', 'OR FAIL', 'OR ROLLBACK'],
  create: ['TABLE', 'TABLE IF NOT EXISTS', 'VIEW', 'VIEW IF NOT EXISTS', 'INDEX', 'INDEX IF NOT EXISTS', 'UNIQUE INDEX', 'TRIGGER', 'TEMP', 'TEMPORARY', 'VIRTUAL TABLE'],
  createTableName: ['IF NOT EXISTS'],
  createTableAfterName: ['(', 'AS SELECT', 'AS'],
  createIndexAfterName: ['ON', 'IF NOT EXISTS'],
  createViewAfterName: ['AS', 'AS SELECT', 'IF NOT EXISTS'],
  createTrigger: ['BEFORE', 'AFTER', 'INSTEAD OF', 'IF NOT EXISTS'],
  triggerEvent: ['INSERT', 'UPDATE', 'UPDATE OF', 'DELETE'],
  triggerAfterEvent: ['ON'],
  triggerBody: ['FOR EACH ROW', 'WHEN', 'BEGIN', 'END'],
  drop: ['TABLE', 'TABLE IF EXISTS', 'VIEW', 'VIEW IF EXISTS', 'INDEX', 'INDEX IF EXISTS', 'TRIGGER', 'TRIGGER IF EXISTS'],
  alter: ['TABLE'],
  alterTable: ['RENAME TO', 'RENAME COLUMN', 'ADD COLUMN', 'DROP COLUMN', 'ADD', 'DROP', 'RENAME'],
  alterAdd: ['COLUMN'],
  pragmaName: [],
  pragmaAfterName: ['='],
  columnType: TYPES,
  columnConstraint: COLUMN_CONSTRAINTS,
  tableConstraint: TABLE_CONSTRAINTS,
  tableOptions: TABLE_OPTIONS,
  conflict: CONFLICT_ACTIONS,
  fkClause: FK_ACTIONS,
  collate: COLLATIONS,
  with: ['RECURSIVE'],
  withAfterCte: ['AS (', 'AS MATERIALIZED (', 'AS NOT MATERIALIZED (', 'SELECT', 'INSERT INTO', 'UPDATE', 'DELETE FROM'],
  begin: ['TRANSACTION', 'DEFERRED', 'IMMEDIATE', 'EXCLUSIVE'],
  explain: ['QUERY PLAN', ...STATEMENT_START.filter((k) => !k.startsWith('EXPLAIN'))],
  none: [],
};

/** Keywords that open a clause and reset "what comes next". */
export const CLAUSE_KEYWORDS = new Set([
  'select', 'from', 'where', 'join', 'on', 'using', 'group', 'order', 'having', 'limit', 'offset',
  'set', 'into', 'values', 'update', 'delete', 'insert', 'replace', 'create', 'drop', 'alter',
  'pragma', 'with', 'returning', 'window', 'partition', 'over', 'union', 'intersect', 'except',
  'when', 'then', 'else', 'case', 'end', 'references', 'begin', 'explain', 'attach', 'detach',
  'add', 'rename', 'column', 'table', 'view', 'index', 'trigger', 'by', 'as', 'default',
  'check', 'collate', 'conflict', 'foreign', 'primary', 'key', 'to', 'of', 'for', 'each', 'row',
  'before', 'after', 'instead', 'if', 'exists', 'not', 'null', 'unique', 'temp', 'temporary',
  'virtual', 'and', 'or', 'in', 'is', 'like', 'glob', 'between', 'distinct', 'all', 'cast',
  'recursive', 'materialized', 'without', 'rowid', 'strict', 'do', 'nothing', 'filter',
]);

/** Keywords that end a table-reference list clause; used when scanning scope. */
export const TABLE_REF_INTRO = new Set(['from', 'join', 'update', 'into']);
