export const DF_NODE_CATALOG = [
  {
    group: 'Sources', family: 'source',
    nodes: [
      { kind: 'src-table',    name: 'SQLite table',         icon: 'table',    desc: 'Read rows from a table in a connected database' },
      { kind: 'src-view',     name: 'SQLite view',          icon: 'view',     desc: 'Read from a saved view' },
      { kind: 'src-sql',      name: 'SQL query',            icon: 'terminal', desc: 'Use a SELECT statement as the source' },
      { kind: 'src-csv',      name: 'CSV file',             icon: 'file-csv', desc: 'Read rows from a .csv file' },
      { kind: 'src-json',     name: 'JSON / JSONL',         icon: 'file-json',desc: 'Read JSON array or newline-delimited JSON' },
      { kind: 'src-parquet',  name: 'Parquet file',         icon: 'file-pq',  desc: 'Columnar Parquet file' },
      { kind: 'src-ext-db',   name: 'External SQLite',      icon: 'database', desc: 'Read-only from a different .db / .cipher.db file' },
      { kind: 'src-folder',   name: 'Folder of files',      icon: 'folder',   desc: 'Glob match a folder of CSV/JSON/Parquet' },
    ],
  },
  {
    group: 'Transform', family: 'transform',
    nodes: [
      { kind: 'tf-filter',  name: 'Filter rows',     icon: 'filter',   desc: 'Keep rows matching a predicate' },
      { kind: 'tf-project', name: 'Select columns',  icon: 'columns',  desc: 'Pick / drop / reorder columns' },
      { kind: 'tf-rename',  name: 'Rename column',   icon: 'edit',     desc: 'Rename one or more columns' },
      { kind: 'tf-cast',    name: 'Cast type',       icon: 'cast',     desc: 'Change a column\'s type with conversion rules' },
      { kind: 'tf-derive',  name: 'Derive column',   icon: 'fn',       desc: 'Add a column from an expression' },
      { kind: 'tf-join',    name: 'Join streams',    icon: 'merge',    desc: 'Inner / left / right / full join on key columns' },
      { kind: 'tf-union',   name: 'Union streams',   icon: 'union',    desc: 'Append rows from multiple inputs' },
      { kind: 'tf-group',   name: 'Group + aggregate', icon: 'group',  desc: 'GROUP BY with count / sum / avg / min / max' },
      { kind: 'tf-sort',    name: 'Sort',            icon: 'sort-asc', desc: 'Order rows by one or more columns' },
      { kind: 'tf-limit',   name: 'Limit',           icon: 'minus',    desc: 'Cap the number of rows that pass through' },
      { kind: 'tf-map',     name: 'Map columns',     icon: 'mapping',  desc: 'Bulk column-to-column mapping (great for migrations)' },
    ],
  },
  {
    group: 'Cleaning', family: 'clean',
    nodes: [
      { kind: 'cl-dedupe',     name: 'Deduplicate',     icon: 'dedupe',     desc: 'Remove duplicate rows by key columns (keep first / last)' },
      { kind: 'cl-fill-null',  name: 'Fill nulls',      icon: 'fill',       desc: 'Replace nulls with a default per column' },
      { kind: 'cl-trim',       name: 'Trim whitespace', icon: 'trim',       desc: 'Strip leading / trailing whitespace from text columns' },
      { kind: 'cl-case',       name: 'Normalize case',  icon: 'case',       desc: 'Lower / upper / title case' },
      { kind: 'cl-anon',       name: 'Anonymize',       icon: 'anonymize',  desc: 'Hash, redact, or fake-replace PII columns' },
      { kind: 'cl-validate',   name: 'Validate rows',   icon: 'shield',     desc: 'Reject rows that fail rules; route to dead-letter' },
    ],
  },
  {
    group: 'Schema ops', family: 'schema',
    nodes: [
      { kind: 'sc-add-col',    name: 'Add column',      icon: 'plus',       desc: 'Add a column to the target table' },
      { kind: 'sc-drop-col',   name: 'Drop column',     icon: 'minus',      desc: 'Remove a column from the target table' },
      { kind: 'sc-rename-col', name: 'Rename column',   icon: 'edit',       desc: 'Rename a column on the target' },
      { kind: 'sc-cast-col',   name: 'Change type',     icon: 'cast',       desc: 'Change column type with conversion' },
      { kind: 'sc-add-index',  name: 'Add index',       icon: 'index',      desc: 'Create an index after data lands' },
    ],
  },
  {
    group: 'Code', family: 'code',
    nodes: [
      { kind: 'co-sql',  name: 'Inline SQL',     icon: 'terminal', desc: 'SELECT against incoming streams' },
      { kind: 'co-py',   name: 'Python scriptlet', icon: 'python', desc: 'Custom logic in Python (sandboxed)' },
      { kind: 'co-js',   name: 'JS scriptlet',   icon: 'js',       desc: 'Custom logic in JavaScript (sandboxed)' },
    ],
  },
  {
    group: 'Sinks', family: 'sink',
    nodes: [
      { kind: 'snk-table',   name: 'SQLite table',  icon: 'table',     desc: 'Write to a table (append / replace / upsert)' },
      { kind: 'snk-ext-db',  name: 'External SQLite', icon: 'database',desc: 'Write to a table in a different .db file' },
      { kind: 'snk-csv',     name: 'CSV file',      icon: 'file-csv',  desc: 'Export to .csv' },
      { kind: 'snk-json',    name: 'JSON file',     icon: 'file-json', desc: 'Export to .json or JSONL' },
      { kind: 'snk-parquet', name: 'Parquet file',  icon: 'file-pq',   desc: 'Export to .parquet' },
    ],
  },
];

export const DF_NODE_BY_KIND = {};
DF_NODE_CATALOG.forEach(g => g.nodes.forEach(n => { DF_NODE_BY_KIND[n.kind] = { ...n, family: g.family }; }));
