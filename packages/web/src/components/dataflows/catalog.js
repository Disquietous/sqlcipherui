/**
 * Node catalog. `family` drives colour + grouping. Optional per-node fields:
 *   inputs:  named input ports (default ['in']); tf-join uses ['L','R']
 *   outputs: named output ports (default ['out']); cl-validate adds 'rejected'
 *   status:  'soon' marks a kind that the backend refuses to run yet
 *   needsConn: node writes/reads a connected database via config.conn
 */
export const DF_NODE_CATALOG = [
  {
    group: 'Sources', family: 'source',
    nodes: [
      { kind: 'src-table',    name: 'SQLite table',     icon: 'table',    desc: 'Read rows from a table in a connected database', needsConn: true },
      { kind: 'src-view',     name: 'SQLite view',      icon: 'view',     desc: 'Read from a saved view', needsConn: true },
      { kind: 'src-sql',      name: 'SQL query',        icon: 'terminal', desc: 'Use a SELECT statement as the source', needsConn: true },
      { kind: 'src-csv',      name: 'CSV file',         icon: 'file-csv', desc: 'Read rows from a .csv file' },
      { kind: 'src-json',     name: 'JSON / JSONL',     icon: 'file-json',desc: 'Read a JSON array or newline-delimited JSON' },
      { kind: 'src-parquet',  name: 'Parquet file',     icon: 'file-pq',  desc: 'Columnar Parquet file (requires the parquet extra)' },
      { kind: 'src-ext-db',   name: 'External SQLite',  icon: 'database', desc: 'Read-only from another .db or SQLCipher file by path' },
      { kind: 'src-folder',   name: 'Folder of files',  icon: 'folder',   desc: 'Glob a folder of CSV / JSON / Parquet files' },
    ],
  },
  {
    group: 'Transform', family: 'transform',
    nodes: [
      { kind: 'tf-filter',  name: 'Filter rows',       icon: 'filter',   desc: 'Keep rows matching a predicate' },
      { kind: 'tf-project', name: 'Select columns',    icon: 'columns',  desc: 'Pick / drop / reorder columns' },
      { kind: 'tf-rename',  name: 'Rename column',     icon: 'edit',     desc: 'Rename a column' },
      { kind: 'tf-cast',    name: 'Cast type',         icon: 'cast',     desc: 'Change a column\'s type' },
      { kind: 'tf-derive',  name: 'Derive column',     icon: 'fn',       desc: 'Add a column from an expression' },
      { kind: 'tf-join',    name: 'Join streams',      icon: 'merge',    desc: 'Inner / left / right / full join on key columns', inputs: ['L', 'R'] },
      { kind: 'tf-union',   name: 'Union streams',     icon: 'union',    desc: 'Append rows from multiple inputs' },
      { kind: 'tf-group',   name: 'Group + aggregate', icon: 'group',    desc: 'GROUP BY with count / sum / avg / min / max' },
      { kind: 'tf-sort',    name: 'Sort',              icon: 'sort-asc', desc: 'Order rows by one or more columns' },
      { kind: 'tf-limit',   name: 'Limit',             icon: 'minus',    desc: 'Cap the number of rows that pass through' },
      { kind: 'tf-map',     name: 'Map columns',       icon: 'mapping',  desc: 'Bulk column-to-column mapping (great for migrations)' },
    ],
  },
  {
    group: 'Cleaning', family: 'clean',
    nodes: [
      { kind: 'cl-dedupe',     name: 'Deduplicate',     icon: 'dedupe',     desc: 'Remove duplicate rows by key columns (keep first / last)' },
      { kind: 'cl-fill-null',  name: 'Fill nulls',      icon: 'fill',       desc: 'Replace nulls in a column with a default' },
      { kind: 'cl-trim',       name: 'Trim whitespace', icon: 'trim',       desc: 'Strip leading / trailing whitespace from text columns' },
      { kind: 'cl-case',       name: 'Normalize case',  icon: 'case',       desc: 'Lower / upper / title case' },
      { kind: 'cl-anon',       name: 'Anonymize',       icon: 'anonymize',  desc: 'Hash, redact, tokenize, or fake-replace PII columns' },
      { kind: 'cl-validate',   name: 'Validate rows',   icon: 'shield',     desc: 'Drop, fail, or route rows that fail rules', outputs: ['out', 'rejected'] },
    ],
  },
  {
    group: 'Schema ops', family: 'schema',
    nodes: [
      { kind: 'sc-add-col',    name: 'Add column',      icon: 'plus',   desc: 'Add a column to a table', needsConn: true },
      { kind: 'sc-drop-col',   name: 'Drop column',     icon: 'minus',  desc: 'Remove a column from a table', needsConn: true },
      { kind: 'sc-rename-col', name: 'Rename column',   icon: 'edit',   desc: 'Rename a column on a table', needsConn: true },
      { kind: 'sc-cast-col',   name: 'Change type',     icon: 'cast',   desc: 'Change a column\'s declared type (rebuilds the column)', needsConn: true },
      { kind: 'sc-add-index',  name: 'Add index',       icon: 'index',  desc: 'Create an index after data lands', needsConn: true },
    ],
  },
  {
    group: 'Code', family: 'code',
    nodes: [
      { kind: 'co-sql',  name: 'Inline SQL',       icon: 'terminal', desc: 'SELECT against incoming streams (_input, _input2, …)' },
      { kind: 'co-py',   name: 'Python scriptlet', icon: 'python',   desc: 'Custom logic in Python', status: 'soon' },
      { kind: 'co-js',   name: 'JS scriptlet',     icon: 'js',       desc: 'Custom logic in JavaScript', status: 'soon' },
    ],
  },
  {
    group: 'Encryption', family: 'encrypt',
    nodes: [
      { kind: 'en-encrypt', name: 'Encrypt copy',  icon: 'lock',   desc: 'Write an encrypted SQLCipher copy of a plaintext database', needsConn: true },
      { kind: 'en-decrypt', name: 'Decrypt copy',  icon: 'unlock', desc: 'Write a plaintext copy of an encrypted database', needsConn: true },
      { kind: 'en-rekey',   name: 'Rekey',         icon: 'key',    desc: 'Change the passphrase of an encrypted database', needsConn: true },
    ],
  },
  {
    group: 'Sinks', family: 'sink',
    nodes: [
      { kind: 'snk-table',   name: 'SQLite table',    icon: 'table',     desc: 'Write to a table (append / replace / upsert)', needsConn: true },
      { kind: 'snk-ext-db',  name: 'External SQLite', icon: 'database',  desc: 'Write to a table in another .db or SQLCipher file by path' },
      { kind: 'snk-csv',     name: 'CSV file',        icon: 'file-csv',  desc: 'Export to .csv' },
      { kind: 'snk-json',    name: 'JSON file',       icon: 'file-json', desc: 'Export to .json or JSONL' },
      { kind: 'snk-parquet', name: 'Parquet file',    icon: 'file-pq',   desc: 'Export to .parquet (requires the parquet extra)' },
    ],
  },
];

export const DF_NODE_BY_KIND = {};
DF_NODE_CATALOG.forEach(g => g.nodes.forEach(n => { DF_NODE_BY_KIND[n.kind] = { ...n, family: g.family }; }));

export const nodeInputs = (kind) => DF_NODE_BY_KIND[kind]?.inputs || ['in'];
export const nodeOutputs = (kind) => DF_NODE_BY_KIND[kind]?.outputs || ['out'];
export const isSourceKind = (kind) => DF_NODE_BY_KIND[kind]?.family === 'source';
export const isSinkKind = (kind) => DF_NODE_BY_KIND[kind]?.family === 'sink';
